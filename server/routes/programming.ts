import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { APP_TIMEZONE } from '../config.js'
import { pool } from '../db.js'
import { recordAuditLog } from '../services/audit-log.js'
import { getWhatsAppSettings, sendWhatsAppPdfDocument } from '../services/evolution-api.js'
import { decryptPersonalData } from '../services/personal-data.js'
import { fetchDailyProgrammingData, generateSchedulePdf } from '../services/schedule-pdf.js'
import { recordTicketActivity } from '../services/ticket-activity.js'
import { getTodayDateString } from '../services/working-days.js'

const router = Router()
const programmingTimeZone = APP_TIMEZONE

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const datetimeSchema = z.string().datetime({ offset: true })
const programmingTypeSchema = z.enum(['general', 'foreman']).default('general')
const programmingDetailsSchema = z.object({
  enterprise: z.string().trim().max(240),
  block: z.string().trim().max(120),
  unit: z.string().trim().max(120),
  commonAreaLocation: z.string().trim().max(240),
  materials: z.array(z.string().trim().min(1).max(120)).max(50),
  equipment: z.array(z.string().trim().min(1).max(120)).max(50),
  tools: z.array(z.string().trim().min(1).max(120)).max(50),
})

function isValidDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function datesInRange(startDate: string, endDate: string) {
  const dates: string[] = []
  const date = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (date <= end) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return dates
}

function isRangeWithinLimit(startDate: string, endDate: string) {
  if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) return false
  const elapsedDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
  return elapsedDays < 90
}

const occurrenceSchema = z.object({
  date: dateSchema,
  startsAt: datetimeSchema,
  endsAt: datetimeSchema,
}).refine((entry) => isValidDate(entry.date) &&
  datesInRange(entry.date, entry.date).length === 1 &&
  new Date(entry.endsAt) > new Date(entry.startsAt), {
  path: ['endsAt'],
  message: 'Informe um dia útil válido e um horário final posterior ao inicial.',
})

const programmingSchema = z.object({
  programmingType: programmingTypeSchema,
  activityType: z.enum(['ticket', 'standalone', 'legal_process']).default('ticket'),
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  legalProcessId: z.coerce.number().int().positive().nullable().optional(),
  collaboratorIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  startDate: dateSchema,
  endDate: dateSchema,
  occurrences: z.array(occurrenceSchema).min(1).max(65),
  activityDescription: z.string().trim().min(1).max(3000),
  standaloneLocation: z.string().trim().max(500).default(''),
  isFinalization: z.boolean().default(false),
  completionTermDelivered: z.boolean().default(false),
}).merge(programmingDetailsSchema).superRefine((entry, context) => {
  if (entry.activityType === 'ticket' &&
    (!entry.ticketId || entry.legalProcessId || !entry.enterprise ||
      !(entry.commonAreaLocation || (entry.block && entry.unit)))) {
    context.addIssue({ code: 'custom', path: ['ticketId'], message: 'Selecione um chamado e informe o empreendimento e a unidade ou área comum.' })
  }
  if (entry.activityType === 'standalone' &&
    (entry.ticketId || entry.legalProcessId || !entry.standaloneLocation)) {
    context.addIssue({ code: 'custom', path: ['standaloneLocation'], message: 'Descreva o local da atividade avulsa.' })
  }
  if (entry.activityType === 'legal_process' &&
    (!entry.legalProcessId || entry.ticketId || entry.standaloneLocation)) {
    context.addIssue({ code: 'custom', path: ['legalProcessId'], message: 'Selecione um processo jurídico válido.' })
  }
  if (!isRangeWithinLimit(entry.startDate, entry.endDate)) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'O intervalo deve ter no máximo 90 dias corridos.' })
    return
  }
  const expectedDates = datesInRange(entry.startDate, entry.endDate)
  const occurrenceDates = entry.occurrences.map((occurrence) => occurrence.date)
  if (!expectedDates.length || expectedDates.join(',') !== occurrenceDates.join(',')) {
    context.addIssue({ code: 'custom', path: ['occurrences'], message: 'Inclua exatamente uma programação para cada dia útil do intervalo.' })
  }
})
const singleProgrammingSchema = z.object({
  programmingType: programmingTypeSchema,
  activityType: z.enum(['ticket', 'standalone', 'legal_process']).default('ticket'),
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  legalProcessId: z.coerce.number().int().positive().nullable().optional(),
  collaboratorId: z.coerce.number().int().positive(),
  date: dateSchema,
  startsAt: datetimeSchema,
  endsAt: datetimeSchema,
  activityDescription: z.string().trim().min(1).max(3000),
  standaloneLocation: z.string().trim().max(500).default(''),
  isFinalization: z.boolean().default(false),
  completionTermDelivered: z.boolean().default(false),
}).merge(programmingDetailsSchema).superRefine((entry, context) => {
  if (!isValidDate(entry.date) || datesInRange(entry.date, entry.date).length !== 1 || new Date(entry.endsAt) <= new Date(entry.startsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'Informe um dia útil e um horário final posterior ao inicial.' })
  }
  if (entry.activityType === 'ticket' &&
    (!entry.ticketId || entry.legalProcessId || !entry.enterprise ||
      !(entry.commonAreaLocation || (entry.block && entry.unit)))) {
    context.addIssue({ code: 'custom', path: ['ticketId'], message: 'Selecione um chamado e informe o empreendimento e a unidade ou área comum.' })
  }
  if (entry.activityType === 'standalone' &&
    (entry.ticketId || entry.legalProcessId || !entry.standaloneLocation)) {
    context.addIssue({ code: 'custom', path: ['standaloneLocation'], message: 'Descreva o local da atividade avulsa.' })
  }
  if (entry.activityType === 'legal_process' &&
    (!entry.legalProcessId || entry.ticketId || entry.standaloneLocation)) {
    context.addIssue({ code: 'custom', path: ['legalProcessId'], message: 'Selecione um processo jurídico válido.' })
  }
})

