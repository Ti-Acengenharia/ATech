import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { APP_TIMEZONE } from '../config.js'
import { pool } from '../db.js'
import { recordAuditLog } from '../services/audit-log.js'
import { getWhatsAppSettings, sendWhatsAppPdfDocument } from '../services/evolution-api.js'
import {
  getCvcrmProgrammingSyncSettings,
  runCvcrmProgrammingCommentSync,
} from '../services/cvcrm-programming-sync.js'
import { decryptPersonalData } from '../services/personal-data.js'
import { fetchDailyProgrammingData, generateSchedulePdf } from '../services/schedule-pdf.js'
import { broadcastSyncEvent } from '../services/sync-events.js'
import { recordTicketActivity } from '../services/ticket-activity.js'
import { getTodayDateString } from '../services/working-days.js'
import { invalidateHomeSummaryCache } from './home.js'

const router = Router()
const programmingTimeZone = APP_TIMEZONE

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const datetimeSchema = z.string().datetime({ offset: true })
const programmingTypeSchema = z.enum(['general', 'foreman', 'post_work']).default('general')
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

function isNotSunday(value: string) {
  return isValidDate(value) && new Date(`${value}T12:00:00Z`).getUTCDay() !== 0
}

async function getExpectedWorkDatesInRange(
  client: import('pg').PoolClient,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const calendarRes = await client.query<{ date: string; type: 'holiday' | 'work_saturday' }>(
    `SELECT date::text AS date, type
     FROM work_calendar
     WHERE date >= $1::date AND date <= $2::date`,
    [startDate, endDate],
  )
  const holidays = new Set<string>()
  const workSaturdays = new Set<string>()
  for (const row of calendarRes.rows) {
    if (row.type === 'holiday') holidays.add(row.date)
    else if (row.type === 'work_saturday') workSaturdays.add(row.date)
  }

  const dates: string[] = []
  const date = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (date <= end) {
    const iso = date.toISOString().slice(0, 10)
    const day = date.getUTCDay()
    if (day !== 0 && !holidays.has(iso)) {
      if (day === 6) {
        if (workSaturdays.has(iso)) dates.push(iso)
      } else {
        dates.push(iso)
      }
    }
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
}).refine((entry) => isNotSunday(entry.date) &&
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
  occurrences: z.array(occurrenceSchema).min(1).max(80),
  activityDescription: z.string().trim().min(1).max(3000),
  standaloneLocation: z.string().trim().max(500).default(''),
  isFinalization: z.boolean().default(false),
  completionTermDelivered: z.boolean().default(false),
  additionalTickets: z.array(z.object({
    ticketId: z.coerce.number().int().positive(),
    activityDescription: z.string().trim().min(1).max(3000),
    isFinalization: z.boolean().default(false),
  })).max(15).default([]),
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
  const occurrenceDates = entry.occurrences.map((occurrence) => occurrence.date)
  const uniqueSorted = [...new Set(occurrenceDates)].sort()
  if (
    !occurrenceDates.length ||
    uniqueSorted.length !== occurrenceDates.length ||
    uniqueSorted.join(',') !== occurrenceDates.join(',') ||
    occurrenceDates.some((d) => d < entry.startDate || d > entry.endDate)
  ) {
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
  additionalTickets: z.array(z.object({
    ticketId: z.coerce.number().int().positive(),
    activityDescription: z.string().trim().min(1).max(3000),
    isFinalization: z.boolean().default(false),
  })).max(15).default([]),
}).merge(programmingDetailsSchema).superRefine((entry, context) => {
  if (!isNotSunday(entry.date) || new Date(entry.endsAt) <= new Date(entry.startsAt)) {
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
      ['/legal-processes', '/collaborators', '/availability', '/week', '/search'].includes(req.path)
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
              COALESCE(c.cost_center, 'assistencia_tecnica') AS cost_center,
              TRUE AS is_active, c.is_on_leave,
              CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS photo_url
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

async function getDailyProgramming(date: string, programmingType: 'general' | 'foreman' | 'post_work') {
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
           OR ($2 = 'general' AND c.role <> 'encarregado' AND COALESCE(c.cost_center, 'assistencia_tecnica') = 'assistencia_tecnica')
           OR ($2 = 'post_work' AND c.role <> 'encarregado' AND c.cost_center = 'pos_obra'))
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
      cancelled: boolean
      cancellation_reason_type: string | null
      cancellation_reason: string | null
      cancellation_reassigned_to: string | null
      cancellation_reassigned_name: string | null
      cancelled_at: string | null
      programming_type: 'general' | 'foreman' | 'post_work'
      schedule_group_id: string | null
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
              COALESCE(p.cancelled, FALSE) AS cancelled,
              p.cancellation_reason_type,
              p.cancellation_reason,
              p.cancellation_reassigned_to::text AS cancellation_reassigned_to,
              c2.name AS cancellation_reassigned_name,
              p.cancelled_at,
              p.programming_type,
              p.schedule_group_id::text AS schedule_group_id,
              c.name AS collaborator_name,
              c.role AS collaborator_role, r.label AS collaborator_role_label,
              CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS collaborator_photo_url
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       LEFT JOIN collaborators c2 ON c2.id = p.cancellation_reassigned_to
       WHERE p.starts_at < (($1::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
         AND p.ends_at > ($1::date AT TIME ZONE '${programmingTimeZone}')
         AND p.programming_type = $2
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado' AND COALESCE(c.cost_center, 'assistencia_tecnica') = 'assistencia_tecnica')
           OR ($2 = 'post_work' AND c.role <> 'encarregado' AND c.cost_center = 'pos_obra'))
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

router.get('/week', async (req, res, next) => {
  const startDate = dateSchema.safeParse(req.query.startDate)
  const endDate = dateSchema.safeParse(req.query.endDate)
  if (!startDate.success || !endDate.success || !isRangeWithinLimit(startDate.data, endDate.data)) {
    res.status(400).json({ error: 'Informe um intervalo de datas válido (início e fim).' })
    return
  }

  let collaboratorIds: number[] | null = null
  if (req.query.collaboratorIds) {
    const rawIds = Array.isArray(req.query.collaboratorIds)
      ? req.query.collaboratorIds.flatMap((id) => String(id).split(','))
      : String(req.query.collaboratorIds).split(',')
    const parsedIds = rawIds
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
    if (parsedIds.length > 0) {
      collaboratorIds = [...new Set(parsedIds)]
    }
  }

  try {
    const apptParams: (string | number[])[] = [startDate.data, endDate.data]
    let apptCollabClause = ''
    if (collaboratorIds && collaboratorIds.length > 0) {
      apptParams.push(collaboratorIds)
      apptCollabClause = `AND p.collaborator_id = ANY($${apptParams.length}::bigint[])`
    }

    const absenceParams: (string | number[])[] = [startDate.data, endDate.data]
    let absenceCollabClause = ''
    if (collaboratorIds && collaboratorIds.length > 0) {
      absenceParams.push(collaboratorIds)
      absenceCollabClause = `AND abs.collaborator_id = ANY($${absenceParams.length}::bigint[])`
    }

    const collabParams: (string | number[])[] = [startDate.data]
    let collabFilterClause = ''
    if (collaboratorIds && collaboratorIds.length > 0) {
      collabParams.push(collaboratorIds)
      collabFilterClause = `AND c.id = ANY($${collabParams.length}::bigint[])`
    }

    const [appointmentsResult, absencesResult, collaboratorsResult] = await Promise.all([
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
        cancelled: boolean
        cancellation_reason_type: string | null
        cancellation_reason: string | null
        cancellation_reassigned_to: string | null
        cancellation_reassigned_name: string | null
        cancelled_at: string | null
        programming_type: 'general' | 'foreman'
        collaborator_name: string
        collaborator_nickname: string
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
                COALESCE(p.cancelled, FALSE) AS cancelled,
                p.cancellation_reason_type,
                p.cancellation_reason,
                p.cancellation_reassigned_to::text AS cancellation_reassigned_to,
                c2.name AS cancellation_reassigned_name,
                p.cancelled_at,
                p.programming_type,
                c.name AS collaborator_name,
                c.nickname AS collaborator_nickname,
                c.role AS collaborator_role, r.label AS collaborator_role_label,
                CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS collaborator_photo_url
         FROM ticket_programming p
         LEFT JOIN tickets t ON t.source_id = p.ticket_id
         LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
         JOIN collaborators c ON c.id = p.collaborator_id
         JOIN collaborator_roles r ON r.role_key = c.role
         LEFT JOIN collaborators c2 ON c2.id = p.cancellation_reassigned_to
         WHERE p.starts_at < (($2::date + interval '1 day') AT TIME ZONE '${programmingTimeZone}')
           AND p.ends_at > ($1::date AT TIME ZONE '${programmingTimeZone}')
           ${apptCollabClause}
         ORDER BY p.starts_at, c.id`,
        apptParams,
      ),
      pool.query<{
        id: string
        collaborator_id: string
        type: 'atestado' | 'falta_injustificada'
        start_date: string
        end_date: string
        start_time: string | null
        end_time: string | null
        cid: string | null
        notes: string | null
        collaborator_name: string
        collaborator_role: string
        collaborator_role_label: string
      }>(
        `SELECT abs.id, abs.collaborator_id, abs.type,
                abs.start_date::text AS start_date,
                abs.end_date::text AS end_date,
                abs.start_time, abs.end_time,
                abs.cid, abs.notes,
                c.name AS collaborator_name,
                c.role AS collaborator_role,
                r.label AS collaborator_role_label
         FROM collaborator_absences abs
         JOIN collaborators c ON c.id = abs.collaborator_id
         JOIN collaborator_roles r ON r.role_key = c.role
         WHERE abs.start_date <= $2::date AND abs.end_date >= $1::date
           ${absenceCollabClause}
         ORDER BY abs.start_date, c.name`,
        absenceParams,
      ),
      pool.query<{
        id: string
        name: string
        nickname: string
        role: string
        role_label: string
        is_on_leave: boolean
        photo_url: string | null
      }>(
        `SELECT c.id::text AS id, c.name, c.nickname, c.role, r.label AS role_label,
                c.is_on_leave,
                CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS photo_url
         FROM collaborators c
         JOIN collaborator_roles r ON r.role_key = c.role
         WHERE (c.termination_date IS NULL OR c.termination_date >= $1::date)
           ${collabFilterClause}
         ORDER BY lower(c.name), c.id`,
        collabParams,
      ),
    ])

    res.json({
      startDate: startDate.data,
      endDate: endDate.data,
      collaborators: collaboratorsResult.rows,
      absences: absencesResult.rows.map((row) => ({
        id: row.id,
        collaboratorId: row.collaborator_id,
        type: row.type,
        startDate: row.start_date,
        endDate: row.end_date,
        startTime: row.start_time ?? null,
        endTime: row.end_time ?? null,
        cid: row.cid,
        notes: row.notes,
        collaboratorName: row.collaborator_name,
        collaboratorRole: row.collaborator_role,
        collaboratorRoleLabel: row.collaborator_role_label,
      })),
      appointments: appointmentsResult.rows,
    })
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
           AND (cancelled = FALSE OR cancelled IS NULL)
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

router.get('/search', async (req, res, next) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^#+/, '').trim() : ''
  if (rawQuery.length < 2) {
    res.json({ appointments: [] })
    return
  }

  const tokens = rawQuery
    .split(/\s+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter((t) => t.length > 0)
    .slice(0, 6)

  if (tokens.length === 0) {
    res.json({ appointments: [] })
    return
  }

  try {
    const params: string[] = []
    const tokenClauses: string[] = []

    for (const token of tokens) {
      params.push(`%${token}%`)
      const idx = params.length
      tokenClauses.push(`(
        COALESCE(t.protocol, '') ILIKE $${idx}
        OR COALESCE(p.ticket_id::text, '') ILIKE $${idx}
        OR COALESCE(t.subject, '') ILIKE $${idx}
        OR COALESCE(p.activity_description, '') ILIKE $${idx}
        OR COALESCE(NULLIF(TRIM(p.enterprise), ''), t.enterprise, '') ILIKE $${idx}
        OR COALESCE(NULLIF(TRIM(p.block), ''), t.block, '') ILIKE $${idx}
        OR COALESCE(NULLIF(TRIM(p.unit), ''), t.unit, '') ILIKE $${idx}
        OR COALESCE(p.common_area_location, '') ILIKE $${idx}
        OR COALESCE(p.standalone_location, '') ILIKE $${idx}
        OR COALESCE(lp.title, '') ILIKE $${idx}
        OR COALESCE(lp.claimant, '') ILIKE $${idx}
        OR COALESCE(p.cancellation_reason, '') ILIKE $${idx}
        OR COALESCE(c.name, '') ILIKE $${idx}
        OR COALESCE(c.nickname, '') ILIKE $${idx}
      )`)
    }

    const result = await pool.query(
      `SELECT p.id::text AS id,
              p.ticket_id::text AS ticket_id,
              p.legal_process_id::text AS legal_process_id,
              p.collaborator_id::text AS collaborator_id,
              p.activity_description,
              p.starts_at,
              p.ends_at,
              t.protocol,
              t.subject,
              lp.title AS legal_process_number,
              lp.claimant AS legal_process_claimant,
              p.standalone_location,
              COALESCE(NULLIF(TRIM(p.enterprise), ''), t.enterprise, '') AS enterprise,
              COALESCE(NULLIF(TRIM(p.block), ''), t.block, '') AS block,
              COALESCE(NULLIF(TRIM(p.unit), ''), t.unit, '') AS unit,
              p.common_area_location,
              p.materials,
              p.equipment,
              p.tools,
              p.completed,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.completion_term_delivered, FALSE) AS completion_term_delivered,
              COALESCE(p.cancelled, FALSE) AS cancelled,
              p.cancellation_reason_type,
              p.cancellation_reason,
              p.cancellation_reassigned_to::text AS cancellation_reassigned_to,
              c2.name AS cancellation_reassigned_name,
              p.cancelled_at,
              p.programming_type,
              p.schedule_group_id::text AS schedule_group_id,
              c.name AS collaborator_name,
              c.nickname AS collaborator_nickname,
              c.role AS collaborator_role,
              r.label AS collaborator_role_label,
              CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS collaborator_photo_url
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       LEFT JOIN collaborators c2 ON c2.id = p.cancellation_reassigned_to
       WHERE ${tokenClauses.join(' AND ')}
       ORDER BY p.starts_at DESC, c.name ASC
       LIMIT 60`,
      params,
    )

    res.json({ appointments: result.rows })
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
              COALESCE(p.cancelled, FALSE) AS cancelled,
              p.cancellation_reason_type,
              p.cancellation_reason,
              p.cancellation_reassigned_to::text AS cancellation_reassigned_to,
              c2.name AS cancellation_reassigned_name,
              p.cancelled_at,
              c.name AS collaborator_name, c.nickname AS collaborator_nickname
       FROM ticket_programming p
       JOIN collaborators c ON c.id = p.collaborator_id
       LEFT JOIN collaborators c2 ON c2.id = p.cancellation_reassigned_to
       WHERE p.ticket_id = $1 ORDER BY p.starts_at, c.id`,
      [ticketId.data],
    )
    res.json({ programming: result.rows })
  } catch (error) {
    next(error)
  }
})

interface ScheduleConflict {
  id: string
  collaboratorId: number
  collaboratorName: string
  date: string
  dateLabel: string
  activity: string
  description: string
  starts: string
  ends: string
}

function formatScheduleConflicts(conflicts: ScheduleConflict[]) {
  const unique = new Map(conflicts.map((conflict) => [
    `${conflict.id}:${conflict.collaboratorId}`,
    conflict,
  ]))
  const ordered = [...unique.values()].sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.collaboratorName.localeCompare(right.collaboratorName, 'pt-BR') ||
    left.starts.localeCompare(right.starts),
  )
  return `Conflitos de agenda:\n${ordered.map((conflict) =>
    `• ${conflict.dateLabel} · ${conflict.collaboratorName}: ${conflict.activity}${conflict.description ? ` — ${conflict.description}` : ''}, das ${conflict.starts} às ${conflict.ends}.`,
  ).join('\n')}`
}

async function validateAvailability(
  client: import('pg').PoolClient,
  collaboratorId: number,
  programmingType: 'general' | 'foreman' | 'post_work',
  ticketId: number | null,
  startsAt: Date,
  endsAt: Date,
  excludeId?: number,
): Promise<ScheduleConflict[]> {
  const collaborator = await client.query<{ name: string; is_on_leave: boolean; role: string; cost_center: string }>(
    `SELECT name, is_on_leave, role, COALESCE(cost_center, 'assistencia_tecnica') AS cost_center FROM collaborators
     WHERE id = $1 AND (termination_date IS NULL OR termination_date > CURRENT_DATE)
     FOR UPDATE`,
    [collaboratorId],
  )
  if (!collaborator.rows[0]) throw new Error('Colaborador ativo não encontrado.')
  if (collaborator.rows[0].is_on_leave) throw new Error('Este colaborador está afastado e não pode receber programação.')
  const expectedType = collaborator.rows[0].role === 'encarregado'
    ? 'foreman'
    : collaborator.rows[0].cost_center === 'pos_obra'
      ? 'post_work'
      : 'general'
  if (programmingType !== expectedType) {
    throw new Error('A programação selecionada não corresponde ao cargo/centro de custo do colaborador.')
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

  const dayOfWeek = new Date(`${dateIso}T12:00:00Z`).getUTCDay() // 0 = Dom, 6 = Sáb

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
    activity_description: string
    starts_at: Date
    ends_at: Date
  }>(
    `SELECT p.id, t.protocol, lp.title AS legal_process_number,
            p.activity_description, p.starts_at, p.ends_at
     FROM ticket_programming p
     LEFT JOIN tickets t ON t.source_id = p.ticket_id
     LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
     WHERE p.collaborator_id = $1 AND p.starts_at < $3 AND p.ends_at > $2
       AND ($4::bigint IS NULL OR p.id <> $4)
       AND (p.cancelled = FALSE OR p.cancelled IS NULL)
     ORDER BY p.starts_at
     `,
    [collaboratorId, startsAt, endsAt, excludeId ?? null],
  )
  const conflictTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: programmingTimeZone,
    hour: '2-digit',
    minute: '2-digit',
  })
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: programmingTimeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const dateIsoFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: programmingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return conflict.rows.map((row) => ({
    id: row.id,
    collaboratorId,
    collaboratorName: collaborator.rows[0].name,
    date: dateIsoFormatter.format(row.starts_at),
    dateLabel: dateFormatter.format(row.starts_at),
    activity: row.protocol
      ? `chamado ${row.protocol}`
      : row.legal_process_number
        ? `processo jurídico ${row.legal_process_number}`
        : 'atividade avulsa',
    description: row.activity_description.trim(),
    starts: conflictTimeFormatter.format(row.starts_at),
    ends: conflictTimeFormatter.format(row.ends_at),
  }))
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
    const expectedDates = await getExpectedWorkDatesInRange(client, data.startDate, data.endDate)
    const occurrenceDates = data.occurrences.map((occurrence) => occurrence.date)
    if (!expectedDates.length || expectedDates.join(',') !== occurrenceDates.join(',')) {
      throw new Error('Inclua exatamente uma programação para cada dia útil do intervalo.')
    }
    await validateLegalProcess(client, data.legalProcessId)
    const collaboratorNames = await client.query<{ id: string; name: string; role: string; cost_center: string }>(
      `SELECT id, name, role, COALESCE(cost_center, 'assistencia_tecnica') AS cost_center FROM collaborators WHERE id = ANY($1::bigint[])`,
      [collaboratorIds],
    )
    const collaboratorNameById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.name]))
    const collaboratorRoleById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.role]))
    const collaboratorCostCenterById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.cost_center]))
    const resolveCollabType = (cid: number): 'general' | 'foreman' | 'post_work' => {
      if (collaboratorRoleById.get(cid) === 'encarregado') return 'foreman'
      if (collaboratorCostCenterById.get(cid) === 'pos_obra') return 'post_work'
      return 'general'
    }
    const conflicts: ScheduleConflict[] = []
    for (const collaboratorId of collaboratorIds) {
      const collaboratorProgrammingType = resolveCollabType(collaboratorId)
      for (const occurrence of data.occurrences) {
        conflicts.push(...await validateAvailability(
          client,
          collaboratorId,
          collaboratorProgrammingType,
          data.ticketId ?? null,
          new Date(occurrence.startsAt),
          new Date(occurrence.endsAt),
        ))
      }
    }
    if (conflicts.length) throw new Error(formatScheduleConflicts(conflicts))

    const ticketsToInsert: Array<{ ticketId: number | null; activityDescription: string; isFinalization: boolean }> = [
      {
        ticketId: data.ticketId ?? null,
        activityDescription: data.activityDescription,
        isFinalization: Boolean(data.isFinalization),
      },
      ...(data.activityType === 'ticket' ? data.additionalTickets : []),
    ]
    const scheduleGroupId = ticketsToInsert.length > 1 ? randomUUID() : null

    const ids: string[] = []
    for (const collaboratorId of collaboratorIds) {
      const collaboratorProgrammingType = resolveCollabType(collaboratorId)
      for (const occurrence of data.occurrences) {
        for (const item of ticketsToInsert) {
          const result = await client.query<{ id: string }>(
            `INSERT INTO ticket_programming
                (ticket_id, legal_process_id, collaborator_id, activity_description, starts_at, ends_at,
                 enterprise, block, unit, common_area_location, materials, equipment, tools,
                 standalone_location, programming_type, created_by, is_finalization, completion_term_delivered, schedule_group_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
            [
              item.ticketId, data.legalProcessId ?? null, collaboratorId, item.activityDescription, occurrence.startsAt, occurrence.endsAt,
              data.enterprise, data.block, data.unit, data.commonAreaLocation, data.materials, data.equipment, data.tools,
              data.standaloneLocation,
              collaboratorProgrammingType,
              req.session.user!.id,
              Boolean(item.isFinalization),
              Boolean(data.completionTermDelivered),
              scheduleGroupId,
            ],
          )
          ids.push(result.rows[0].id)
          if (item.ticketId) await recordTicketActivity(
            client,
            item.ticketId,
            req.session.user!.id,
            'programming_added',
            `Adicionou programação para ${collaboratorNameById.get(collaboratorId) ?? `colaborador ${collaboratorId}`}.`,
            {
              programmingId: result.rows[0].id,
              collaboratorId,
              startsAt: occurrence.startsAt,
              endsAt: occurrence.endsAt,
              activityDescription: item.activityDescription,
            },
          )
        }
      }
    }
    await client.query('COMMIT')
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'created' })
    res.status(201).json({ ids })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && /encontrado|afastado|Conflito|corresponde|Agenda bloqueada|Horário fora do expediente|dia útil/.test(error.message)) {
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
    const conflicts = await validateAvailability(
      client,
      data.collaboratorId,
      inferredProgrammingType,
      data.ticketId ?? null,
      new Date(data.startsAt),
      new Date(data.endsAt),
      programmingId.data,
    )
    if (conflicts.length) throw new Error(formatScheduleConflicts(conflicts))
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
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'updated', entityId: programmingId.data })
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && /encontrado|afastado|Conflito|corresponde|Agenda bloqueada|Horário fora do expediente|dia útil/.test(error.message)) {
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
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'completion_updated', entityId: programmingId.data })
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
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'term_delivery_updated', entityId: programmingId.data })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

const cancelProgrammingSchema = z.object({
  reasonType: z.enum(['cliente', 'remanejamento', 'ac_engenharia', 'reagendamento']),
  reassignedToCollaboratorId: z.coerce.number().int().positive().optional(),
  reasonNotes: z.string().trim().max(1000).optional(),
  reschedule: z.object({
    date: dateSchema,
    startsAt: datetimeSchema,
    endsAt: datetimeSchema,
    collaboratorId: z.coerce.number().int().positive().optional(),
  }).optional(),
})

router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = cancelProgrammingSchema.safeParse(req.body)
  if (!programmingId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados de cancelamento inválidos.' })
    return
  }

  const { reasonType, reassignedToCollaboratorId, reasonNotes, reschedule } = parsed.data
  const userId = req.session.user!.id
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const existingResult = await client.query<{
      id: string
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
      is_finalization: boolean
      completion_term_delivered: boolean
      protocol: string | null
      collaborator_name: string
      cancelled: boolean
    }>(
      `SELECT p.id, p.ticket_id, p.legal_process_id, p.collaborator_id, p.activity_description,
              p.enterprise, p.block, p.unit, p.common_area_location, p.materials, p.equipment, p.tools,
              p.standalone_location, p.starts_at, p.ends_at, p.programming_type,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.completion_term_delivered, FALSE) AS completion_term_delivered,
              COALESCE(p.cancelled, FALSE) AS cancelled,
              t.protocol, c.name AS collaborator_name
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [programmingId.data],
    )

    if (!existingResult.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }

    const existing = existingResult.rows[0]
    if (existing.cancelled) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Esta atividade já está cancelada.' })
      return
    }

    if (reasonType === 'ac_engenharia' && (!reasonNotes || reasonNotes.trim().length < 2)) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Informe o motivo do cancelamento pela AC Engenharia.' })
      return
    }

    if (reasonType === 'reagendamento' && !reschedule) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Informe a nova data e horário para o reagendamento.' })
      return
    }

    if (reasonType === 'remanejamento' && !reassignedToCollaboratorId) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione o profissional que receberá a atividade remanejada.' })
      return
    }

    if (reasonType === 'remanejamento' && reassignedToCollaboratorId === Number(existing.collaborator_id)) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'O profissional destinatário deve ser diferente do profissional atual.' })
      return
    }

    let finalReason = ''
    let reassignedTargetId: number | null = null
    let newProgrammingId: string | null = null
    let newProgrammingDate: string | null = null

    const shouldCreateNewProgramming = reasonType === 'remanejamento' || reasonType === 'reagendamento' || Boolean(reschedule)

    if (shouldCreateNewProgramming) {
      const targetCollabId = reasonType === 'remanejamento'
        ? reassignedToCollaboratorId!
        : (reschedule?.collaboratorId ?? Number(existing.collaborator_id))

      const targetStartsAt = reschedule ? new Date(reschedule.startsAt) : new Date(existing.starts_at)
      const targetEndsAt = reschedule ? new Date(reschedule.endsAt) : new Date(existing.ends_at)

      if (targetEndsAt <= targetStartsAt) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'O horário final do reagendamento deve ser posterior ao horário inicial.' })
        return
      }

      if (
        targetCollabId === Number(existing.collaborator_id) &&
        targetStartsAt.getTime() === new Date(existing.starts_at).getTime() &&
        targetEndsAt.getTime() === new Date(existing.ends_at).getTime()
      ) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Para reagendar com o mesmo profissional, selecione um novo dia ou horário diferente do agendamento original.' })
        return
      }

      const targetCollabRes = await client.query<{ id: string; name: string; role: string; is_on_leave: boolean }>(
        `SELECT id, name, role, is_on_leave FROM collaborators
         WHERE id = $1 AND (termination_date IS NULL OR termination_date > CURRENT_DATE)`,
        [targetCollabId],
      )
      if (!targetCollabRes.rowCount) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Profissional destinatário não encontrado ou inativo.' })
        return
      }

      const targetCollab = targetCollabRes.rows[0]
      if (targetCollab.is_on_leave) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: `O profissional ${targetCollab.name} está afastado e não pode receber a atividade.` })
        return
      }

      const targetProgrammingType = targetCollab.role === 'encarregado' ? 'foreman' : 'general'

      // Validar disponibilidade ignorando a própria atividade que está sendo cancelada (excludeId = programmingId.data)
      const conflicts = await validateAvailability(
        client,
        targetCollabId,
        targetProgrammingType,
        existing.ticket_id ? Number(existing.ticket_id) : null,
        targetStartsAt,
        targetEndsAt,
        programmingId.data,
      )
      if (conflicts.length) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: `Conflito de agenda para ${targetCollab.name}:\n${formatScheduleConflicts(conflicts)}` })
        return
      }

      if (targetCollabId !== Number(existing.collaborator_id)) {
        reassignedTargetId = targetCollabId
      }

      const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: programmingTimeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
      const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: programmingTimeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const dateIsoFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: programmingTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      const rescheduleDateLabel = dateFormatter.format(targetStartsAt)
      const rescheduleStartLabel = timeFormatter.format(targetStartsAt)
      const rescheduleEndLabel = timeFormatter.format(targetEndsAt)
      newProgrammingDate = dateIsoFormatter.format(targetStartsAt)

      const isDifferentTimeOrDay =
        targetStartsAt.getTime() !== new Date(existing.starts_at).getTime() ||
        targetEndsAt.getTime() !== new Date(existing.ends_at).getTime()

      const scheduleWhenText = `${rescheduleDateLabel} das ${rescheduleStartLabel} às ${rescheduleEndLabel}`
      const collabChangeText = targetCollabId !== Number(existing.collaborator_id) ? ` com ${targetCollab.name}` : ''

      if (reasonType === 'reagendamento') {
        finalReason = `Reagendado para ${scheduleWhenText}${collabChangeText}${reasonNotes ? ` (${reasonNotes.trim()})` : ''}`
      } else if (reasonType === 'remanejamento') {
        finalReason = isDifferentTimeOrDay
          ? `Remanejado para ${targetCollab.name} e reagendado para ${scheduleWhenText}${reasonNotes ? ` (${reasonNotes.trim()})` : ''}`
          : `Remanejado para ${targetCollab.name}${reasonNotes ? ` (${reasonNotes.trim()})` : ''}`
      } else if (reasonType === 'cliente') {
        const baseReason = reasonNotes && reasonNotes.length > 0 ? reasonNotes.trim() : 'Cancelamento por parte do cliente'
        finalReason = `${baseReason} — Reagendado para ${scheduleWhenText}${collabChangeText}`
      } else {
        finalReason = `${reasonNotes!.trim()} — Reagendado para ${scheduleWhenText}${collabChangeText}`
      }

      // Criar a nova programação levando todas as especificações da antiga
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO ticket_programming
           (ticket_id, legal_process_id, collaborator_id, activity_description, starts_at, ends_at,
            enterprise, block, unit, common_area_location, materials, equipment, tools,
            standalone_location, programming_type, created_by, is_finalization, completion_term_delivered, cancelled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, FALSE)
         RETURNING id`,
        [
          existing.ticket_id,
          existing.legal_process_id,
          targetCollabId,
          existing.activity_description,
          targetStartsAt,
          targetEndsAt,
          existing.enterprise,
          existing.block,
          existing.unit,
          existing.common_area_location,
          existing.materials,
          existing.equipment,
          existing.tools,
          existing.standalone_location,
          targetProgrammingType,
          userId,
          existing.is_finalization,
          existing.completion_term_delivered,
        ],
      )
      newProgrammingId = insertResult.rows[0].id
    } else if (reasonType === 'cliente') {
      finalReason = reasonNotes && reasonNotes.length > 0
        ? reasonNotes.trim()
        : 'Cancelamento por parte do cliente'
    } else if (reasonType === 'ac_engenharia') {
      finalReason = reasonNotes!.trim()
    }

    // Cancelar a atividade atual mantendo-a no histórico
    await client.query(
      `UPDATE ticket_programming
       SET cancelled = TRUE,
           cancellation_reason_type = $1,
           cancellation_reason = $2,
           cancellation_reassigned_to = $3,
           cancelled_at = now(),
           cancelled_by = $4,
           updated_at = now()
       WHERE id = $5`,
      [reasonType, finalReason, reassignedTargetId, userId, programmingId.data],
    )

    if (existing.ticket_id) {
      const actionSummary = reasonType === 'remanejamento'
        ? `Remanejou a programação de ${existing.collaborator_name}: ${finalReason}.`
        : reasonType === 'reagendamento'
          ? `Reagendou a programação de ${existing.collaborator_name}: ${finalReason}.`
          : `Cancelou a programação de ${existing.collaborator_name}: ${finalReason}.`

      await recordTicketActivity(
        client,
        existing.ticket_id,
        userId,
        'programming_cancelled',
        actionSummary,
        {
          programmingId: programmingId.data,
          reasonType,
          reason: finalReason,
          reassignedToCollaboratorId: reassignedTargetId,
          newProgrammingId,
          newProgrammingDate,
        },
      )
    }

    await client.query('COMMIT')
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'cancelled', entityId: programmingId.data })
    res.json({
      success: true,
      cancelledId: programmingId.data,
      reasonType,
      reason: finalReason,
      newProgrammingId,
      newProgrammingDate,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && /encontrado|afastado|Conflito|corresponde|Agenda bloqueada|Horário fora do expediente|dia útil/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.post('/:id/reactivate', requireAuth, async (req, res, next) => {
  const programmingId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!programmingId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{
      id: string
      ticket_id: string | null
      collaborator_id: string
      programming_type: 'general' | 'foreman'
      starts_at: Date
      ends_at: Date
      cancelled: boolean
      collaborator_name: string
    }>(
      `SELECT p.id, p.ticket_id, p.collaborator_id, p.programming_type, p.starts_at, p.ends_at,
              COALESCE(p.cancelled, FALSE) as cancelled, c.name as collaborator_name
       FROM ticket_programming p
       JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [programmingId.data],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    if (!existing.rows[0].cancelled) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Esta atividade não está cancelada.' })
      return
    }

    const conflicts = await validateAvailability(
      client,
      Number(existing.rows[0].collaborator_id),
      existing.rows[0].programming_type,
      existing.rows[0].ticket_id ? Number(existing.rows[0].ticket_id) : null,
      new Date(existing.rows[0].starts_at),
      new Date(existing.rows[0].ends_at),
      programmingId.data,
    )
    if (conflicts.length) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: `Não é possível reativar devido a conflito de agenda:\n${formatScheduleConflicts(conflicts)}` })
      return
    }

    await client.query(
      `UPDATE ticket_programming
       SET cancelled = FALSE,
           cancellation_reason_type = NULL,
           cancellation_reason = NULL,
           cancellation_reassigned_to = NULL,
           cancelled_at = NULL,
           cancelled_by = NULL,
           updated_at = now()
       WHERE id = $1`,
      [programmingId.data],
    )

    if (existing.rows[0].ticket_id) {
      await recordTicketActivity(
        client,
        existing.rows[0].ticket_id,
        req.session.user!.id,
        'programming_reactivated',
        `Reativou a programação cancelada de ${existing.rows[0].collaborator_name}.`,
        { programmingId: programmingId.data },
      )
    }

    await client.query('COMMIT')
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'reactivated', entityId: programmingId.data })
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
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
    invalidateHomeSummaryCache()
    void broadcastSyncEvent({ scope: 'programming', action: 'updated', entityId: programmingId.data })
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

router.get('/cvcrm-sync/status', requireAuth, async (_req, res, next) => {
  try {
    const status = await getCvcrmProgrammingSyncSettings()
    res.json(status)
  } catch (error) {
    next(error)
  }
})

router.post('/cvcrm-sync/run', requireAuth, async (req, res, next) => {
  try {
    const user = req.session.user!
    const result = await runCvcrmProgrammingCommentSync('manual', user.id)
    res.json(result)
  } catch (error) {
    if (error instanceof Error && /em andamento|CVCRM não configurado/.test(error.message)) {
      res.status(409).json({ error: error.message })
      return
    }
    next(error)
  }
})

export default router
