import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { recordTicketActivity } from '../services/ticket-activity.js'

const router = Router()

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const datetimeSchema = z.string().datetime({ offset: true })
const programmingTypeSchema = z.enum(['general', 'foreman']).default('general')
const programmingDetailsSchema = z.object({
  enterprise: z.string().trim().min(1).max(240),
  block: z.string().trim().max(120),
  unit: z.string().trim().max(120),
  commonAreaLocation: z.string().trim().max(240),
  materials: z.array(z.string().trim().min(1).max(120)).max(50),
  equipment: z.array(z.string().trim().min(1).max(120)).max(50),
  tools: z.array(z.string().trim().min(1).max(120)).max(50),
}).refine((entry) => Boolean(entry.commonAreaLocation || (entry.block && entry.unit)), {
  path: ['commonAreaLocation'],
  message: 'Informe bloco e unidade ou o local da área comum.',
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
  activityType: z.enum(['ticket', 'standalone']).default('ticket'),
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  collaboratorIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  startDate: dateSchema,
  endDate: dateSchema,
  occurrences: z.array(occurrenceSchema).min(1).max(65),
  activityDescription: z.string().trim().min(1).max(3000),
  standaloneLocation: z.string().trim().max(500).default(''),
}).merge(programmingDetailsSchema).superRefine((entry, context) => {
  if (entry.activityType === 'ticket' && !entry.ticketId) {
    context.addIssue({ code: 'custom', path: ['ticketId'], message: 'Selecione um chamado ou escolha atividade avulsa.' })
  }
  if (entry.activityType === 'standalone' && entry.ticketId) {
    context.addIssue({ code: 'custom', path: ['ticketId'], message: 'Atividades avulsas não podem estar vinculadas a um chamado.' })
  }
  if (entry.activityType === 'standalone' && !entry.standaloneLocation) {
    context.addIssue({ code: 'custom', path: ['standaloneLocation'], message: 'Descreva o local da atividade avulsa.' })
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
  activityType: z.enum(['ticket', 'standalone']).default('ticket'),
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  collaboratorId: z.coerce.number().int().positive(),
  date: dateSchema,
  startsAt: datetimeSchema,
  endsAt: datetimeSchema,
  activityDescription: z.string().trim().min(1).max(3000),
  standaloneLocation: z.string().trim().max(500).default(''),
}).merge(programmingDetailsSchema).refine((entry) => isValidDate(entry.date) &&
  datesInRange(entry.date, entry.date).length === 1 &&
  new Date(entry.endsAt) > new Date(entry.startsAt) &&
  (entry.activityType === 'ticket' ? Boolean(entry.ticketId) && !entry.standaloneLocation : !entry.ticketId && Boolean(entry.standaloneLocation)), {
  path: ['endsAt'],
  message: 'Informe uma associação e local válidos, um dia útil e um horário final posterior ao inicial.',
})

router.use(requireAuth, requirePageAccess('schedule'))

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

router.put('/role-visibility', async (req, res, next) => {
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
    res.json({
      hiddenRoleKeys: result.rows[0].setting_value,
      updatedAt: result.rows[0].updated_at,
    })
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
    }>(
      `SELECT c.id, c.name, c.nickname, c.role, r.label AS role_label,
              (c.photo_content IS NOT NULL) AS has_photo, c.is_on_leave
       FROM collaborators c
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE (c.termination_date IS NULL OR c.termination_date > $1::date)
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado'))
       ORDER BY lower(c.name), c.id`,
      [date, programmingType],
    ),
    pool.query<{
      id: string
      ticket_id: string | null
      collaborator_id: string
      activity_description: string
      starts_at: Date
      ends_at: Date
      protocol: string | null
      subject: string | null
      standalone_location: string
      enterprise: string
      block: string
      unit: string
      common_area_location: string
      materials: string[]
      equipment: string[]
      tools: string[]
      completed: boolean
      programming_type: 'general' | 'foreman'
      collaborator_name: string
      collaborator_role: string
      collaborator_role_label: string
      collaborator_photo_url: string | null
    }>(
      `SELECT p.id, p.ticket_id, p.collaborator_id, p.activity_description,
              p.starts_at, p.ends_at, t.protocol, t.subject, p.standalone_location, p.enterprise,
              p.block, p.unit, p.common_area_location,
              p.materials, p.equipment, p.tools, p.completed, p.programming_type,
              c.name AS collaborator_name,
              c.role AS collaborator_role, r.label AS collaborator_role_label,
              CASE WHEN c.photo_content IS NOT NULL THEN '/api/collaborators/' || c.id || '/photo' END AS collaborator_photo_url
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE p.starts_at < ($1::date + interval '1 day')
         AND p.ends_at > $1::date
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
      ...collaborator,
      photo_url: collaborator.has_photo ? `/api/collaborators/${collaborator.id}/photo` : null,
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
    const result = await pool.query(
      `SELECT id, ticket_id, starts_at, ends_at
       FROM ticket_programming
       WHERE collaborator_id = $1
         AND starts_at < ($3::date + interval '1 day')
         AND ends_at > $2::date
         AND ($4::bigint IS NULL OR id <> $4)
       ORDER BY starts_at`,
      [collaboratorId.data, startDate.data, endDate.data, excludeId.data],
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
  const collaborator = await client.query<{ is_on_leave: boolean; role: string }>(
    `SELECT is_on_leave, role FROM collaborators
     WHERE id = $1 AND (termination_date IS NULL OR termination_date > CURRENT_DATE)
     FOR UPDATE`,
    [collaboratorId],
  )
  if (!collaborator.rows[0]) throw new Error('Colaborador ativo não encontrado.')
  if (collaborator.rows[0].is_on_leave) throw new Error('Este colaborador está afastado e não pode receber programação.')
  if ((programmingType === 'foreman') !== (collaborator.rows[0].role === 'encarregado')) {
    throw new Error('A programação selecionada não corresponde ao cargo do colaborador.')
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
    starts_at: Date
    ends_at: Date
  }>(
    `SELECT p.id, t.protocol, p.starts_at, p.ends_at
     FROM ticket_programming p LEFT JOIN tickets t ON t.source_id = p.ticket_id
     WHERE p.collaborator_id = $1 AND p.starts_at < $3 AND p.ends_at > $2
       AND ($4::bigint IS NULL OR p.id <> $4)
     LIMIT 1`,
    [collaboratorId, startsAt, endsAt, excludeId ?? null],
  )
  if (conflict.rows[0]) {
    const starts = conflict.rows[0].starts_at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const ends = conflict.rows[0].ends_at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    throw new Error(`Conflito com ${conflict.rows[0].protocol ? `o chamado ${conflict.rows[0].protocol}` : 'uma atividade avulsa'}, programado das ${starts} às ${ends}.`)
  }
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
    const collaboratorNames = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM collaborators WHERE id = ANY($1::bigint[])',
      [collaboratorIds],
    )
    const collaboratorNameById = new Map(collaboratorNames.rows.map((row) => [Number(row.id), row.name]))
    for (const collaboratorId of collaboratorIds) {
      for (const occurrence of data.occurrences) {
        await validateAvailability(
          client,
          collaboratorId,
          data.programmingType,
          data.ticketId ?? null,
          new Date(occurrence.startsAt),
          new Date(occurrence.endsAt),
        )
      }
    }

    const ids: string[] = []
    for (const collaboratorId of collaboratorIds) {
      for (const occurrence of data.occurrences) {
        const result = await client.query<{ id: string }>(
          `INSERT INTO ticket_programming
              (ticket_id, collaborator_id, activity_description, starts_at, ends_at,
               enterprise, block, unit, common_area_location, materials, equipment, tools,
               standalone_location, programming_type, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
            [
              data.ticketId ?? null, collaboratorId, data.activityDescription, occurrence.startsAt, occurrence.endsAt,
              data.enterprise, data.block, data.unit, data.commonAreaLocation, data.materials, data.equipment, data.tools,
              data.standaloneLocation,
              data.programmingType,
              req.session.user!.id,
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
      collaborator_name: string
    }>(
      `SELECT p.ticket_id, p.collaborator_id, p.activity_description, p.enterprise, p.block, p.unit,
              p.common_area_location, p.materials, p.equipment, p.tools, p.starts_at, p.ends_at,
              p.programming_type,
              p.standalone_location, t.protocol, c.name AS collaborator_name
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       JOIN collaborators c ON c.id = p.collaborator_id
       WHERE p.id = $1 FOR UPDATE OF p`,
      [programmingId.data],
    )
    if (!previous.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Programação não encontrada.' })
      return
    }
    await validateAvailability(
      client,
      data.collaboratorId,
      data.programmingType,
      data.ticketId ?? null,
      new Date(data.startsAt),
      new Date(data.endsAt),
      programmingId.data,
    )
    const result = await client.query<{ ticket_id: string }>(
      `UPDATE ticket_programming SET ticket_id = $1, collaborator_id = $2,
         activity_description = $3, starts_at = $4, ends_at = $5, enterprise = $6, block = $7,
         unit = $8, common_area_location = $9, materials = $10, equipment = $11, tools = $12,
         standalone_location = $13, programming_type = $14, updated_at = now()
       WHERE id = $15 RETURNING ticket_id`,
      [
        data.ticketId ?? null, data.collaboratorId, data.activityDescription, data.startsAt, data.endsAt, data.enterprise,
        data.block, data.unit, data.commonAreaLocation, data.materials, data.equipment, data.tools, data.standaloneLocation,
        data.programmingType, programmingId.data,
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
  const parsed = z.object({ completed: z.boolean() }).safeParse(req.body)
  if (!programmingId.success || !parsed.success) {
    res.status(400).json({ error: 'Identificador ou status de conclusão inválido.' })
    return
  }
  try {
    const result = await pool.query(
      'UPDATE ticket_programming SET completed = $1, updated_at = now() WHERE id = $2',
      [parsed.data.completed, programmingId.data],
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

export default router