router.use(requireAuth)
router.use((req, res, next) => {
  const user = req.session.user
  if (user?.role === 'admin') {
    next()
    return
  }
  pool.query<{ page_key: string }>(
    `SELECT page_key FROM user_page_access
     WHERE user_id = $1 AND page_key IN ('schedule', 'legal-processes')`,
    [user?.id],
  ).then(async (result) => {
    const hasScheduleAccess = result.rows.some((row) => row.page_key === 'schedule')
    const hasLegalAccess = result.rows.some((row) => row.page_key === 'legal-processes')
    if (hasScheduleAccess) {
      next()
      return
    }
    const legalReadPath = req.method === 'GET' &&
      ['/legal-processes', '/collaborators', '/availability'].includes(req.path)
    const legalCreate = req.method === 'POST' && req.path === '/' && req.body?.activityType === 'legal_process'
    if (hasLegalAccess && (legalReadPath || legalCreate)) {
      next()
      return
    }
    if (hasLegalAccess && req.method === 'PUT' && req.body?.activityType === 'legal_process') {
      const programmingId = z.coerce.number().int().positive().safeParse(req.path.split('/')[1])
      if (programmingId.success) {
        const existing = await pool.query(
          'SELECT 1 FROM ticket_programming WHERE id = $1 AND legal_process_id IS NOT NULL',
          [programmingId.data],
        )
        if (existing.rowCount) {
          next()
          return
        }
      }
    }
    res.status(403).json({ error: 'Você não tem acesso à programação solicitada.' })
  }).catch(next)
})

