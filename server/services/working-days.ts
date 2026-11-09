import { APP_TIMEZONE } from '../config.js'
import { pool } from '../db.js'

/**
 * Retorna a data atual no fuso horário da aplicação (America/Maceio) no formato YYYY-MM-DD
 */
export function getTodayDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

/**
 * Adiciona N dias a uma data YYYY-MM-DD
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

/**
 * Obtém o dia da semana (0 = Domingo, 1 = Segunda, ..., 6 = Sábado) para YYYY-MM-DD
 */
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

/**
 * Verifica se um dia específico é dia útil, considerando:
 * - Domingos: nunca são úteis
 * - Sábados: úteis apenas se cadastrados como 'work_saturday' na tabela work_calendar
 * - Segunda a Sexta: úteis a menos que cadastrados como 'holiday' na tabela work_calendar
 */
export async function isWorkingDay(dateStr: string): Promise<boolean> {
  const dayOfWeek = getDayOfWeek(dateStr)

  if (dayOfWeek === 0) {
    // Domingo
    return false
  }

  const calendarEntry = await pool.query<{ type: 'holiday' | 'work_saturday' }>(
    `SELECT type FROM work_calendar WHERE date = $1::date LIMIT 1`,
    [dateStr],
  )

  const entryType = calendarEntry.rows[0]?.type

  if (dayOfWeek === 6) {
    // Sábado só é útil se for compensação cadastrada
    return entryType === 'work_saturday'
  }

  // Segunda a Sexta: não é útil se for feriado
  return entryType !== 'holiday'
}

/**
 * Encontra o próximo dia útil a partir de uma data de referência (padrão: hoje em Maceió)
 */
export async function getNextWorkingDay(fromReferenceDate?: string): Promise<string> {
  const start = fromReferenceDate || getTodayDateString()
  let current = start

  for (let i = 1; i <= 30; i += 1) {
    current = addDaysToDateString(start, i)
    const working = await isWorkingDay(current)
    if (working) {
      return current
    }
  }

  // Fallback caso todos os 30 dias falhem (improvável)
  return addDaysToDateString(start, 1)
}

