import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { decryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'
import { recordTicketActivity } from '../services/ticket-activity.js'
import { evaluateTicketWarranty } from '../services/warranties.js'
import {
  fetchAndImportCvcrmTicketByProtocol,
  fetchCvcrmTicketByProtocol,
  ensureCvcrmSubjectCatalog,
  getCvcrmIntegrationStatus,
  importAllCvcrmTickets,
  importCvcrmProtocols,
  syncCvcrmTickets,
  toggleCvcrmAutoSync,
  validateCvcrmConnection,
} from '../services/cvcrm.js'

const router = Router()

function parseTextFilter(value: unknown, maxLength: number) {
  if (value === undefined) return []
  const parsed = z.union([
    z.string().trim().min(1).max(maxLength),
    z.array(z.string().trim().min(1).max(maxLength)).min(1).max(50),
  ]).safeParse(value)
  if (!parsed.success) return null
  return (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
    .map((entry) => entry.toLocaleLowerCase('pt-BR'))
}

function parseRepeatedTextFilter(url: string, key: string, maxLength: number) {
  const queryStart = url.indexOf('?')
  const values = new URLSearchParams(queryStart < 0 ? '' : url.slice(queryStart + 1)).getAll(key)
  return values.length ? parseTextFilter(values, maxLength) : []
}

const ticketIdSchema = z.coerce.number().int().positive()
const protocolSchema = z.object({
  protocol: z.string().trim().min(1).max(100),
})
const csvProtocolsSchema = z.object({
  protocols: z.array(z.string().trim().min(1).max(100)).min(1).max(5000),
})
const toggleAutoSyncSchema = z.object({
  enabled: z.boolean(),
})
const commentSchema = z.object({
  body: z.string().trim().min(1).max(6000),
  mentionIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
  parentCommentId: z.coerce.number().int().positive().nullable().optional().default(null),
})
const subtaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  assignedTo: z.number().int().positive().nullable().default(null),
  dueAt: z.string().datetime().nullable().default(null),
})
const managementSchema = z.object({
  localDueAt: z.string().datetime().nullable(),
  estimatedCost: z.number().finite().nonnegative().nullable(),
  actualCost: z.number().finite().nonnegative().nullable(),
})
const ticketTagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[\da-f]{6}$/i).default('#3478a8'),
})
const ticketTagAssignmentSchema = z.object({
  tagIds: z.array(z.coerce.number().int().positive()).max(50),
})

router.use(requireAuth, requirePageAccess('tickets'))

router.get('/integration', async (_req, res, next) => {
  try {
    const status = await getCvcrmIntegrationStatus()
    res.json(status)
  } catch (error) {
    next(error)
  }
})

router.get('/integration/status', async (_req, res, next) => {
  try {
    res.json(await getCvcrmIntegrationStatus())
  } catch (error) {
    next(error)
  }
})

router.post('/integration/validate', requireAdmin, async (_req, res) => {
  try {
    const result = await validateCvcrmConnection()
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Falha na validação com CVCRM.' })
  }
})

router.post('/integration/toggle-auto-sync', requireAdmin, async (req, res, next) => {
  const parsed = toggleAutoSyncSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetro enabled inválido.' })
    return
  }
  try {
    const enabled = await toggleCvcrmAutoSync(parsed.data.enabled)
    res.json({ auto_sync_enabled: enabled })
  } catch (error) {
    if (error instanceof Error && /Valide a API/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.post('/integration/test-protocol', async (req, res) => {
  const parsed = protocolSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um número de protocolo válido.' })
    return
  }
  try {
    const ticket = await fetchCvcrmTicketByProtocol(parsed.data.protocol)
    if (!ticket) {
      res.status(404).json({ error: `Protocolo "${parsed.data.protocol}" não encontrado na base do CVCRM.` })
      return
    }
    res.json({ found: true, ticket })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Erro ao consultar protocolo no CVCRM.' })
  }
})

router.post('/by-protocol', async (req, res) => {
  const parsed = protocolSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um número de protocolo válido.' })
    return
  }
  try {
    const result = await fetchAndImportCvcrmTicketByProtocol(parsed.data.protocol)
    res.status(201).json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Não foi possível importar o chamado.' })
  }
})

router.post('/import-csv', requireAdmin, async (req, res) => {
  const parsed = csvProtocolsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Lista de protocolos inválida ou vazia.' })
    return
  }
  try {
    const result = await importCvcrmProtocols(parsed.data.protocols)
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Falha ao importar protocolos do CSV.' })
  }
})