router.get('/collaborators', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id::text AS id, c.name, c.nickname, c.role, r.label AS role_label,
              TRUE AS is_active, c.is_on_leave
       FROM collaborators c
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE c.termination_date IS NULL OR c.termination_date > CURRENT_DATE
       ORDER BY lower(c.name), c.id`,
    )
    res.json({ collaborators: result.rows })
  } catch (error) {
    next(error)
  }
})

router.get('/foremen', requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: string
      name: string
      nickname: string
      phone_ciphertext: string | null
    }>(
      `SELECT c.id::text AS id, c.name, c.nickname, c.phone_ciphertext
       FROM collaborators c
       WHERE (c.termination_date IS NULL OR c.termination_date > CURRENT_DATE)
         AND c.role = 'encarregado'
       ORDER BY lower(c.name), c.id`,
    )

    const foremen = result.rows.map((row) => {
      let phone = ''
      if (row.phone_ciphertext) {
        try {
          phone = decryptPersonalData(row.phone_ciphertext, 'phone')
        } catch {
          phone = ''
        }
      }
      return {
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        phone,
      }
    })

    res.json({ foremen })
  } catch (error) {
    next(error)
  }
})

router.get('/role-visibility', async (_req, res, next) => {
  try {
    const result = await pool.query<{ setting_value: string[]; updated_at: Date }>(
      `SELECT setting_value, updated_at
       FROM application_settings
       WHERE setting_key = 'programming_hidden_roles'`,
    )
    res.json({
      hiddenRoleKeys: result.rows[0]?.setting_value ?? [],
      updatedAt: result.rows[0]?.updated_at ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.put('/role-visibility', requireAdmin, async (req, res, next) => {
  const parsed = z.object({
    hiddenRoleKeys: z.array(z.string().min(1).max(80)).max(100),
  }).safeParse(req.body)
  if (!parsed.success || new Set(parsed.data.hiddenRoleKeys).size !== parsed.data.hiddenRoleKeys.length) {
    res.status(400).json({ error: 'A lista de funções ocultas é inválida ou contém valores repetidos.' })
    return
  }

  try {
    const roles = await pool.query<{ role_key: string }>(
      'SELECT role_key FROM collaborator_roles WHERE role_key = ANY($1::text[])',
      [parsed.data.hiddenRoleKeys],
    )
    if (roles.rowCount !== parsed.data.hiddenRoleKeys.length) {
      res.status(400).json({ error: 'Uma ou mais funções selecionadas não existem.' })
      return
    }
    const result = await pool.query<{ setting_value: string[]; updated_at: Date }>(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('programming_hidden_roles', $1::jsonb, now(), $2)
       ON CONFLICT (setting_key) DO UPDATE
         SET setting_value = EXCLUDED.setting_value,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by
       RETURNING setting_value, updated_at`,
      [JSON.stringify(parsed.data.hiddenRoleKeys), req.session.user!.id],
    )
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'programming_role_visibility_updated',
      resourceType: 'application_setting',
      resourceId: 'programming_hidden_roles',
      summary: `Visibilidade global de cargos da programação atualizada (${parsed.data.hiddenRoleKeys.length} ocultos)`,
      metadata: { hiddenRoleKeys: parsed.data.hiddenRoleKeys },
    })
    res.json({
      hiddenRoleKeys: result.rows[0].setting_value,
      updatedAt: result.rows[0].updated_at,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/legal-processes', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id::text AS id, p.title, p.process_number,
              COALESCE(enterprise.enterprise_name, p.enterprise_key, '') AS enterprise_name,
              p.claimant,
              COALESCE((
                SELECT array_agg(c.process_number ORDER BY c.position, c.id)
                FROM legal_process_children c
                WHERE c.process_id = p.id AND btrim(c.process_number) <> ''
              ), ARRAY[]::text[]) AS child_process_numbers
       FROM legal_processes p
       LEFT JOIN LATERAL (
         SELECT min(source.enterprise_name) AS enterprise_name
         FROM (
           SELECT btrim(t.enterprise) AS enterprise_name
           FROM tickets t
           WHERE lower(btrim(t.enterprise)) = p.enterprise_key
           UNION ALL
           SELECT i.enterprise_name
           FROM enterprise_information i
           WHERE i.enterprise_key = p.enterprise_key
         ) source
       ) enterprise ON TRUE
       WHERE NOT p.is_demo
       ORDER BY lower(p.title), p.id`,
    )
    res.json({ processes: result.rows })
  } catch (error) {
    next(error)
  }
})

async function getDailyProgramming(date: string, programmingType: 'general' | 'foreman') {
  const [collaborators, appointments] = await Promise.all([
    pool.query<{
      id: string
      name: string
      nickname: string
      role: string
      role_label: string
      has_photo: boolean
      is_on_leave: boolean
      absence_id: string | null
      absence_type: 'atestado' | 'falta_injustificada' | null
      absence_start_date: string | null
      absence_end_date: string | null
      absence_start_time: string | null
      absence_end_time: string | null
      absence_cid: string | null
      absence_notes: string | null
    }>(
      `SELECT c.id, c.name, c.nickname, c.role, r.label AS role_label,
              (c.photo_content IS NOT NULL) AS has_photo,
              (c.is_on_leave OR (abs.id IS NOT NULL AND abs.start_time IS NULL)) AS is_on_leave,
              abs.id AS absence_id,
              abs.type AS absence_type,
              abs.start_date::text AS absence_start_date,
              abs.end_date::text AS absence_end_date,
              abs.start_time AS absence_start_time,
              abs.end_time AS absence_end_time,
              abs.cid AS absence_cid,
              abs.notes AS absence_notes
       FROM collaborators c
       JOIN collaborator_roles r ON r.role_key = c.role
       LEFT JOIN collaborator_absences abs ON abs.collaborator_id = c.id
         AND abs.start_date <= $1::date AND abs.end_date >= $1::date
       WHERE (c.termination_date IS NULL OR c.termination_date > $1::date)
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado'))
       ORDER BY lower(c.name), c.id`,
      [date, programmingType],
    ),
    pool.query<{
      id: string
      ticket_id: string | null
      legal_process_id: string | null
      collaborator_id: string
      activity_description: string
      starts_at: Date
      ends_at: Date
      protocol: string | null
      subject: string | null
      legal_process_number: string | null
      legal_process_claimant: string | null
      standalone_location: string
      enterprise: string
      block: string
      unit: string
      common_area_location: string
      materials: string[]
      equipment: string[]
      tools: string[]
      completed: boolean
      is_finalization: boolean
      completion_term_delivered: boolean
      programming_type: 'general' | 'foreman'
      collaborator_name: string
      collaborator_role: string
      collaborator_role_label: string
      collaborator_photo_url: string | null
    }>(
      `SELECT p.id, p.ticket_id, p.legal_process_id, p.collaborator_id, p.activity_description,
              p.starts_at, p.ends_at, t.protocol, t.subject,
              lp.title AS legal_process_number, lp.claimant AS legal_process_claimant,
              p.standalone_location, p.enterprise,
              p.block, p.unit, p.common_area_location,
              p.materials, p.equipment, p.tools, p.completed,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.completion_term_delivered, FALSE) AS completion_term_delivered,
              p.programming_type,
              c.name AS collaborator_name,
              c.role AS collaborator_role, r.label AS collaborator_role_label,
              CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS collaborator_photo_url
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE p.starts_at < (($1::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
         AND p.ends_at > ($1::date AT TIME ZONE '${programmingTimeZone}')
         AND p.programming_type = $2
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado'))
       ORDER BY p.starts_at, c.id`,
      [date, programmingType],
    ),
  ])

  return {
    date,
    collaborators: collaborators.rows.map((collaborator) => ({
      id: collaborator.id,
      name: collaborator.name,
      nickname: collaborator.nickname,
      role: collaborator.role,
      role_label: collaborator.role_label,
      is_on_leave: collaborator.is_on_leave,
      photo_url: collaborator.has_photo ? `/api/collaborators/${collaborator.id}/photo` : null,
      absence: collaborator.absence_id ? {
        id: collaborator.absence_id,
        type: collaborator.absence_type,
        startDate: collaborator.absence_start_date,
        endDate: collaborator.absence_end_date,
        startTime: collaborator.absence_start_time ?? null,
        endTime: collaborator.absence_end_time ?? null,
        cid: collaborator.absence_cid,
        notes: collaborator.absence_notes,
      } : null,
      appointments: appointments.rows.filter((appointment) => appointment.collaborator_id === collaborator.id),
    })),
  }
}

router.get('/', async (req, res, next) => {
  const date = dateSchema.safeParse(req.query.date)
  const programmingType = programmingTypeSchema.safeParse(req.query.type ?? 'general')
  if (!date.success || !programmingType.success) {
    res.status(400).json({ error: 'Informe um dia válido e uma vertente de programação válida.' })
    return
  }
  try {
    res.json(await getDailyProgramming(date.data, programmingType.data))
  } catch (error) {
    next(error)
  }
})

router.get('/availability', async (req, res, next) => {
  const startDate = dateSchema.safeParse(req.query.startDate ?? req.query.date)
  const endDate = dateSchema.safeParse(req.query.endDate ?? req.query.date)
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.query.collaboratorId)
  const excludeId = req.query.excludeId === undefined
    ? { success: true as const, data: null }
    : z.coerce.number().int().positive().safeParse(req.query.excludeId)
  if (!startDate.success || !endDate.success || !collaboratorId.success || !excludeId.success ||
      !isRangeWithinLimit(startDate.data, endDate.data)) {
    res.status(400).json({ error: 'Informe colaborador e dia válidos.' })
    return
  }
  try {
    const [appointmentsResult, absencesResult] = await Promise.all([
      pool.query<{
        id: string
        ticket_id: string | null
        legal_process_id: string | null
        starts_at: Date
        ends_at: Date
      }>(
        `SELECT id, ticket_id, legal_process_id, starts_at, ends_at
         FROM ticket_programming
         WHERE collaborator_id = $1
           AND starts_at < (($3::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
           AND ends_at > ($2::date AT TIME ZONE '${programmingTimeZone}')
           AND ($4::bigint IS NULL OR id <> $4)
         ORDER BY starts_at`,
        [collaboratorId.data, startDate.data, endDate.data, excludeId.data],
      ),
      pool.query<{
        id: string
        type: 'atestado' | 'falta_injustificada'
        start_date: string
        end_date: string
        start_time: string | null
        end_time: string | null
        cid: string | null
      }>(
        `SELECT id, type, start_date::text, end_date::text, start_time, end_time, cid
         FROM collaborator_absences
         WHERE collaborator_id = $1
           AND start_date <= $3::date AND end_date >= $2::date
         ORDER BY start_date`,
        [collaboratorId.data, startDate.data, endDate.data],
      ),
    ])

    const appointments: Array<{
      id: string
      ticket_id: string | null
      legal_process_id: string | null
      starts_at: string | Date
      ends_at: string | Date
    }> = [...appointmentsResult.rows]

    for (const absence of absencesResult.rows) {
      const cur = new Date(`${absence.start_date < startDate.data ? startDate.data : absence.start_date}T12:00:00Z`)
      const maxDate = new Date(`${absence.end_date > endDate.data ? endDate.data : absence.end_date}T12:00:00Z`)
      const sTime = absence.start_time || '08:00'
      const eTime = absence.end_time || '18:00'
      while (cur <= maxDate) {
        const dayIso = cur.toISOString().slice(0, 10)
        appointments.push({
          id: `absence-${absence.id}-${dayIso}`,
          ticket_id: null,
          legal_process_id: null,
          starts_at: `${dayIso}T${sTime}:00-03:00`,
          ends_at: `${dayIso}T${eTime}:00-03:00`,
        })
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
    }

    res.json({
      appointments,
      absences: absencesResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        startDate: row.start_date,
        endDate: row.end_date,
        startTime: row.start_time ?? null,
        endTime: row.end_time ?? null,
        cid: row.cid,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/ticket/:ticketId', async (req, res, next) => {
  const ticketId = z.coerce.number().int().positive().safeParse(req.params.ticketId)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `SELECT p.id, p.ticket_id, p.collaborator_id, p.activity_description,
              p.enterprise, p.block, p.unit, p.common_area_location, p.materials, p.equipment, p.tools,
              p.starts_at, p.ends_at, p.completed, p.programming_type,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.completion_term_delivered, FALSE) AS completion_term_delivered,
              c.name AS collaborator_name, c.nickname AS collaborator_nickname
       FROM ticket_programming p JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.ticket_id = $1 ORDER BY p.starts_at, c.id`,
      [ticketId.data],
    )
    res.json({ programming: result.rows })
  } catch (error) {
    next(error)
  }
})

async function validateAvailability(
  client: import('pg').PoolClient,
  collaboratorId: number,
  programmingType: 'general' | 'foreman',
  ticketId: number | null,
  startsAt: Date,
  endsAt: Date,
  excludeId?: number,
) {
  const collaborator = await client.query<{ name: string; is_on_leave: boolean; role: string }>(
    `SELECT name, is_on_leave, role FROM collaborators
     WHERE id = $1 AND (termination_date IS NULL OR termination_date > CURRENT_DATE)
     FOR UPDATE`,
    [collaboratorId],
  )
  if (!collaborator.rows[0]) throw new Error('Colaborador ativo não encontrado.')
  if (collaborator.rows[0].is_on_leave) throw new Error('Este colaborador está afastado e não pode receber programação.')
  if ((programmingType === 'foreman') !== (collaborator.rows[0].role === 'encarregado')) {
    throw new Error('A programação selecionada não corresponde ao cargo do colaborador.')
  }

  // Validação de calendário (feriados, domingos e sábados compensados)
  const dateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: programmingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startsAt)

  const calendarDay = await client.query<{ type: string; description: string }>(
    `SELECT type, description FROM work_calendar WHERE date = $1`,
    [dateIso],
  )
  if (calendarDay.rows[0]?.type === 'holiday') {
    const [y, m, d] = dateIso.split('-')
    throw new Error(`Agenda bloqueada: a data ${d}/${m}/${y} é feriado (${calendarDay.rows[0].description}).`)
  }

  const dateInTz = new Date(startsAt.toLocaleString('en-US', { timeZone: programmingTimeZone }))
  const dayOfWeek = dateInTz.getDay() // 0 = Dom, 6 = Sáb

  if (dayOfWeek === 0) {
    throw new Error('Agenda bloqueada: domingos não possuem expediente da assistência técnica.')
  }
  if (dayOfWeek === 6 && calendarDay.rows[0]?.type !== 'work_saturday') {
    throw new Error('Agenda bloqueada: sábados sem compensação cadastrada não possuem expediente.')
  }

  // Validação de jornada de trabalho (horas úteis)
  const workingHoursSetting = await client.query<{ setting_value: { monday_thursday?: { start: string; end: string }; friday?: { start: string; end: string }; work_saturday?: { start: string; end: string } } }>(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'working_hours'`,
  )
  const wh = workingHoursSetting.rows[0]?.setting_value ?? {}
  const mondayThursdayRule = wh.monday_thursday ?? { start: '08:00', end: '18:00' }
  const fridayRule = wh.friday ?? { start: '08:00', end: '17:00' }
  const saturdayRule = wh.work_saturday ?? { start: '08:00', end: '18:00' }

  let scheduleRule = mondayThursdayRule
  let dayLabel = 'Segunda a Quinta'
  if (dayOfWeek === 5) {
    scheduleRule = fridayRule
    dayLabel = 'Sextas-feiras'
  } else if (dayOfWeek === 6) {
    scheduleRule = saturdayRule
    dayLabel = 'Sábados compensados'
  }

  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: programmingTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const startParts = timeFormatter.format(startsAt).split(':').map(Number)
  const endParts = timeFormatter.format(endsAt).split(':').map(Number)
  const [ruleStartH, ruleStartM] = scheduleRule.start.split(':').map(Number)
  const [ruleEndH, ruleEndM] = scheduleRule.end.split(':').map(Number)

  const startsMin = startParts[0] * 60 + startParts[1]
  const endsMin = endParts[0] * 60 + endParts[1]
  const ruleStartMin = ruleStartH * 60 + ruleStartM
  const ruleEndMin = ruleEndH * 60 + ruleEndM

  if (startsMin < ruleStartMin || endsMin > ruleEndMin) {
    throw new Error(`Horário fora do expediente da assistência técnica (${dayLabel}: ${scheduleRule.start} às ${scheduleRule.end}).`)
  }

  const absenceOverlap = await client.query<{
    type: 'atestado' | 'falta_injustificada'
    start_date: string
    end_date: string
    start_time: string | null
    end_time: string | null
    cid: string | null
  }>(
    `SELECT type, start_date::text, end_date::text, start_time, end_time, cid
     FROM collaborator_absences
     WHERE collaborator_id = $1
       AND start_date <= ($3::timestamptz AT TIME ZONE '${programmingTimeZone}')::date
       AND end_date >= ($2::timestamptz AT TIME ZONE '${programmingTimeZone}')::date`,
    [collaboratorId, startsAt, endsAt],
  )
  for (const abs of absenceOverlap.rows) {
    if (abs.start_time && abs.end_time) {
      const timeFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: programmingTimeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const aptStart = timeFormatter.format(new Date(startsAt))
      const aptEnd = timeFormatter.format(new Date(endsAt))
      if (!(aptStart < abs.end_time && aptEnd > abs.start_time)) {
        continue
      }
    }
    const typeLabel = abs.type === 'atestado' ? 'atestado médico' : 'falta injustificada'
    const cidStr = abs.cid ? ` (CID ${abs.cid})` : ''
    const [sY, sM, sD] = abs.start_date.split('-')
    const [eY, eM, eD] = abs.end_date.split('-')
    const periodStr = abs.start_date === abs.end_date ? `${sD}/${sM}/${sY}` : `${sD}/${sM}/${sY} a ${eD}/${eM}/${eY}`
    const timeStr = abs.start_time && abs.end_time ? ` das ${abs.start_time} às ${abs.end_time}` : ''
    throw new Error(`Agenda bloqueada: o colaborador ${collaborator.rows[0].name} possui ${typeLabel}${cidStr} registrado no período (${periodStr}${timeStr}).`)
  }

  if (ticketId !== null) {
    const ticket = await client.query(
      'SELECT 1 FROM tickets WHERE source_id = $1 AND source_active = TRUE',
      [ticketId],
    )
    if (!ticket.rowCount) throw new Error('Chamado ativo não encontrado.')
  }

  const conflict = await client.query<{
    id: string
    protocol: string | null
    legal_process_number: string | null
    starts_at: Date
    ends_at: Date
  }>(
    `SELECT p.id, t.protocol, lp.title AS legal_process_number, p.starts_at, p.ends_at
     FROM ticket_programming p
     LEFT JOIN tickets t ON t.source_id = p.ticket_id
     LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
     WHERE p.collaborator_id = $1 AND p.starts_at < $3 AND p.ends_at > $2
       AND ($4::bigint IS NULL OR p.id <> $4)
     LIMIT 1`,
    [collaboratorId, startsAt, endsAt, excludeId ?? null],
  )
  if (conflict.rows[0]) {
    const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: programmingTimeZone,
      hour: '2-digit',
      minute: '2-digit',
    })
    const starts = timeFormatter.format(conflict.rows[0].starts_at)
    const ends = timeFormatter.format(conflict.rows[0].ends_at)
    const activity = conflict.rows[0].protocol
      ? `o chamado ${conflict.rows[0].protocol}`
      : conflict.rows[0].legal_process_number
        ? `o processo jurídico ${conflict.rows[0].legal_process_number}`
        : 'uma atividade avulsa'
    throw new Error(`Conflito com ${activity}, programado das ${starts} às ${ends}.`)
  }
}

