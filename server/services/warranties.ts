import { pool } from '../db.js'

export type WarrantyStatus = 'within' | 'outside' | 'undetermined'

export interface TicketWarranty {
  status: WarrantyStatus
  reason: string
  deliveryDate: string | null
  expiresAt: string | null
  warrantyYears: number | null
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null
}

function addCalendarYears(value: string, years: number) {
  const [year, month, day] = value.split('-').map(Number)
  const targetYear = year + years
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDayOfTargetMonth)
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

export function evaluateTicketWarranty(input: {
  subjectId: number | null
  subject: string
  openedDate: string | null
  deliveryDate: string | null
  warrantyYears: number | null
}): TicketWarranty | null {
  const normalizedSubject = input.subject
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
  if (input.subjectId !== 16 && (input.subjectId !== null || normalizedSubject !== 'assistencia tecnica')) {
    return null
  }

  const deliveryDate = validDate(input.deliveryDate)
  const openedDate = validDate(input.openedDate)
  const warrantyYears = input.warrantyYears
  if (warrantyYears === null || !Number.isInteger(warrantyYears) || warrantyYears < 1) {
    return { status: 'undetermined', reason: 'Prazo não configurado para este subassunto.', deliveryDate, expiresAt: null, warrantyYears: null }
  }
  if (!deliveryDate) {
    return { status: 'undetermined', reason: 'Data de entrega do empreendimento não informada.', deliveryDate: null, expiresAt: null, warrantyYears }
  }
  if (!openedDate) {
    return { status: 'undetermined', reason: 'Data de abertura do chamado não informada.', deliveryDate, expiresAt: null, warrantyYears }
  }

  const expiresAt = addCalendarYears(deliveryDate, warrantyYears)
  const within = openedDate >= deliveryDate && openedDate <= expiresAt
  return {
    status: within ? 'within' : 'outside',
    reason: within ? 'Chamado aberto dentro do prazo de garantia.' : 'Chamado aberto fora do prazo de garantia.',
    deliveryDate,
    expiresAt,
    warrantyYears,
  }
}

export async function getTicketWarranty(sourceId: number): Promise<TicketWarranty | null> {
  const result = await pool.query<{
    subject_id: number | null
    subject: string
    opened_date: string | null
    delivery_date: string | null
    warranty_years: number | null
  }>(
    `SELECT t.source_subject_id AS subject_id, t.subject,
            t.opened_at::date::text AS opened_date,
            ei.condominium_delivery_date::text AS delivery_date,
            (
              SELECT w.warranty_years
              FROM warranty_subsubjects w
              WHERE w.source_subject_id = COALESCE(t.source_subject_id, 16)
                AND (
                  (t.source_subsubject_id IS NOT NULL AND w.source_subsubject_id = t.source_subsubject_id)
                  OR (t.source_subsubject_id IS NULL AND lower(w.name) = lower(t.subsubject))
                )
              ORDER BY CASE WHEN w.source_subsubject_id = t.source_subsubject_id THEN 0 ELSE 1 END
              LIMIT 1
            ) AS warranty_years
     FROM tickets t
     LEFT JOIN enterprise_information ei ON ei.enterprise_key = lower(btrim(t.enterprise))
     WHERE t.source_id = $1`,
    [sourceId],
  )
  const ticket = result.rows[0]
  if (!ticket) return null
  return evaluateTicketWarranty({
    subjectId: ticket.subject_id,
    subject: ticket.subject,
    openedDate: ticket.opened_date,
    deliveryDate: ticket.delivery_date,
    warrantyYears: ticket.warranty_years === null ? null : Number(ticket.warranty_years),
  })
}