router.post('/sync', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await syncCvcrmTickets())
  } catch (error) {
    if (error instanceof Error && /CVCRM não configurado|sincronização CVCRM em andamento|Valide a API/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.post('/integration/import-all', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await importAllCvcrmTickets())
  } catch (error) {
    if (error instanceof Error && /CVCRM não configurado|Valide a paginação|sincronização CVCRM em andamento/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.get('/workflow', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT source_status_id AS id, name, position::double precision AS position,
              background_color, text_color, flags
       FROM ticket_workflow_stages
       WHERE name IS NOT NULL AND length(btrim(name)) > 0
       ORDER BY position, source_status_id`,
    )
    res.json({ stages: result.rows })
  } catch (error) {
    next(error)
  }
})

router.get('/tags', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id::text, name, color
       FROM ticket_tags ORDER BY lower(name), id`,
    )
    res.json({ tags: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/tags', requireAdmin, async (req, res, next) => {
  const parsed = ticketTagSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um nome e uma cor válidos para a tag.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; name: string; color: string }>(
      `INSERT INTO ticket_tags (name, color, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(btrim(name))) DO NOTHING
       RETURNING id::text, name, color`,
      [parsed.data.name, parsed.data.color, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'Já existe uma tag com esse nome.' })
      return
    }
    res.status(201).json({ tag: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.delete('/tags/:tagId', requireAdmin, async (req, res, next) => {
  const tagId = ticketIdSchema.safeParse(req.params.tagId)
  if (!tagId.success) {
    res.status(400).json({ error: 'Identificador de tag inválido.' })
    return
  }
  try {
    const result = await pool.query('DELETE FROM ticket_tags WHERE id = $1', [tagId.data])
    if (!result.rowCount) {
      res.status(404).json({ error: 'Tag não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.put('/:id/tags', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = ticketTagAssignmentSchema.safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: 'A lista de tags é inválida.' })
    return
  }
  const tagIds = [...new Set(parsed.data.tagIds)]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ticket = await client.query(
      'SELECT 1 FROM tickets WHERE source_id = $1 AND source_active = TRUE FOR UPDATE',
      [ticketId.data],
    )
    if (!ticket.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }
    if (tagIds.length) {
      const tags = await client.query('SELECT id FROM ticket_tags WHERE id = ANY($1::bigint[])', [tagIds])
      if (tags.rowCount !== tagIds.length) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Uma ou mais tags não existem.' })
        return
      }
    }
    await client.query('DELETE FROM ticket_tag_assignments WHERE ticket_id = $1', [ticketId.data])
    for (const tagId of tagIds) {
      await client.query(
        `INSERT INTO ticket_tag_assignments (ticket_id, tag_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [ticketId.data, tagId, req.session.user!.id],
      )
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/:id/cv-conversation', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  try {
    const result = await pool.query<{ cv_responses: unknown; cv_attachments: unknown }>(
      `SELECT cv_responses, cv_attachments
       FROM tickets WHERE source_id = $1`,
      [ticketId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Chamado não encontrado.' })
      return
    }
    res.json({
      messages: result.rows[0].cv_responses,
      attachments: result.rows[0].cv_attachments,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/filter-options', async (_req, res, next) => {
  const includeInactive = z.boolean().catch(false).parse(_req.query.includeInactive === 'true')
  const dashboardFromYear = _req.query.fromYear === undefined
    ? null
    : z.coerce.number().int().min(2000).max(2200).safeParse(_req.query.fromYear)
  const selectedEnterprises = parseRepeatedTextFilter(_req.originalUrl, 'enterprise', 240)
  const selectedBlocks = parseRepeatedTextFilter(_req.originalUrl, 'block', 120)
  if (selectedEnterprises === null || selectedBlocks === null || dashboardFromYear?.success === false) {
    res.status(400).json({ error: 'Um ou mais filtros de chamados são inválidos.' })
    return
  }
  try {
    if (dashboardFromYear?.success) {
      await ensureCvcrmSubjectCatalog()
    }
    const [enterprises, blocks, units, subjects, subsubjects, years, dashboardSubjects] = await Promise.all([
      pool.query<{ value: string }>(
        `SELECT min(btrim(enterprise)) AS value FROM tickets
         WHERE ($1::boolean OR source_active = TRUE) AND btrim(enterprise) <> ''
         GROUP BY lower(btrim(enterprise)) ORDER BY lower(min(btrim(enterprise)))`,
        [includeInactive],
      ),
      pool.query<{ value: string }>(
        `SELECT min(btrim(block)) AS value FROM tickets
         WHERE ($1::boolean OR source_active = TRUE) AND btrim(block) <> ''
           AND (cardinality($2::text[]) = 0 OR lower(btrim(enterprise)) = ANY($2::text[]))
         GROUP BY lower(btrim(block)) ORDER BY lower(min(btrim(block)))`,
        [includeInactive, selectedEnterprises],
      ),
      pool.query<{ value: string }>(
        `SELECT min(btrim(unit)) AS value FROM tickets
         WHERE ($1::boolean OR source_active = TRUE) AND btrim(unit) <> ''
           AND (cardinality($2::text[]) = 0 OR lower(btrim(enterprise)) = ANY($2::text[]))
           AND (cardinality($3::text[]) = 0 OR lower(btrim(block)) = ANY($3::text[]))
         GROUP BY lower(btrim(unit)) ORDER BY lower(min(btrim(unit)))`,
        [includeInactive, selectedEnterprises, selectedBlocks],
      ),
      pool.query<{ value: string }>(
        `SELECT CASE WHEN source_subject_id = 16 THEN 'Assistência Técnica' ELSE min(btrim(subject)) END AS value
         FROM tickets
         WHERE ($1::boolean OR source_active = TRUE) AND (source_subject_id = 16 OR btrim(subject) <> '')
         GROUP BY (source_subject_id = 16),
                  CASE WHEN source_subject_id = 16 THEN 'Assistência Técnica' ELSE lower(btrim(subject)) END
         ORDER BY value`,
        [includeInactive],
      ),
      pool.query<{ value: string }>(
        `SELECT min(btrim(subsubject)) AS value FROM tickets
         WHERE ($1::boolean OR source_active = TRUE) AND btrim(subsubject) <> ''
         GROUP BY lower(btrim(subsubject)) ORDER BY lower(min(btrim(subsubject)))`,
        [includeInactive],
      ),
      pool.query<{ value: number }>(
        `SELECT generate_series(
           GREATEST(
             2000,
             LEAST(
               COALESCE(
                 (SELECT min(extract(year FROM opened_at)::int) FROM tickets WHERE opened_at <= now()),
                 extract(year FROM now())::int
               ),
               extract(year FROM now())::int
             )
           ),
           extract(year FROM now())::int
         )::int AS value`,
      ),
      dashboardFromYear
        ? pool.query<{ value: string; label: string }>(
          `SELECT value, label
           FROM (
             SELECT 'id:' || catalog.source_subject_id::text AS value,
                    catalog.source_subject_id::text || ' - ' || catalog.name AS label
             FROM cvcrm_subject_catalog catalog
             WHERE EXISTS (
               SELECT 1
               FROM tickets t
               WHERE t.source_subject_id = catalog.source_subject_id
                 AND ($1::boolean OR t.source_active = TRUE)
                 AND t.opened_at >= make_date($2::int, 1, 1)
             )
             UNION ALL
             SELECT 'no-subject', 'Chamado sem assunto'
             WHERE EXISTS (
               SELECT 1
               FROM tickets t
               WHERE ($1::boolean OR t.source_active = TRUE)
                 AND t.opened_at >= make_date($2::int, 1, 1)
                 AND NOT EXISTS (
                   SELECT 1
                   FROM cvcrm_subject_catalog catalog
                   WHERE catalog.source_subject_id = t.source_subject_id
                 )
             )
           ) available_subjects
           ORDER BY lower(label), value`,
          [includeInactive, dashboardFromYear.data],
        )
        : Promise.resolve({ rows: [] as { value: string; label: string }[] }),
    ])
    res.json({
      enterprises: enterprises.rows.map((row) => row.value),
      blocks: blocks.rows.map((row) => row.value),
      units: units.rows.map((row) => row.value),
      subjects: subjects.rows.map((row) => row.value),
      subsubjects: subsubjects.rows.map((row) => row.value),
      years: years.rows.map((row) => row.value),
      dashboardSubjects: dashboardSubjects.rows,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/dashboard', async (req, res, next) => {
  const enterprises = parseRepeatedTextFilter(req.originalUrl, 'enterprise', 240)
  const blocks = parseRepeatedTextFilter(req.originalUrl, 'block', 120)
  const units = parseRepeatedTextFilter(req.originalUrl, 'unit', 120)
  const subjects = parseRepeatedTextFilter(req.originalUrl, 'subject', 240)
  const subsubjects = parseRepeatedTextFilter(req.originalUrl, 'subsubject', 240)
  const ticketTypes = parseRepeatedTextFilter(req.originalUrl, 'type', 20)
  const customer = z.string().trim().max(240).safeParse(req.query.customer ?? '')
  const fromYear = z.coerce.number().int().min(2000).max(2200).safeParse(req.query.fromYear ?? 2000)
  if ([enterprises, blocks, units, subjects, subsubjects, ticketTypes].some((filter) => filter === null) ||
      !customer.success || !fromYear.success ||
      (ticketTypes ?? []).some((type) => type !== 'client' && type !== 'condominium')) {
    res.status(400).json({ error: 'Um ou mais filtros do dashboard são inválidos.' })
    return
  }
  const selectedEnterprises = enterprises ?? []
  const selectedBlocks = blocks ?? []
  const selectedUnits = units ?? []
  const selectedSubjects = subjects ?? []
  const selectedSubsubjects = subsubjects ?? []
  const selectedTicketTypes = ticketTypes ?? []

  try {
    const result = await pool.query<{
      active_total: number
      created_this_month: number
      completed_this_month: number
      canceled_this_month: number
      balance_this_month: number
      average_days: number | null
      last_updated: Date | null
      active_by_enterprise: Array<{ enterprise: string; clients: number; condominiums: number; total: number }>
      status_summary: Array<{ enterprise: string; status: string; count: number }>
      months: Array<{ month: string; year: number; created: number; completed: number; canceled: number; balance: number }>
    }>(
      `WITH filtered AS (
         SELECT t.source_id, t.source_active, t.source_status_name, t.source_modified_at, t.opened_at,
                t.enterprise, t.block, t.unit, t.source_creator_name,
                CASE
                  WHEN btrim(t.block) <> '' AND btrim(t.unit) <> '' THEN 'client'
                  WHEN btrim(t.block) = '' AND btrim(t.unit) = '' AND btrim(t.enterprise) <> ''
                    AND strpos(lower(t.source_creator_name), lower(btrim(t.enterprise))) > 0 THEN 'condominium'
                  ELSE NULL
                END AS ticket_type
         FROM tickets t
         WHERE t.opened_at >= make_date($8::int, 1, 1)
           AND (cardinality($1::text[]) = 0 OR lower(btrim(t.enterprise)) = ANY($1::text[]))
           AND (cardinality($2::text[]) = 0 OR lower(btrim(t.block)) = ANY($2::text[]))
           AND (cardinality($3::text[]) = 0 OR lower(btrim(t.unit)) = ANY($3::text[]))
           AND ($4 = '' OR lower(t.customer_name) LIKE '%' || lower($4) || '%')
           AND (cardinality($5::text[]) = 0 OR
             (EXISTS (
               SELECT 1
               FROM cvcrm_subject_catalog catalog
               WHERE catalog.source_subject_id = t.source_subject_id
                 AND ('id:' || catalog.source_subject_id::text) = ANY($5::text[])
             )) OR
             ('no-subject' = ANY($5::text[]) AND NOT EXISTS (
               SELECT 1
               FROM cvcrm_subject_catalog catalog
               WHERE catalog.source_subject_id = t.source_subject_id
             )))
           AND (cardinality($6::text[]) = 0 OR lower(btrim(t.subsubject)) = ANY($6::text[]))
       ),
       selected_tickets AS (
         SELECT * FROM filtered
         WHERE ticket_type IS NOT NULL
           AND (cardinality($7::text[]) = 0 OR ticket_type = ANY($7::text[]))
       ),
       status_events AS (
         SELECT h.ticket_id,
                h.created_at AT TIME ZONE 'America/Sao_Paulo' AS event_at,
                lower(COALESCE(h.details->>'from', '')) ~ '(finalizad[oa]|cancelad[oa])' AS was_terminal,
                lower(COALESCE(h.details->>'to', '')) ~ '(finalizad[oa]|cancelad[oa])' AS is_terminal,
                lower(COALESCE(h.details->>'to', '')) ~ 'finalizad[oa]'
                  AND lower(COALESCE(h.details->>'to', '')) !~ 'cancelad[oa]' AS is_completed,
                lower(COALESCE(h.details->>'to', '')) ~ 'cancelad[oa]' AS is_canceled
         FROM ticket_activity_history h
         JOIN selected_tickets t ON t.source_id = h.ticket_id
         WHERE h.event_type = 'stage_changed'
           AND h.created_at >= make_date($8::int, 1, 1)
       ),
       snapshot_closures AS (
         SELECT t.source_id AS ticket_id,
                t.source_modified_at AS event_at,
                FALSE AS was_terminal,
                TRUE AS is_terminal,
                lower(t.source_status_name) ~ 'finalizad[oa]'
                  AND lower(t.source_status_name) !~ 'cancelad[oa]' AS is_completed,
                lower(t.source_status_name) ~ 'cancelad[oa]' AS is_canceled
         FROM selected_tickets t
         WHERE NOT t.source_active
           AND t.source_modified_at IS NOT NULL
           AND lower(t.source_status_name) ~ '(finalizad[oa]|cancelad[oa])'
           AND NOT EXISTS (
             SELECT 1 FROM status_events e
             WHERE e.ticket_id = t.source_id AND e.is_terminal AND NOT e.was_terminal
           )
       ),
       closures AS (
         SELECT * FROM status_events WHERE is_terminal AND NOT was_terminal
         UNION ALL
         SELECT * FROM snapshot_closures
       ),
       active_enterprises AS (
         SELECT COALESCE(NULLIF(btrim(enterprise), ''), 'Sem empreendimento') AS enterprise,
                count(*) FILTER (WHERE ticket_type = 'client')::int AS clients,
                count(*) FILTER (WHERE ticket_type = 'condominium')::int AS condominiums,
                count(*)::int AS total
         FROM selected_tickets
         WHERE source_active
         GROUP BY COALESCE(NULLIF(btrim(enterprise), ''), 'Sem empreendimento')
       ),
       status_counts AS (
         SELECT COALESCE(NULLIF(btrim(t.enterprise), ''), 'Sem empreendimento') AS enterprise,
                t.source_status_name AS status,
                count(*)::int AS count
         FROM selected_tickets t
         WHERE t.source_active
         GROUP BY COALESCE(NULLIF(btrim(t.enterprise), ''), 'Sem empreendimento'), t.source_status_name
       ),
       year_months AS (
         SELECT month_start::date
         FROM generate_series(
           make_date($8::int, 1, 1)::timestamp,
           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'),
           interval '1 month'
         ) AS months(month_start)
       ),
       monthly_flow AS (
         SELECT date_trunc('month', opened_at)::date AS month_start,
                count(*)::int AS created,
                0::int AS completed,
                0::int AS canceled
         FROM selected_tickets
         GROUP BY date_trunc('month', opened_at)::date
         UNION ALL
         SELECT date_trunc('month', event_at)::date,
                0, count(*) FILTER (WHERE is_completed)::int, count(*) FILTER (WHERE is_canceled)::int
         FROM closures
         GROUP BY date_trunc('month', event_at)::date
       ),
       monthly_totals AS (
         SELECT month_start, sum(created)::int AS created,
                sum(completed)::int AS completed, sum(canceled)::int AS canceled
         FROM monthly_flow GROUP BY month_start
       ),
       monthly_rows AS (
         SELECT m.month_start,
                COALESCE(f.created, 0)::int AS created,
                COALESCE(f.completed, 0)::int AS completed,
                COALESCE(f.canceled, 0)::int AS canceled,
                (COALESCE(f.created, 0) - COALESCE(f.completed, 0) - COALESCE(f.canceled, 0))::int AS balance
         FROM year_months m
         LEFT JOIN monthly_totals f USING (month_start)
       ),
       current_month AS (
         SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AS month_start
       )
       SELECT
         (SELECT count(*)::int FROM selected_tickets WHERE source_active) AS active_total,
         (SELECT count(*)::int FROM selected_tickets
          WHERE opened_at >= c.month_start AND opened_at < c.month_start + interval '1 month') AS created_this_month,
         (SELECT count(*)::int FROM closures
          WHERE is_completed AND event_at >= c.month_start AND event_at < c.month_start + interval '1 month') AS completed_this_month,
         (SELECT count(*)::int FROM closures
          WHERE is_canceled AND event_at >= c.month_start AND event_at < c.month_start + interval '1 month') AS canceled_this_month,
         ((SELECT count(*) FROM selected_tickets
           WHERE opened_at >= c.month_start AND opened_at < c.month_start + interval '1 month') -
          (SELECT count(*) FROM closures
           WHERE is_completed AND event_at >= c.month_start AND event_at < c.month_start + interval '1 month') -
          (SELECT count(*) FROM closures
           WHERE is_canceled AND event_at >= c.month_start AND event_at < c.month_start + interval '1 month'))::int AS balance_this_month,
         (SELECT avg(extract(epoch FROM (event_at - t.opened_at)) / 86400)::float
          FROM closures e JOIN selected_tickets t ON t.source_id = e.ticket_id
          WHERE e.is_completed AND t.opened_at IS NOT NULL AND e.event_at >= t.opened_at) AS average_days,
         (SELECT last_finished_at FROM ticket_sync_state WHERE id = 1) AS last_updated,
         COALESCE((SELECT json_agg(row_to_json(a) ORDER BY a.enterprise) FROM active_enterprises a), '[]'::json) AS active_by_enterprise,
         COALESCE((SELECT json_agg(row_to_json(s) ORDER BY s.enterprise, s.status) FROM status_counts s), '[]'::json) AS status_summary,
         COALESCE((SELECT json_agg(json_build_object(
             'month', to_char(month_start, 'YYYY-MM-DD'),
             'year', extract(year FROM month_start)::int,
             'created', created, 'completed', completed, 'canceled', canceled, 'balance', balance
           ) ORDER BY month_start) FROM monthly_rows), '[]'::json) AS months
       FROM current_month c`,
      [
        selectedEnterprises, selectedBlocks, selectedUnits, customer.data, selectedSubjects, selectedSubsubjects,
        selectedTicketTypes, fromYear.data,
      ],
    )
    res.json({ dashboard: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.get('/', async (req, res, next) => {
  const search = z.string().trim().max(100).catch('').parse(req.query.search)
  const idSearch = req.query.searchMode === 'id'
  const phoneDigits = search.replace(/\D/g, '')
  const phoneLookup = !idSearch && phoneDigits.length >= 3 && /^[\d\s()+.-]+$/.test(search)
  if (phoneLookup && !isPersonalDataEncryptionConfigured()) {
    res.status(503).json({ error: 'A busca por telefone exige a chave de criptografia de dados pessoais no servidor.' })
    return
  }
  const includeInactive = z.boolean().catch(false).parse(req.query.includeInactive === 'true')
  const selectedEnterprises = parseTextFilter(req.query.enterprise, 240)
  const selectedBlocks = parseTextFilter(req.query.block, 120)
  const selectedUnits = parseTextFilter(req.query.unit, 120)
  const selectedSubjects = parseTextFilter(req.query.subject, 240)
  const selectedSubsubjects = parseTextFilter(req.query.subsubject, 240)
  const ticketTypes = parseRepeatedTextFilter(req.originalUrl, 'type', 20)
  if (
    selectedEnterprises === null ||
    selectedBlocks === null ||
    selectedUnits === null ||
    selectedSubjects === null ||
    selectedSubsubjects === null ||
    ticketTypes === null ||
    ticketTypes.some((type) => type !== 'client' && type !== 'condominium')
  ) {
    res.status(400).json({ error: 'Um ou mais filtros de chamados são inválidos.' })
    return
  }
  const customerName = z.string().trim().max(160).catch('').parse(req.query.customerName)
  const requestedId = req.query.id === undefined
    ? null
    : ticketIdSchema.safeParse(req.query.id)
  if (requestedId && !requestedId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  const term = search ? `%${search.toLowerCase()}%` : ''
  const customerTerm = customerName ? `%${customerName.toLowerCase()}%` : ''

  try {
    const result = await pool.query<{
      source_id: string
      protocol: string
      source_active: boolean
      source_status_id: number | null
      source_status_name: string
      source_modified_at: Date | null
      opened_at: Date | null
      opened_date: string | null
      source_subject_id: number | null
      source_subsubject_id: number | null
      delivery_date: string | null
      warranty_years: number | null
      customer_name: string
      customer_phone_ciphertext: string | null
      subject: string
      subsubject: string
      description: string
      enterprise: string
      block: string
      unit: string
      source_creator_name: string
      priority: string
      local_due_at: Date | null
      estimated_cost: string | null
      actual_cost: string | null
      background_color: string | null
      text_color: string | null
      comment_count: number
      subtask_count: number
      completed_subtask_count: number
      programming_count: number
      custom_tags: Array<{ id: string; name: string; color: string }>
    }>(
      `SELECT t.source_id, t.protocol, t.source_active, t.source_status_id, t.source_status_name,
              t.source_modified_at, t.opened_at, t.opened_at::date::text AS opened_date,
              t.source_subject_id, t.source_subsubject_id,
              ei.condominium_delivery_date::text AS delivery_date, warranty.warranty_years,
              t.customer_name, t.customer_phone_ciphertext,
              t.subject, t.subsubject, t.description, t.enterprise, t.block, t.unit, t.source_creator_name, t.priority,
              t.local_due_at, t.estimated_cost::text, t.actual_cost::text,
              s.background_color, s.text_color,
              (SELECT count(*)::int FROM ticket_comments c WHERE c.ticket_id = t.source_id) AS comment_count,
              (SELECT count(*)::int FROM ticket_subtasks st WHERE st.ticket_id = t.source_id) AS subtask_count,
              (SELECT count(*)::int FROM ticket_subtasks st WHERE st.ticket_id = t.source_id AND st.is_done) AS completed_subtask_count,
              (SELECT count(*)::int FROM ticket_programming p WHERE p.ticket_id = t.source_id) AS programming_count,
              COALESCE((
                SELECT json_agg(json_build_object('id', tag.id::text, 'name', tag.name, 'color', tag.color) ORDER BY lower(tag.name))
                FROM ticket_tag_assignments assigned
                JOIN ticket_tags tag ON tag.id = assigned.tag_id
                WHERE assigned.ticket_id = t.source_id
              ), '[]'::json) AS custom_tags
       FROM tickets t
       LEFT JOIN ticket_workflow_stages s ON s.source_status_id = t.source_status_id
       LEFT JOIN enterprise_information ei ON ei.enterprise_key = lower(btrim(t.enterprise))
       LEFT JOIN LATERAL (
         SELECT w.warranty_years
         FROM warranty_subsubjects w
         WHERE w.source_subject_id = COALESCE(t.source_subject_id, 16)
           AND (
             (t.source_subsubject_id IS NOT NULL AND w.source_subsubject_id = t.source_subsubject_id)
             OR (t.source_subsubject_id IS NULL AND lower(w.name) = lower(t.subsubject))
           )
         ORDER BY CASE WHEN w.source_subsubject_id = t.source_subsubject_id THEN 0 ELSE 1 END
         LIMIT 1
       ) warranty ON TRUE
       WHERE ($9::boolean OR t.source_active = TRUE)
         AND ($1 = '' OR lower(t.protocol) LIKE $1 OR lower(t.customer_name) LIKE $1
           OR lower(t.enterprise) LIKE $1 OR lower(t.subject) LIKE $1 OR lower(t.subsubject) LIKE $1
           OR t.source_id::text LIKE $1
           OR $10::boolean)
         AND ($13 <> 'id' OR t.source_id::text LIKE $1 OR lower(t.protocol) LIKE $1)
         AND (cardinality($11::text[]) = 0 OR
           CASE
             WHEN btrim(t.block) <> '' AND btrim(t.unit) <> '' THEN 'client'
             WHEN btrim(t.block) = '' AND btrim(t.unit) = '' AND btrim(t.enterprise) <> ''
               AND strpos(lower(t.source_creator_name), lower(btrim(t.enterprise))) > 0 THEN 'condominium'
             ELSE NULL
           END = ANY($11::text[]))
         AND (cardinality($2::text[]) = 0 OR lower(btrim(t.enterprise)) = ANY($2::text[]))
         AND (cardinality($3::text[]) = 0 OR lower(btrim(t.block)) = ANY($3::text[]))
         AND (cardinality($4::text[]) = 0 OR lower(btrim(t.unit)) = ANY($4::text[]))
         AND ($5 = '' OR lower(t.customer_name) LIKE $5)
         AND (cardinality($6::text[]) = 0 OR (t.source_subject_id = 16 AND 'assistência técnica' = ANY($6::text[]))
           OR lower(btrim(t.subject)) = ANY($6::text[]))
         AND (cardinality($7::text[]) = 0 OR lower(btrim(t.subsubject)) = ANY($7::text[]))
         AND ($8::bigint IS NULL OR t.source_id = $8)
       ORDER BY CASE WHEN $12 <> '' AND t.source_id::text = $12 THEN 0 ELSE 1 END,
                t.opened_at ASC NULLS LAST, t.protocol
       LIMIT CASE WHEN $10::boolean THEN 2147483647 ELSE 1000 END`,
      [
        term, selectedEnterprises, selectedBlocks, selectedUnits, customerTerm, selectedSubjects, selectedSubsubjects,
        requestedId?.success ? requestedId.data : null,
        includeInactive,
        phoneLookup,
        ticketTypes,
        search,
        idSearch ? 'id' : '',
      ],
    )

    const matchedTickets = phoneLookup
      ? result.rows.filter((ticket) => {
        const matchesText = [ticket.source_id, ticket.protocol, ticket.customer_name, ticket.enterprise, ticket.subject, ticket.subsubject]
          .some((value) => value.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
        const matchesPhone = ticket.customer_phone_ciphertext
          ? decryptPersonalData(ticket.customer_phone_ciphertext, 'ticket-phone').replace(/\D/g, '').includes(phoneDigits)
          : false
        return matchesText || matchesPhone
        })
      : result.rows

    res.json({
      tickets: matchedTickets.map((ticket) => ({
        id: ticket.source_id,
        protocol: ticket.protocol,
        statusId: ticket.source_status_id,
        status: ticket.source_status_name,
        sourceActive: ticket.source_active,
        sourceModifiedAt: ticket.source_modified_at,
        openedAt: ticket.opened_at,
        openSeconds: ticket.opened_at ? Math.max(0, Math.floor((Date.now() - ticket.opened_at.valueOf()) / 1000)) : null,
        customerName: ticket.customer_name,
        customerPhone: ticket.customer_phone_ciphertext && isPersonalDataEncryptionConfigured()
          ? decryptPersonalData(ticket.customer_phone_ciphertext, 'ticket-phone')
          : null,
        subject: ticket.source_subject_id === 16 ? 'Assistência Técnica' : ticket.subject,
        subsubject: ticket.subsubject,
        warranty: evaluateTicketWarranty({
          subjectId: ticket.source_subject_id,
          subject: ticket.subject,
          openedDate: ticket.opened_date,
          deliveryDate: ticket.delivery_date,
          warrantyYears: ticket.warranty_years === null ? null : Number(ticket.warranty_years),
        }),
        description: ticket.description,
        enterprise: ticket.enterprise,
        block: ticket.block,
        unit: ticket.unit,
        tags: [
          ...(ticket.block.trim() && ticket.unit.trim()
            ? [{ id: 'system-client', name: 'Cliente', color: '#3178a8' }]
            : !ticket.block.trim() && !ticket.unit.trim() && ticket.enterprise.trim() &&
                ticket.source_creator_name.toLocaleLowerCase('pt-BR').includes(ticket.enterprise.toLocaleLowerCase('pt-BR'))
              ? [{ id: 'system-condominium', name: 'Condomínio', color: '#7862a8' }]
              : []),
          ...ticket.custom_tags,
        ],
        priority: ticket.priority,
        localDueAt: ticket.local_due_at,
        estimatedCost: ticket.estimated_cost,
        actualCost: ticket.actual_cost,
        backgroundColor: ticket.background_color,
        textColor: ticket.text_color,
        commentCount: ticket.comment_count,
        subtaskCount: ticket.subtask_count,
        completedSubtaskCount: ticket.completed_subtask_count,
        programmingCount: ticket.programming_count,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/completion-terms', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.ticket_id, a.file_name, a.file_size, a.created_at, a.uploaded_by,
              COALESCE(u.display_name, 'Usuário removido') AS uploaded_by_name
       FROM ticket_attachments a
       JOIN tickets t ON t.source_id = a.ticket_id
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.file_name LIKE 'termo-finalizacao-%' AND a.content_type = 'application/pdf'
       ORDER BY a.created_at DESC, a.id`,
    )
    res.json({ terms: result.rows })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/management', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = managementSchema.safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: 'Prazo ou custos inválidos.' })
    return
  }

  try {
    const result = await pool.query(
      `UPDATE tickets SET local_due_at = $1, estimated_cost = $2, actual_cost = $3, updated_at = now()
       WHERE source_id = $4 AND source_active = TRUE RETURNING source_id`,
      [parsed.data.localDueAt, parsed.data.estimatedCost, parsed.data.actualCost, ticketId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/:id/comments', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }

  try {
    const result = await pool.query<{
      id: string
      body: string
      created_at: Date
      updated_at: Date
      parent_comment_id: string | null
      author_id: string
      author_name: string
      mentions: Array<{ id: string; name: string; email: string }>
    }>(
      `SELECT c.id, c.body, c.created_at, c.updated_at, c.parent_comment_id,
              u.id AS author_id, u.display_name AS author_name,
              COALESCE((
                SELECT json_agg(json_build_object('id', mentioned.id, 'name', mentioned.display_name, 'email', mentioned.email))
                FROM ticket_comment_mentions cm
                JOIN users mentioned ON mentioned.id = cm.user_id
                WHERE cm.comment_id = c.id
              ), '[]'::json) AS mentions
       FROM ticket_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.ticket_id = $1
       ORDER BY c.created_at, c.id`,
      [ticketId.data],
    )
    res.json({ comments: result.rows })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/history', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `SELECT h.id, h.event_type, h.summary, h.details, h.created_at,
              COALESCE(u.display_name, 'Sistema CVCRM') AS actor_name
       FROM ticket_activity_history h
       LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.ticket_id = $1
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 100`,
      [ticketId.data],
    )
    res.json({ history: result.rows })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/attachments', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `SELECT a.id, a.file_name, a.content_type, a.file_size, a.created_at,
              COALESCE(u.display_name, 'Usuário removido') AS uploaded_by_name
       FROM ticket_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ticket_id = $1
       ORDER BY a.created_at, a.id`,
      [ticketId.data],
    )
    res.json({ attachments: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/attachments', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = z.object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(150),
    contentBase64: z.string().min(4).max(7_000_000),
  }).safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: 'Arquivo inválido ou maior que o limite permitido.' })
    return
  }

  const safeName = parsed.data.fileName.replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
  const contentType = parsed.data.contentType.toLowerCase()
  const allowedTypes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/zip',
    'application/octet-stream',
  ])
  const content = Buffer.from(parsed.data.contentBase64, 'base64')
  if (!safeName || !allowedTypes.has(contentType) || content.length === 0 ||
      content.length > 5 * 1024 * 1024 ||
      content.toString('base64') !== parsed.data.contentBase64) {
    res.status(400).json({ error: 'Tipo de arquivo não permitido ou arquivo maior que 5 MiB.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ticket = await client.query<{ protocol: string }>(
      'SELECT protocol FROM tickets WHERE source_id = $1 AND source_active = TRUE FOR UPDATE',
      [ticketId.data],
    )
    if (!ticket.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ticket_attachments
         (ticket_id, uploaded_by, file_name, content_type, file_size, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [ticketId.data, req.session.user!.id, safeName, contentType, content.length, content],
    )
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'attachment_added', `Anexou o arquivo "${safeName}".`, {
      attachmentId: inserted.rows[0].id,
      fileName: safeName,
      fileSize: content.length,
    })
    await client.query('COMMIT')
    res.status(201).json({ id: inserted.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/:id/attachments/:attachmentId', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const attachmentId = ticketIdSchema.safeParse(req.params.attachmentId)
  if (!ticketId.success || !attachmentId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  try {
    const result = await pool.query<{
      file_name: string
      content_type: string
      content: Buffer
    }>(
      `SELECT file_name, content_type, content FROM ticket_attachments
       WHERE id = $1 AND ticket_id = $2`,
      [attachmentId.data, ticketId.data],
    )
    const attachment = result.rows[0]
    if (!attachment) {
      res.status(404).json({ error: 'Anexo não encontrado.' })
      return
    }
    const asciiName = attachment.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    res.setHeader('Content-Type', attachment.content_type)
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(attachment.content)
  } catch (error) {
    next(error)
  }
})

router.post('/:id/completion-terms', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = z.object({
    contentBase64: z.string().min(8).max(7_000_000),
  }).safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: 'Termo inválido ou maior que o limite permitido.' })
    return
  }

  const content = Buffer.from(parsed.data.contentBase64, 'base64')
  if (content.length === 0 || content.length > 5 * 1024 * 1024 ||
      content.toString('base64') !== parsed.data.contentBase64 ||
      content.subarray(0, 5).toString('ascii') !== '%PDF-') {
    res.status(400).json({ error: 'O termo precisa ser um PDF válido de até 5 MiB.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ticket = await client.query<{ protocol: string }>(
      'SELECT protocol FROM tickets WHERE source_id = $1 AND source_active = TRUE FOR UPDATE',
      [ticketId.data],
    )
    if (!ticket.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }
    const protocol = ticket.rows[0].protocol.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 100)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `termo-finalizacao-${protocol}-${timestamp}.pdf`
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ticket_attachments
         (ticket_id, uploaded_by, file_name, content_type, file_size, content)
       VALUES ($1, $2, $3, 'application/pdf', $4, $5)
       RETURNING id`,
      [ticketId.data, req.session.user!.id, fileName, content.length, content],
    )
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'completion_term_added', `Salvou o termo de finalização "${fileName}".`, {
      attachmentId: inserted.rows[0].id,
      fileName,
      fileSize: content.length,
    })
    await client.query('COMMIT')
    res.status(201).json({ id: inserted.rows[0].id, fileName })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.delete('/:id/completion-terms/:attachmentId', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const attachmentId = ticketIdSchema.safeParse(req.params.attachmentId)
  if (!ticketId.success || !attachmentId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      file_name: string
      uploaded_by: number | null
    }>(
      `SELECT file_name, uploaded_by
       FROM ticket_attachments
       WHERE id = $1 AND ticket_id = $2 AND content_type = 'application/pdf'
         AND file_name LIKE 'termo-finalizacao-%'
       FOR UPDATE`,
      [attachmentId.data, ticketId.data],
    )
    const term = result.rows[0]
    if (!term) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Termo de finalização não encontrado.' })
      return
    }
    if (String(term.uploaded_by) !== String(req.session.user!.id) && req.session.user!.role !== 'admin') {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Somente quem salvou o termo ou a administração pode excluí-lo.' })
      return
    }
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'completion_term_deleted', `Excluiu o termo de finalização "${term.file_name}".`, {
      attachmentId: attachmentId.data,
      fileName: term.file_name,
    })
    await client.query('DELETE FROM ticket_attachments WHERE id = $1', [attachmentId.data])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.post('/:id/comments', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = commentSchema.safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ticket = await client.query<{ protocol: string }>(
      'SELECT protocol FROM tickets WHERE source_id = $1 AND source_active = TRUE',
      [ticketId.data],
    )
    if (!ticket.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }

    const mentions = [...new Set(parsed.data.mentionIds)]
    if (mentions.length) {
      const mentionedUsers = await client.query(
        `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND status = 'active'`,
        [mentions],
      )
      if (mentionedUsers.rowCount !== mentions.length) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Uma ou mais pessoas mencionadas não estão ativas.' })
        return
      }
    }

    if (parsed.data.parentCommentId) {
      const parent = await client.query(
        'SELECT id FROM ticket_comments WHERE id = $1 AND ticket_id = $2 FOR UPDATE',
        [parsed.data.parentCommentId, ticketId.data],
      )
      if (!parent.rowCount) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Comentário respondido não encontrado neste chamado.' })
        return
      }
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, parent_comment_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ticketId.data, req.session.user!.id, parsed.data.body, parsed.data.parentCommentId],
    )
    for (const mentionId of mentions) {
      await client.query(
        'INSERT INTO ticket_comment_mentions (comment_id, user_id) VALUES ($1, $2)',
        [inserted.rows[0].id, mentionId],
      )
    }
    await recordTicketActivity(
      client,
      ticketId.data,
      req.session.user!.id,
      parsed.data.parentCommentId ? 'comment_reply' : 'comment_added',
      parsed.data.parentCommentId ? 'Respondeu a um comentário.' : 'Adicionou um comentário.',
      { commentId: inserted.rows[0].id, mentionCount: mentions.length },
    )

    if (parsed.data.parentCommentId) {
      const recipients = await client.query<{ user_id: string }>(
        `SELECT user_id FROM ticket_comment_mentions WHERE comment_id = $1
         UNION
         SELECT author_id AS user_id FROM ticket_comments WHERE id = $1`,
        [parsed.data.parentCommentId],
      )
      for (const recipient of recipients.rows) {
        if (recipient.user_id === String(req.session.user!.id)) continue
        await client.query(
          `INSERT INTO user_notifications (user_id, ticket_id, comment_id, kind, message)
           SELECT $1, $2, $3, 'mention_reply', $4
           WHERE EXISTS (SELECT 1 FROM users WHERE id = $1 AND status = 'active')`,
          [
            recipient.user_id,
            ticketId.data,
            inserted.rows[0].id,
            `Nova resposta no protocolo ${ticket.rows[0].protocol}.`,
          ],
        )
      }
    }
    for (const mentionId of mentions) {
      if (mentionId === req.session.user!.id) continue
      await client.query(
        `INSERT INTO user_notifications (user_id, ticket_id, comment_id, kind, message)
         VALUES ($1, $2, $3, 'mention', $4)`,
        [
          mentionId,
          ticketId.data,
          inserted.rows[0].id,
          `Você foi mencionado no protocolo ${ticket.rows[0].protocol}.`,
        ],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ id: inserted.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/comments/:commentId', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const commentId = ticketIdSchema.safeParse(req.params.commentId)
  const parsed = z.object({ body: z.string().trim().min(1).max(6000) }).safeParse(req.body)
  if (!ticketId.success || !commentId.success || !parsed.success) {
    res.status(400).json({ error: 'Comentário inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ author_id: string }>(
      'SELECT author_id FROM ticket_comments WHERE id = $1 AND ticket_id = $2 FOR UPDATE',
      [commentId.data, ticketId.data],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    if (existing.rows[0].author_id !== String(req.session.user!.id) && req.session.user!.role !== 'admin') {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Somente quem escreveu o comentário ou a administração pode editá-lo.' })
      return
    }
    await client.query(
      'UPDATE ticket_comments SET body = $1, updated_at = now() WHERE id = $2',
      [parsed.data.body, commentId.data],
    )
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'comment_edited', 'Editou um comentário.', {
      commentId: commentId.data,
    })
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const commentId = ticketIdSchema.safeParse(req.params.commentId)
  if (!ticketId.success || !commentId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{ author_id: string }>(
      'SELECT author_id FROM ticket_comments WHERE id = $1 AND ticket_id = $2 FOR UPDATE',
      [commentId.data, ticketId.data],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    if (existing.rows[0].author_id !== String(req.session.user!.id) && req.session.user!.role !== 'admin') {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'Somente quem escreveu o comentário ou a administração pode excluí-lo.' })
      return
    }
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'comment_deleted', 'Excluiu um comentário.', {
      commentId: commentId.data,
    })
    await client.query('DELETE FROM ticket_comments WHERE id = $1', [commentId.data])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/:id/subtasks', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `SELECT st.id, st.title, st.assigned_to, st.due_at, st.is_done, st.created_at,
              u.display_name AS assignee_name
       FROM ticket_subtasks st LEFT JOIN users u ON u.id = st.assigned_to
       WHERE st.ticket_id = $1 ORDER BY st.created_at, st.id`,
      [ticketId.data],
    )
    res.json({ subtasks: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/subtasks', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const parsed = subtaskSchema.safeParse(req.body)
  if (!ticketId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string }>(
      `INSERT INTO ticket_subtasks (ticket_id, title, assigned_to, due_at, created_by)
       SELECT $1, $2, $3, $4, $5 WHERE EXISTS (
         SELECT 1 FROM tickets WHERE source_id = $1 AND source_active = TRUE
       ) RETURNING id`,
      [ticketId.data, parsed.data.title, parsed.data.assignedTo, parsed.data.dueAt, req.session.user!.id],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Chamado ativo não encontrado.' })
      return
    }
    await recordTicketActivity(client, ticketId.data, req.session.user!.id, 'subtask_added', `Criou a subtarefa "${parsed.data.title}".`, {
      subtaskId: result.rows[0].id,
      title: parsed.data.title,
    })
    await client.query('COMMIT')
    res.status(201).json({ id: result.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/subtasks/:subtaskId', async (req, res, next) => {
  const ticketId = ticketIdSchema.safeParse(req.params.id)
  const subtaskId = ticketIdSchema.safeParse(req.params.subtaskId)
  const isDone = z.boolean().safeParse(req.body?.isDone)
  if (!ticketId.success || !subtaskId.success || !isDone.success) {
    res.status(400).json({ error: 'Atualização de subtarefa inválida.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ title: string; is_done: boolean }>(
      `UPDATE ticket_subtasks SET is_done = $1, updated_at = now()
       WHERE id = $2 AND ticket_id = $3 RETURNING title, is_done`,
      [isDone.data, subtaskId.data, ticketId.data],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Subtarefa não encontrada.' })
      return
    }
    await recordTicketActivity(
      client,
      ticketId.data,
      req.session.user!.id,
      'subtask_updated',
      `${result.rows[0].is_done ? 'Concluiu' : 'Reabriu'} a subtarefa "${result.rows[0].title}".`,
      { subtaskId: subtaskId.data, isDone: result.rows[0].is_done },
    )
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

export default router