async function validateLegalProcess(client: import('pg').PoolClient, legalProcessId: number | null | undefined) {
  if (legalProcessId === null || legalProcessId === undefined) return
  const process = await client.query(
    'SELECT 1 FROM legal_processes WHERE id = $1 AND is_demo = FALSE',
    [legalProcessId],
  )
  if (!process.rowCount) throw new Error('Processo jurídico não encontrado.')
}

router.post('/', async (req, res, next) => {
  const parsed = programmingSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Programação inválida.' })
    return
  }
  const data = parsed.data
  const collaboratorIds = [...new Set(data.collaboratorIds)].sort((left, right) => left - right)
  if (collaboratorIds.length !== data.collaboratorIds.length) {
    res.status(400).json({ error: 'Remova colaboradores repetidos da seleção.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await validateLegalProcess(client, data.legalProcessId)
    const collaboratorNames = await client.query<{ id: string; name: string; role: string }>(
      'SELECT id, name, role FROM collaborators WHERE id = ANY($1::bigint[])',
      [collaboratorIds],
    )
    const collaboratorNameById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.name]))
    const collaboratorRoleById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.role]))
    for (const collaboratorId of collaboratorIds) {
      const collaboratorProgrammingType = collaboratorRoleById.get(collaboratorId) === 'encarregado'
        ? 'foreman'
        : 'general'
      for (const occurrence of data.occurrences) {
        await validateAvailability(
          client,
          collaboratorId,
          collaboratorProgrammingType,
          data.ticketId ?? null,
          new Date(occurrence.startsAt),
          new Date(occurrence.endsAt),
        )
      }
    }

    const ids: string[] = []
    for (const collaboratorId of collaboratorIds) {
      const collaboratorProgrammingType = collaboratorRoleById.get(collaboratorId) === 'encarregado'
        ? 'foreman'
        : 'general'
      for (const occurrence of data.occurrences) {
        const result = await client.query<{ id: string }>(
          `INSERT INTO ticket_programming
              (ticket_id, legal_process_id, collaborator_id, activity_description, starts_at, ends_at,
               enterprise, block, unit, common_area_location, materials, equipment, tools,
               standalone_location, programming_type, created_by, is_finalization, completion_term_delivered)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
            [
              data.ticketId ?? null, data.legalProcessId ?? null, collaboratorId, data.activityDescription, occurrence.startsAt, occurrence.endsAt,
              data.enterprise, data.block, data.unit, data.commonAreaLocation, data.materials, data.equipment, data.tools,
              data.standaloneLocation,
              collaboratorProgrammingType,
              req.session.user!.id,
              Boolean(data.isFinalization),
              Boolean(data.completionTermDelivered),
            ],
        )
        ids.push(result.rows[0].id)
        if (data.ticketId) await recordTicketActivity(
          client,
          data.ticketId,
          req.session.user!.id,
          'programming_added',
          `Adicionou programação para ${collaboratorNameById.get(collaboratorId) ?? `colaborador ${collaboratorId}`}.`,
          {
            programmingId: result.rows[0].id,
            collaboratorId,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            activityDescription: data.activityDescription,
          },
        )
      }
    }
    await client.query('COMMIT')
    res.status(201).json({ ids })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && /encontrado|afastado|Conflito|corresponde/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = singleProgrammingSchema.safeParse(req.body)
  if (!programmingId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Programação inválida.' })
    return
  }

  const data = parsed.data
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const previous = await client.query<{
      ticket_id: string | null
      legal_process_id: string | null
      collaborator_id: string
      activity_description: string
      enterprise: string
      block: string
      unit: string
      common_area_location: string
      materials: string[]
      equipment: string[]
      tools: string[]
      standalone_location: string
      starts_at: Date
      ends_at: Date
      programming_type: 'general' | 'foreman'
      protocol: string | null
      legal_process_number: string | null
      collaborator_name: string
    }>(
      `SELECT p.ticket_id, p.legal_process_id, p.collaborator_id, p.activity_description, p.enterprise, p.block, p.unit,
              p.common_area_location, p.materials, p.equipment, p.tools, p.starts_at, p.ends_at,
              p.programming_type,
              p.standalone_location, t.protocol, lp.title AS legal_process_number,
              c.name AS collaborator_name
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
       JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [programmingId.data],
    )
    if (!previous.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    await validateLegalProcess(client, data.legalProcessId)
    const collabRoleQuery = await client.query<{ role: string }>('SELECT role FROM collaborators WHERE id = $1', [data.collaboratorId])
    const inferredProgrammingType = collabRoleQuery.rows[0]?.role === 'encarregado' ? 'foreman' : 'general'
    await validateAvailability(
      client,
      data.collaboratorId,
      inferredProgrammingType,
      data.ticketId ?? null,
      new Date(data.startsAt),
      new Date(data.endsAt),
      programmingId.data,
    )
    const result = await client.query<{ ticket_id: string | null; legal_process_id: string | null }>(
      `UPDATE ticket_programming SET ticket_id = $1, legal_process_id = $2, collaborator_id = $3,
         activity_description = $4, starts_at = $5, ends_at = $6, enterprise = $7, block = $8,
         unit = $9, common_area_location = $10, materials = $11, equipment = $12, tools = $13,
         standalone_location = $14, programming_type = $15, is_finalization = $16, completion_term_delivered = $17,
         updated_at = now()
       WHERE id = $18 RETURNING ticket_id, legal_process_id`,
      [
        data.ticketId ?? null, data.legalProcessId ?? null, data.collaboratorId, data.activityDescription, data.startsAt, data.endsAt, data.enterprise,
        data.block, data.unit, data.commonAreaLocation, data.materials, data.equipment, data.tools, data.standaloneLocation,
        inferredProgrammingType, Boolean(data.isFinalization), Boolean(data.completionTermDelivered), programmingId.data,
      ],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    if (previous.rows[0].ticket_id) {
      await recordTicketActivity(client, previous.rows[0].ticket_id, req.session.user!.id, 'programming_edited', `Editou a programação de ${previous.rows[0].collaborator_name} no protocolo ${previous.rows[0].protocol}.`, {
        programmingId: programmingId.data,
        previous: previous.rows[0],
        current: data,
      })
    }
    if (previous.rows[0].ticket_id && previous.rows[0].ticket_id !== result.rows[0].ticket_id && result.rows[0].ticket_id) {
      await recordTicketActivity(client, result.rows[0].ticket_id, req.session.user!.id, 'programming_moved', 'Recebeu uma programação transferida de outro chamado.', {
        programmingId: programmingId.data,
        previousTicketId: previous.rows[0].ticket_id,
      })
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && /encontrado|afastado|Conflito|corresponde/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/completion', async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({
    completed: z.boolean().optional(),
    completionTermDelivered: z.boolean().optional(),
  }).safeParse(req.body)
  if (!programmingId.success || !parsed.success) {
    res.status(400).json({ error: 'Identificador ou status de conclusão inválido.' })
    return
  }
  try {
    const updates: string[] = []
    const values: (boolean | number)[] = []
    let idx = 1
    if (parsed.data.completed !== undefined) {
      updates.push(`completed = $${idx++}`)
      values.push(parsed.data.completed)
    }
    if (parsed.data.completionTermDelivered !== undefined) {
      updates.push(`completion_term_delivered = $${idx++}`)
      values.push(parsed.data.completionTermDelivered)
    }
    if (!updates.length) {
      res.status(400).json({ error: 'Nenhum campo para atualizar.' })
      return
    }
    updates.push('updated_at = now()')
    values.push(programmingId.data)
    const result = await pool.query(
      `UPDATE ticket_programming SET ${updates.join(', ')} WHERE id = $${idx}`,
      values,
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/term-delivery', async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({
    delivered: z.boolean().optional(),
    completionTermDelivered: z.boolean().optional(),
  }).refine((entry) => entry.delivered !== undefined || entry.completionTermDelivered !== undefined, {
    message: 'Informe o status de entrega do termo.',
  }).safeParse(req.body)
  if (!programmingId.success || !parsed.success) {
    res.status(400).json({ error: 'Identificador ou status de entrega inválido.' })
    return
  }
  const isDelivered = parsed.data.delivered ?? parsed.data.completionTermDelivered ?? false
  try {
    const result = await pool.query(
      'UPDATE ticket_programming SET completion_term_delivered = $1, updated_at = now() WHERE id = $2',
      [isDelivered, programmingId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!programmingId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{
      ticket_id: string | null
      collaborator_id: string
      activity_description: string
      enterprise: string
      block: string
      unit: string
      common_area_location: string
      materials: string[]
      equipment: string[]
      tools: string[]
      standalone_location: string
      starts_at: Date
      ends_at: Date
      protocol: string | null
      collaborator_name: string
    }>(
      `SELECT p.ticket_id, p.collaborator_id, p.activity_description, p.enterprise, p.block, p.unit,
              p.common_area_location, p.materials, p.equipment, p.tools, p.standalone_location,
              p.starts_at, p.ends_at, t.protocol, c.name AS collaborator_name
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [programmingId.data],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    if (existing.rows[0].ticket_id) {
      await recordTicketActivity(client, existing.rows[0].ticket_id, req.session.user!.id, 'programming_deleted', `Excluiu a programação de ${existing.rows[0].collaborator_name} do protocolo ${existing.rows[0].protocol}.`, {
        programmingId: programmingId.data,
        ...existing.rows[0],
      })
    }
    await client.query('DELETE FROM ticket_programming WHERE id = $1', [programmingId.data])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

const sendProgrammingWhatsappSchema = z.object({
  date: dateSchema.optional(),
  programmingType: programmingTypeSchema,
  collaboratorId: z.coerce.number().int().positive().optional(),
  recipientName: z.string().trim().max(160).optional(),
  targetOverride: z.string().trim().max(120).optional(),
})

router.post('/whatsapp/send', requireAuth, async (req, res, next) => {
  const parsed = sendProgrammingWhatsappSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetros inválidos para envio da programação.' })
    return
  }

  const programmingType = parsed.data.programmingType
  const targetDate = parsed.data.date || getTodayDateString()

  try {
    const settings = await getWhatsAppSettings()
    if (!settings.apiUrl || !settings.apiKey || !settings.instanceName) {
      res.status(400).json({
        error: 'A Evolution API não está totalmente configurada. Acesse Configurações para informar a URL, Chave e Instância.',
      })
      return
    }

    if (programmingType === 'foreman') {
      const data = await fetchDailyProgrammingData(targetDate, 'foreman')
      const foremenWithAppointments = data.collaborators.filter((c) => c.appointments.length > 0)
      const foremenToSend = foremenWithAppointments.length > 0 ? foremenWithAppointments : data.collaborators

      if (foremenToSend.length === 0) {
        res.status(400).json({ error: 'Nenhum encarregado encontrado no sistema para esta data.' })
        return
      }

      const results: Array<{ name: string; phone: string; success: boolean; error?: string }> = []

      for (const foreman of foremenToSend) {
        const target = foreman.phone || settings.foremanPhoneNumber
        const name = foreman.nickname || foreman.name

        if (!target) {
          results.push({ name, phone: '', success: false, error: 'Telefone não cadastrado' })
          continue
        }

        try {
          const { buffer, fileName, caption } = await generateSchedulePdf({
            date: targetDate,
            programmingType: 'foreman',
            collaboratorId: foreman.id,
            recipientName: name,
          })

          await sendWhatsAppPdfDocument({
            target,
            pdfBuffer: buffer,
            fileName,
            caption,
          })

          results.push({ name, phone: target, success: true })
        } catch (err: unknown) {
          results.push({
            name,
            phone: target,
            success: false,
            error: err instanceof Error ? err.message : 'Falha no envio',
          })
        }
      }

      const successCount = results.filter((r) => r.success).length
      const failureCount = results.filter((r) => !r.success).length

      if (successCount === 0 && failureCount > 0) {
        res.status(500).json({
          error: `Não foi possível enviar para os encarregados: ${results.map((r) => `${r.name} (${r.error})`).join(', ')}`,
          results,
        })
        return
      }

      const namesList = results.filter((r) => r.success).map((r) => r.name).join(', ')
      const message = failureCount === 0
        ? `Programação enviada com sucesso para ${successCount === 1 ? 'o encarregado' : `${successCount} encarregados`}: ${namesList}!`
        : `Programação enviada para ${successCount} encarregado(s): ${namesList}. (${failureCount} com telefone pendente ou falha).`

      await recordAuditLog({
        actorUserId: req.session.user!.id,
        actorName: req.session.user!.displayName,
        action: 'programming_whatsapp_dispatch',
        resourceType: 'ticket_programming',
        resourceId: `foreman:${targetDate}`,
        summary: message,
        metadata: {
          programmingType: 'foreman',
          date: targetDate,
          results,
          successCount,
        },
      })

      res.json({
        success: true,
        message,
        results,
        successCount,
      })
      return
    }

    // Programação Geral
    const target = settings.programmingGroupJid
    if (!target) {
      res.status(400).json({
        error: 'O JID do grupo de WhatsApp para a Programação Geral não está configurado. Cadastre-o na tela de Configurações.',
      })
      return
    }

    const { buffer, fileName, caption, totalEvents, scheduledStaffCount } = await generateSchedulePdf({
      date: targetDate,
      programmingType: 'general',
    })

    await sendWhatsAppPdfDocument({
      target,
      pdfBuffer: buffer,
      fileName,
      caption,
    })

    const message = 'Programação geral enviada com sucesso para o grupo de WhatsApp!'

    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'programming_whatsapp_dispatch',
      resourceType: 'ticket_programming',
      resourceId: `general:${targetDate}`,
      summary: `Enviou a programação geral de ${targetDate} via WhatsApp para o grupo ${target}.`,
      metadata: {
        programmingType: 'general',
        date: targetDate,
        target,
        totalEvents,
        scheduledStaffCount,
      },
    })

    res.json({
      success: true,
      message,
      fileName,
      totalEvents,
      scheduledStaffCount,
      target,
    })
  } catch (error) {
    next(error)
  }
})

export default router
