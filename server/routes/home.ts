import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { APP_TIMEZONE } from '../config.js'
import { pool } from '../db.js'
import { recordAuditLog } from '../services/audit-log.js'

const router = Router()
const programmingTimeZone = APP_TIMEZONE

export interface HomepageTicketsFilterConfig {
  enterprises: string[]
  ticketTypes: ('client' | 'condominium')[]
  subjects: string[]
  fromYear: number | null
}

const defaultFilterConfig: HomepageTicketsFilterConfig = {
  enterprises: [],
  ticketTypes: [],
  subjects: [],
  fromYear: null,
}

async function getHomepageTicketsFilterConfig(): Promise<HomepageTicketsFilterConfig> {
  try {
    const result = await pool.query<{ setting_value: HomepageTicketsFilterConfig }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = 'homepage_active_tickets_filter'`,
    )
    if (!result.rowCount || !result.rows[0].setting_value) {
      return defaultFilterConfig
    }
    const val = result.rows[0].setting_value
    return {
      enterprises: Array.isArray(val.enterprises)
        ? val.enterprises.map(String).map((s) => s.trim()).filter(Boolean)
        : [],
      ticketTypes: Array.isArray(val.ticketTypes)
        ? val.ticketTypes.filter((t): t is 'client' | 'condominium' => t === 'client' || t === 'condominium')
        : [],
      subjects: Array.isArray(val.subjects)
        ? val.subjects.map(String).map((s) => s.trim()).filter(Boolean)
        : [],
      fromYear: typeof val.fromYear === 'number' && Number.isInteger(val.fromYear) && val.fromYear >= 1990 && val.fromYear <= 2200
        ? val.fromYear
        : null,
    }
  } catch (err) {
    console.error('Erro ao buscar configuração de filtro de chamados da home:', err)
    return defaultFilterConfig
  }
}

router.use(requireAuth)

router.get('/summary', async (req, res, next) => {
  const user = req.session.user!

  try {
    const todayDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: programmingTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    // 1. Permissões do usuário
    let accessSet = new Set<string>()
    if (user.role !== 'admin') {
      const accessRows = await pool.query<{ page_key: string }>(
        'SELECT page_key FROM user_page_access WHERE user_id = $1',
        [user.id],
      )
      accessSet = new Set(accessRows.rows.map((row) => row.page_key))
    }

    const canAccess = (key: string) => user.role === 'admin' || accessSet.has(key)

    // 2. Coleta paralela de indicadores com isolamento de erros
    const [
      ticketsSummary,
      scheduleCount,
      todayAppointments,
      legalSummary,
      inventorySummary,
      absencesToday,
      personalTasks,
    ] = await Promise.all([
      // Tickets
      canAccess('tickets')
        ? (async () => {
            const filterConfig = await getHomepageTicketsFilterConfig()
            const conditions: string[] = []
            const values: (string | number | string[])[] = [todayDateStr]

            if (filterConfig.enterprises.length > 0) {
              values.push(filterConfig.enterprises.map((e) => e.toLowerCase()))
              conditions.push(`lower(btrim(enterprise)) = ANY($${values.length}::text[])`)
            }

            if (filterConfig.ticketTypes.length > 0) {
              values.push(filterConfig.ticketTypes)
              conditions.push(`(
                CASE
                  WHEN btrim(block) <> '' AND btrim(unit) <> '' THEN 'client'
                  WHEN btrim(block) = '' AND btrim(unit) = '' AND btrim(enterprise) <> ''
                    AND strpos(lower(source_creator_name), lower(btrim(enterprise))) > 0 THEN 'condominium'
                  ELSE NULL
                END
              ) = ANY($${values.length}::text[])`)
            }

            if (filterConfig.subjects.length > 0) {
              values.push(filterConfig.subjects.map((s) => s.toLowerCase()))
              conditions.push(`(
                CASE WHEN source_subject_id = 16 THEN 'assistência técnica' ELSE lower(btrim(subject)) END
              ) = ANY($${values.length}::text[])`)
            }

            if (filterConfig.fromYear !== null) {
              values.push(filterConfig.fromYear)
              conditions.push(`opened_at >= make_date($${values.length}::int, 1, 1)`)
            }

            const extraWhere = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : ''

            const queryResult = await pool.query<{ active_total: number; opened_this_month: number }>(
              `SELECT
                 COUNT(*) FILTER (WHERE source_active = true)::int AS active_total,
                 COUNT(*) FILTER (WHERE opened_at >= date_trunc('month', $1::date))::int AS opened_this_month
               FROM tickets
               WHERE 1 = 1 ${extraWhere}`,
              values,
            )

            const parts: string[] = []
            if (filterConfig.enterprises.length > 0) {
              parts.push(filterConfig.enterprises.length === 1 ? filterConfig.enterprises[0] : `${filterConfig.enterprises.length} obras`)
            }
            if (filterConfig.ticketTypes.length === 1) {
              parts.push(filterConfig.ticketTypes[0] === 'client' ? 'Clientes' : 'Condomínios')
            }
            if (filterConfig.subjects.length > 0) {
              parts.push(filterConfig.subjects.length === 1 ? filterConfig.subjects[0] : `${filterConfig.subjects.length} assuntos`)
            }
            if (filterConfig.fromYear !== null) {
              parts.push(`desde ${filterConfig.fromYear}`)
            }

            return {
              active_total: queryResult.rows[0]?.active_total ?? 0,
              opened_this_month: queryResult.rows[0]?.opened_this_month ?? 0,
              filter_applied: parts.length > 0,
              filter_summary: parts.length > 0 ? parts.join(' · ') : null,
            }
          })().catch((err) => {
            console.error('Erro ao consultar resumo de tickets:', err)
            return { active_total: 0, opened_this_month: 0, filter_applied: false, filter_summary: null }
          })
        : Promise.resolve(null),

      // Schedule Count
      canAccess('schedule')
        ? pool.query<{ total_today: number; collaborators_count: number }>(
            `SELECT
               COUNT(DISTINCT p.id)::int AS total_today,
               COUNT(DISTINCT p.collaborator_id)::int AS collaborators_count
             FROM ticket_programming p
             WHERE p.starts_at < (($1::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
               AND p.ends_at > ($1::date AT TIME ZONE '${programmingTimeZone}')`,
            [todayDateStr],
          ).then((r) => r.rows[0] ?? { total_today: 0, collaborators_count: 0 })
          .catch((err) => {
            console.error('Erro ao consultar contagem de programação:', err)
            return { total_today: 0, collaborators_count: 0 }
          })
        : Promise.resolve(null),

      // Today Appointments List
      canAccess('schedule')
        ? pool.query<{
            id: string
            starts_at: string
            ends_at: string
            service: string
            completed: boolean
            enterprise: string | null
            block: string | null
            unit: string | null
            standalone_location: string | null
            common_area_location: string | null
            collaborator_id: string
            collaborator_name: string
            collaborator_role: string
            ticket_protocol: string | null
            legal_process_number: string | null
            legal_process_title: string | null
          }>(
            `SELECT
               p.id, p.starts_at, p.ends_at, p.activity_description AS service, p.completed,
               p.enterprise, p.block, p.unit, p.standalone_location, p.common_area_location,
               c.id AS collaborator_id, c.name AS collaborator_name, c.role AS collaborator_role,
               t.protocol AS ticket_protocol,
               lp.process_number AS legal_process_number, lp.title AS legal_process_title
             FROM ticket_programming p
             JOIN collaborators c ON c.id = p.collaborator_id
             LEFT JOIN tickets t ON t.source_id = p.ticket_id
             LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
             WHERE p.starts_at < (($1::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
               AND p.ends_at > ($1::date AT TIME ZONE '${programmingTimeZone}')
             ORDER BY p.starts_at ASC, p.id ASC
             LIMIT 8`,
            [todayDateStr],
          ).then((r) => r.rows)
          .catch((err) => {
            console.error('Erro ao consultar lista de agendamentos de hoje:', err)
            return []
          })
        : Promise.resolve([]),

      // Legal Processes
      canAccess('legal-processes')
        ? pool.query<{ active_total: number; upcoming_deadlines_count: number }>(
            `SELECT
               COUNT(*) FILTER (WHERE conclusion_result IS NULL)::int AS active_total,
               COUNT(*) FILTER (WHERE conclusion_result IS NULL AND end_date >= $1::date AND end_date <= ($1::date + interval '7 days'))::int AS upcoming_deadlines_count
             FROM legal_processes`,
            [todayDateStr],
          ).then((r) => r.rows[0] ?? { active_total: 0, upcoming_deadlines_count: 0 })
          .catch((err) => {
            console.error('Erro ao consultar resumo de processos jurídicos:', err)
            return { active_total: 0, upcoming_deadlines_count: 0 }
          })
        : Promise.resolve(null),

      // Inventory Low Stock
      canAccess('inventory')
        ? pool.query<{ low_stock_count: number }>(
            `SELECT COUNT(*)::int AS low_stock_count
             FROM (
               SELECT item.id, item.minimum_stock,
                      COALESCE(SUM(CASE
                        WHEN document.document_type IN ('entry', 'tool_return') THEN line.base_quantity
                        WHEN document.document_type = 'transfer' THEN 0
                        ELSE -line.base_quantity END), 0) AS stock_quantity
               FROM inventory_items item
               LEFT JOIN inventory_document_items line ON line.item_id = item.id
               LEFT JOIN inventory_documents document ON document.id = line.document_id
               WHERE item.is_active = true AND item.minimum_stock > 0
               GROUP BY item.id, item.minimum_stock
               HAVING COALESCE(SUM(CASE
                        WHEN document.document_type IN ('entry', 'tool_return') THEN line.base_quantity
                        WHEN document.document_type = 'transfer' THEN 0
                        ELSE -line.base_quantity END), 0) <= item.minimum_stock
             ) low_stock`,
          ).then((r) => r.rows[0]?.low_stock_count ?? 0)
          .catch((err) => {
            console.error('Erro ao consultar estoque baixo:', err)
            return 0
          })
        : Promise.resolve(null),

      // Absences Today
      canAccess('collaborators')
        ? pool.query<{
            id: string
            type: 'atestado' | 'falta_injustificada'
            collaborator_id: string
            collaborator_name: string
            collaborator_role: string
            start_date: string
            end_date: string
            cid: string | null
          }>(
            `SELECT a.id, a.type, a.start_date, a.end_date, a.cid,
                    c.id AS collaborator_id, c.name AS collaborator_name, c.role AS collaborator_role
             FROM collaborator_absences a
             JOIN collaborators c ON c.id = a.collaborator_id
             WHERE a.start_date <= $1::date AND a.end_date >= $1::date
               AND (c.termination_date IS NULL OR c.termination_date > $1::date)
             ORDER BY c.name ASC`,
            [todayDateStr],
          ).then((r) => r.rows)
          .catch((err) => {
            console.error('Erro ao consultar ausências de hoje:', err)
            return []
          })
        : Promise.resolve([]),

      // Personal Tasks Pending
      canAccess('personal-activities')
        ? pool.query<{ pending_tasks: number }>(
            `SELECT count(a.id)::int AS pending_tasks
             FROM personal_activities a
             JOIN personal_activity_columns c ON c.id = a.column_id AND c.user_id = a.user_id
             WHERE a.user_id = $1 AND lower(c.name) NOT LIKE '%conclu%'`,
            [user.id],
          ).then((r) => r.rows[0]?.pending_tasks ?? 0)
          .catch((err) => {
            console.error('Erro ao consultar tarefas pessoais:', err)
            return 0
          })
        : Promise.resolve(null),
    ])

    res.json({
      todayDate: todayDateStr,
      user: {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
      },
      tickets: ticketsSummary
        ? {
            activeTotal: ticketsSummary.active_total,
            openedThisMonth: ticketsSummary.opened_this_month,
            filterApplied: ticketsSummary.filter_applied,
            filterSummary: ticketsSummary.filter_summary,
          }
        : null,
      schedule: scheduleCount
        ? {
            totalToday: scheduleCount.total_today,
            collaboratorsCount: scheduleCount.collaborators_count,
            todayAppointments: todayAppointments.map((app) => ({
              id: app.id,
              startsAt: app.starts_at,
              endsAt: app.ends_at,
              service: app.service,
              completed: app.completed,
              enterprise: app.enterprise,
              location: app.standalone_location || [app.enterprise, app.block, app.unit].filter(Boolean).join(' - ') || app.common_area_location || 'Local a definir',
              collaboratorName: app.collaborator_name,
              collaboratorRole: app.collaborator_role,
              ticketProtocol: app.ticket_protocol,
              legalProcessNumber: app.legal_process_number,
              legalProcessTitle: app.legal_process_title,
            })),
          }
        : null,
      legal: legalSummary
        ? {
            activeTotal: legalSummary.active_total,
            upcomingDeadlinesCount: legalSummary.upcoming_deadlines_count,
          }
        : null,
      inventory: inventorySummary !== null
        ? {
            lowStockCount: inventorySummary,
          }
        : null,
      absencesToday: absencesToday.map((abs) => ({
        id: abs.id,
        type: abs.type,
        collaboratorId: abs.collaborator_id,
        collaboratorName: abs.collaborator_name,
        collaboratorRole: abs.collaborator_role,
        startDate: abs.start_date,
        endDate: abs.end_date,
        cid: abs.cid,
      })),
      personalTasksCount: personalTasks,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/tickets-filter-config', requireAdmin, async (_req, res, next) => {
  try {
    const config = await getHomepageTicketsFilterConfig()

    const [enterprisesResult, subjectsResult, yearsResult] = await Promise.all([
      pool.query<{ value: string }>(
        `SELECT min(btrim(enterprise)) AS value
         FROM tickets
         WHERE btrim(enterprise) <> ''
         GROUP BY lower(btrim(enterprise))
         ORDER BY lower(min(btrim(enterprise)))`,
      ),
      pool.query<{ value: string }>(
        `SELECT CASE WHEN source_subject_id = 16 THEN 'Assistência Técnica' ELSE min(btrim(subject)) END AS value
         FROM tickets
         WHERE (source_subject_id = 16 OR btrim(subject) <> '')
         GROUP BY (source_subject_id = 16),
                  CASE WHEN source_subject_id = 16 THEN 'Assistência Técnica' ELSE lower(btrim(subject)) END
         ORDER BY value`,
      ),
      pool.query<{ value: number }>(
        `SELECT DISTINCT EXTRACT(YEAR FROM opened_at)::int AS value
         FROM tickets
         WHERE opened_at IS NOT NULL
         ORDER BY value DESC`,
      ),
    ])

    const availableYears = yearsResult.rows.map((r) => r.value).filter(Boolean)
    if (availableYears.length === 0) {
      const currentYear = new Date().getFullYear()
      for (let y = currentYear; y >= currentYear - 6; y--) {
        availableYears.push(y)
      }
    }

    res.json({
      config,
      options: {
        enterprises: enterprisesResult.rows.map((r) => r.value),
        subjects: subjectsResult.rows.map((r) => r.value),
        years: availableYears,
        ticketTypes: [
          { value: 'client', label: 'Cliente' },
          { value: 'condominium', label: 'Condomínio' },
        ],
      },
    })
  } catch (error) {
    next(error)
  }
})

const updateFilterConfigSchema = z.object({
  enterprises: z.array(z.string().trim().max(240)).default([]),
  ticketTypes: z.array(z.enum(['client', 'condominium'])).default([]),
  subjects: z.array(z.string().trim().max(240)).default([]),
  fromYear: z.number().int().min(1990).max(2200).nullable().optional(),
})

router.put('/tickets-filter-config', async (req, res, next) => {
  const user = req.session.user!
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Apenas administradores podem configurar o filtro da homepage.' })
    return
  }

  const parsed = updateFilterConfigSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros de filtro inválidos. Verifique os dados enviados.' })
    return
  }

  const cleanConfig: HomepageTicketsFilterConfig = {
    enterprises: [...new Set(parsed.data.enterprises.map((e) => e.trim()).filter(Boolean))],
    ticketTypes: [...new Set(parsed.data.ticketTypes)],
    subjects: [...new Set(parsed.data.subjects.map((s) => s.trim()).filter(Boolean))],
    fromYear: parsed.data.fromYear ?? null,
  }

  try {
    await pool.query(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('homepage_active_tickets_filter', $1::jsonb, now(), $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(cleanConfig), user.id],
    )

    await recordAuditLog({
      actorUserId: user.id,
      actorName: user.displayName,
      action: 'homepage_tickets_filter_updated',
      resourceType: 'application_setting',
      resourceId: 'homepage_active_tickets_filter',
      summary: 'Filtro global de chamados ativos da Homepage atualizado',
      metadata: { ...cleanConfig },
    })

    res.json({
      success: true,
      config: cleanConfig,
      message: 'Filtro da homepage configurado com sucesso.',
    })
  } catch (error) {
    next(error)
  }
})

router.get('/quick-search', async (req, res, next) => {
  const user = req.session.user!
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (rawQuery.length < 2) {
    res.json({ items: [] })
    return
  }

  try {
    const accessResult = await pool.query<{ page_key: string }>(
      `SELECT page_key FROM user_page_access WHERE user_id = $1`,
      [user.id],
    )
    const allowedPages = new Set(accessResult.rows.map((r) => r.page_key))
    const canAccess = (pageKey: string) => user.role === 'admin' || allowedPages.has(pageKey)

    const likeTerm = `%${rawQuery.toLowerCase()}%`

    const [ticketsRows, processesRows, collaboratorsRows] = await Promise.all([
      canAccess('tickets')
        ? pool.query<{
            source_id: string
            protocol: string
            enterprise: string
            subject: string
            unit: string
          }>(
            `SELECT source_id::text, protocol, enterprise, subject, unit
             FROM tickets
             WHERE lower(protocol) LIKE $1
                OR lower(source_id::text) LIKE $1
                OR lower(enterprise) LIKE $1
                OR lower(subject) LIKE $1
                OR lower(unit) LIKE $1
             ORDER BY opened_at DESC NULLS LAST, source_id DESC
             LIMIT 6`,
            [likeTerm],
          ).then((r) => r.rows)
        : Promise.resolve([]),

      canAccess('legal-processes')
        ? pool.query<{
            id: string
            process_number: string
            title: string
            claimant: string
          }>(
            `SELECT id::text, process_number, title, claimant
             FROM legal_processes
             WHERE lower(process_number) LIKE $1
                OR regexp_replace(process_number, '\\D', '', 'g') LIKE COALESCE(NULLIF(regexp_replace($2, '\\D', '', 'g'), ''), '__no_match__')
                OR lower(title) LIKE $1
                OR lower(claimant) LIKE $1
             ORDER BY updated_at DESC, id DESC
             LIMIT 6`,
            [likeTerm, `%${rawQuery.replace(/\D/g, '')}%`],
          ).then((r) => r.rows)
        : Promise.resolve([]),

      canAccess('collaborators')
        ? pool.query<{
            id: string
            name: string
            nickname: string
            role_label: string
          }>(
            `SELECT c.id::text, c.name, c.nickname, COALESCE(r.label, c.role) AS role_label
             FROM collaborators c
             LEFT JOIN collaborator_roles r ON r.role_key = c.role
             WHERE lower(c.name) LIKE $1
                OR lower(c.nickname) LIKE $1
                OR lower(COALESCE(c.registration_number, '')) LIKE $1
             ORDER BY lower(c.name), c.id
             LIMIT 6`,
            [likeTerm],
          ).then((r) => r.rows)
        : Promise.resolve([]),
    ])

    const items = [
      ...ticketsRows.map((t) => ({
        kind: 'ticket' as const,
        id: t.source_id,
        title: `Chamado #${t.protocol || t.source_id}`,
        subtitle: [t.enterprise, t.unit, t.subject].filter(Boolean).join(' • '),
      })),
      ...processesRows.map((p) => ({
        kind: 'legal-process' as const,
        id: p.id,
        title: p.process_number || p.title,
        subtitle: [p.title, p.claimant].filter(Boolean).join(' • '),
      })),
      ...collaboratorsRows.map((c) => ({
        kind: 'collaborator' as const,
        id: c.id,
        title: c.name,
        subtitle: [c.role_label, c.nickname ? `(${c.nickname})` : ''].filter(Boolean).join(' '),
      })),
    ]

    res.json({ items })
  } catch (error) {
    next(error)
  }
})

export default router
