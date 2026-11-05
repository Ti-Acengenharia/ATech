import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { pool } from '../db.js'
import { broadcastSyncEvent } from '../services/sync-events.js'

export interface WorkingHours {
  monday_thursday: { start: string; end: string }
  friday: { start: string; end: string }
  work_saturday: { start: string; end: string }
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday_thursday: { start: '08:00', end: '18:00' },
  friday: { start: '08:00', end: '17:00' },
  work_saturday: { start: '08:00', end: '18:00' },
}

export async function getWorkingHoursSetting(
  client: import('pg').PoolClient | import('pg').Pool = pool,
): Promise<WorkingHours> {
  try {
    const result = await client.query<{ setting_value: WorkingHours }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = 'working_hours'`,
    )
    if (!result.rows[0]?.setting_value) return DEFAULT_WORKING_HOURS
    const v = result.rows[0].setting_value
    return {
      monday_thursday: v.monday_thursday ?? DEFAULT_WORKING_HOURS.monday_thursday,
      friday: v.friday ?? DEFAULT_WORKING_HOURS.friday,
      work_saturday: v.work_saturday ?? DEFAULT_WORKING_HOURS.work_saturday,
    }
  } catch {
    return DEFAULT_WORKING_HOURS
  }
}

export function parseMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function parseDateToIso(rawDate: string): string | null {
  const clean = rawDate.trim()
  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    const dt = new Date(`${iso}T12:00:00Z`)
    if (!Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso) return iso
    return null
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    const dt = new Date(`${iso}T12:00:00Z`)
    if (!Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso) return iso
    return null
  }
  return null
}

const router = Router()

// GET /api/calendar - Lista feriados, sábados trabalhados e jornada
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const [calendarResult, workingHours] = await Promise.all([
      pool.query<{
        id: string
        date: string
        type: 'holiday' | 'work_saturday'
        description: string
        created_at: string
        created_by_name: string | null
      }>(
        `SELECT c.id, c.date::text, c.type, c.description, c.created_at, u.display_name AS created_by_name
         FROM work_calendar c
         LEFT JOIN users u ON u.id = c.created_by
         ORDER BY c.date ASC`,
      ),
      getWorkingHoursSetting(),
    ])

    const holidays = calendarResult.rows.filter((r) => r.type === 'holiday')
    const workSaturdays = calendarResult.rows.filter((r) => r.type === 'work_saturday')

    res.json({
      holidays: holidays.map((r) => ({
        id: r.id,
        date: r.date,
        description: r.description,
        type: r.type,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      })),
      workSaturdays: workSaturdays.map((r) => ({
        id: r.id,
        date: r.date,
        description: r.description,
        type: r.type,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      })),
      workingHours,
    })
  } catch (error) {
    next(error)
  }
})

const calendarEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD'),
  type: z.enum(['holiday', 'work_saturday']),
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(255),
})

// POST /api/calendar - Adiciona feriado ou sábado trabalhado
router.post('/', requireAdmin, async (req, res, next) => {
  const parsed = calendarEntrySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' })
    return
  }

  const { date, type, description } = parsed.data
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay()

  if (type === 'work_saturday' && dayOfWeek !== 6) {
    res.status(400).json({ error: 'A data informada para sábado trabalhado não cai em um sábado.' })
    return
  }

  try {
    const result = await pool.query<{
      id: string
      date: string
      type: 'holiday' | 'work_saturday'
      description: string
      created_at: string
    }>(
      `INSERT INTO work_calendar (date, type, description, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date) DO UPDATE
       SET type = EXCLUDED.type, description = EXCLUDED.description, created_by = EXCLUDED.created_by
       RETURNING id, date::text, type, description, created_at`,
      [date, type, description, req.session.user!.id],
    )

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'work_calendar_updated',
      meta: { date, type, description },
    })

    res.status(201).json({
      success: true,
      entry: result.rows[0],
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/calendar/:id - Exclui feriado ou sábado trabalhado
router.delete('/:id', requireAdmin, async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }

  try {
    const result = await pool.query(
      `DELETE FROM work_calendar WHERE id = $1 RETURNING id, date::text, type, description`,
      [id.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Registro não encontrado.' })
      return
    }

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'work_calendar_updated',
      meta: { id: id.data },
    })

    res.json({ success: true, deleted: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

const workingHoursSchema = z.object({
  monday_thursday: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inicial inválido'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário final inválido'),
  }),
  friday: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inicial inválido'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário final inválido'),
  }),
  work_saturday: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inicial inválido'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário final inválido'),
  }),
})

// PUT /api/calendar/working-hours - Atualiza jornada de trabalho
router.put('/working-hours', requireAdmin, async (req, res, next) => {
  const parsed = workingHoursSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Horários inválidos.' })
    return
  }

  const { monday_thursday, friday, work_saturday } = parsed.data

  if (parseMinutes(monday_thursday.start) >= parseMinutes(monday_thursday.end)) {
    res.status(400).json({ error: 'O horário inicial de segunda a quinta deve ser menor que o horário final.' })
    return
  }
  if (parseMinutes(friday.start) >= parseMinutes(friday.end)) {
    res.status(400).json({ error: 'O horário inicial de sexta-feira deve ser menor que o horário final.' })
    return
  }
  if (parseMinutes(work_saturday.start) >= parseMinutes(work_saturday.end)) {
    res.status(400).json({ error: 'O horário inicial de sábado trabalhado deve ser menor que o horário final.' })
    return
  }

  try {
    const hoursData: WorkingHours = { monday_thursday, friday, work_saturday }
    await pool.query(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('working_hours', $1::jsonb, now(), $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(hoursData), req.session.user!.id],
    )

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'working_hours_updated',
      meta: {
        monday_thursday: hoursData.monday_thursday,
        friday: hoursData.friday,
        work_saturday: hoursData.work_saturday,
      },
    })

    res.json({ success: true, workingHours: hoursData })
  } catch (error) {
    next(error)
  }
})

// POST /api/calendar/upload-csv - Importação de modelo CSV de feriados
router.post('/upload-csv', requireAdmin, async (req, res, next) => {
  const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : null
  if (!csvText || !csvText.trim()) {
    res.status(400).json({ error: 'Conteúdo CSV não fornecido.' })
    return
  }

  const lines = csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
  if (!lines.length) {
    res.status(400).json({ error: 'O arquivo CSV está vazio.' })
    return
  }

  const imported: Array<{ date: string; description: string }> = []
  const errors: string[] = []

  let startIndex = 0
  const firstLine = lines[0].toLowerCase()
  // Se a primeira linha contiver cabeçalho como 'data', 'date', 'feriado'
  if (firstLine.includes('data') || firstLine.includes('date') || firstLine.includes('feriado')) {
    startIndex = 1
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]
    // Detecta separador (, ou ;)
    const delimiter = line.includes(';') ? ';' : ','
    const parts = line.split(delimiter).map((p: string) => p.trim().replace(/^["']|["']$/g, ''))
    if (!parts.length || !parts[0]) continue

    const rawDate = parts[0]
    const description = parts[1] || 'Feriado'

    const isoDate = parseDateToIso(rawDate)
    if (!isoDate) {
      errors.push(`Linha ${i + 1}: Data inválida "${rawDate}". Formatos aceitos: AAAA-MM-DD ou DD/MM/AAAA.`)
      continue
    }

    imported.push({ date: isoDate, description: description.slice(0, 255) })
  }

  if (!imported.length) {
    res.status(400).json({
      error: 'Nenhum feriado válido encontrado no arquivo.',
      errors,
    })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let insertedCount = 0
    for (const item of imported) {
      await client.query(
        `INSERT INTO work_calendar (date, type, description, created_by)
         VALUES ($1, 'holiday', $2, $3)
         ON CONFLICT (date) DO UPDATE
         SET type = 'holiday', description = EXCLUDED.description, created_by = EXCLUDED.created_by`,
        [item.date, item.description, req.session.user!.id],
      )
      insertedCount++
    }
    await client.query('COMMIT')

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'work_calendar_updated',
      meta: { count: insertedCount },
    })

    res.json({
      success: true,
      importedCount: insertedCount,
      errors,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

export default router
