import { z } from 'zod'
import { env } from '../config.js'
import { pool } from '../db.js'

export const DEFAULT_SIENGE_DAILY_REQUEST_LIMIT = 100
export const MAX_SIENGE_DAILY_REQUEST_LIMIT = 200_000

const siengeSettingsSchema = z.object({
  dailyRequestLimit: z.number().int().min(1).max(MAX_SIENGE_DAILY_REQUEST_LIMIT).default(DEFAULT_SIENGE_DAILY_REQUEST_LIMIT),
  issueDocumentId: z.string().trim().max(20).default(''),
  issueMovementTypeId: z.number().int().positive().nullable().default(null),
  epiDocumentId: z.string().trim().max(20).default(''),
  epiMovementTypeId: z.number().int().positive().nullable().default(null),
  uniformDocumentId: z.string().trim().max(20).default(''),
  uniformMovementTypeId: z.number().int().positive().nullable().default(null),
  transferDocumentId: z.string().trim().max(20).default(''),
  transferMovementTypeId: z.number().int().positive().nullable().default(null),
})

export type SiengeStockSettings = z.infer<typeof siengeSettingsSchema>

export const isSiengeConfigured = (): boolean =>
  Boolean(env.SIENGE_SUBDOMAIN && env.SIENGE_API_USERNAME && env.SIENGE_API_PASSWORD)

export class SiengeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly externalStatus: number | null = null,
    readonly outcomeUnknown = false,
  ) {
    super(message)
    this.name = 'SiengeRequestError'
  }
}

function getUsageDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Maceio',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function getSiengeStockSettings(): Promise<SiengeStockSettings> {
  const result = await pool.query<{ setting_value: unknown }>(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'sienge_stock_settings'`,
  )
  if (!result.rowCount) {
    return {
      dailyRequestLimit: DEFAULT_SIENGE_DAILY_REQUEST_LIMIT,
      issueDocumentId: '',
      issueMovementTypeId: null,
      epiDocumentId: '',
      epiMovementTypeId: null,
      uniformDocumentId: '',
      uniformMovementTypeId: null,
      transferDocumentId: '',
      transferMovementTypeId: null,
    }
  }

  const parsed = siengeSettingsSchema.safeParse(result.rows[0].setting_value)
  if (!parsed.success) {
    throw new Error('As configurações de estoque do Sienge salvas no banco são inválidas.')
  }
  return parsed.data
}

export async function getSiengeDailyUsage(): Promise<{ usageDate: string; requestCount: number }> {
  const usageDate = getUsageDate()
  const result = await pool.query<{ request_count: number }>(
    `SELECT request_count FROM sienge_api_daily_usage WHERE usage_date = $1::date`,
    [usageDate],
  )
  return {
    usageDate,
    requestCount: result.rows[0]?.request_count ?? 0,
  }
}

async function reserveDailyRequest(limit: number): Promise<void> {
  const usageDate = getUsageDate()
  const reserved = await pool.query(
    `INSERT INTO sienge_api_daily_usage (usage_date, request_count, updated_at)
     VALUES ($1::date, 1, now())
     ON CONFLICT (usage_date)
     DO UPDATE SET request_count = sienge_api_daily_usage.request_count + 1,
                   updated_at = now()
     WHERE sienge_api_daily_usage.request_count < $2
     RETURNING request_count`,
    [usageDate, limit],
  )
  if (reserved.rowCount) return

  throw new SiengeRequestError(
    `O limite diário de ${limit} requisições ao Sienge foi atingido.`,
    429,
  )
}

function redactCredentials(text: string): string {
  return [env.SIENGE_API_USERNAME, env.SIENGE_API_PASSWORD]
    .filter((value): value is string => Boolean(value))
    .reduce((safeText, secret) => safeText.replaceAll(secret, '[credencial]'), text)
    .slice(0, 500)
}

async function siengeRequest(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
  if (!isSiengeConfigured()) {
    throw new SiengeRequestError(
      'Configure SIENGE_SUBDOMAIN, SIENGE_API_USERNAME e SIENGE_API_PASSWORD no ambiente do backend.',
      503,
    )
  }

  const settings = await getSiengeStockSettings()
  await reserveDailyRequest(settings.dailyRequestLimit)

  let response: Response
  try {
    response = await fetch(
      `https://api.sienge.com.br/${env.SIENGE_SUBDOMAIN}/public/api/v1${path}`,
      {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${env.SIENGE_API_USERNAME}:${env.SIENGE_API_PASSWORD}`).toString('base64')}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new SiengeRequestError('O Sienge não respondeu em até 30 segundos.', 504, null, method === 'POST')
    }
    throw new SiengeRequestError('Não foi possível conectar à API do Sienge.', 502, null, method === 'POST')
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = ''
    try {
      const payload: unknown = JSON.parse(body)
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        const developerMessage = typeof record.developerMessage === 'string' ? record.developerMessage : ''
        const userMessage = Array.isArray(record.userMessage)
          ? record.userMessage.filter((message): message is string => typeof message === 'string').join(' ')
          : ''
        detail = developerMessage || userMessage
      }
    } catch {
      detail = ''
    }
    const safeDetail = detail ? ` ${redactCredentials(detail)}` : ''
    throw new SiengeRequestError(
      `O Sienge respondeu HTTP ${response.status}.${safeDetail}`,
      502,
      response.status,
      method === 'POST' && response.status >= 500,
    )
  }

  return response
}

export function siengeGet(path: string): Promise<Response> {
  return siengeRequest(path, 'GET')
}

export async function siengePost(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await siengeRequest(path, 'POST', body)
  const responseText = await response.text()
  if (!responseText.trim()) return { status: response.status, body: null }
  try {
    return { status: response.status, body: JSON.parse(responseText) as unknown }
  } catch {
    return { status: response.status, body: { message: responseText.slice(0, 1000) } }
  }
}

export async function testSiengeStockAccess(costCenterId: number): Promise<{ returnedItems: number }> {
  const response = await siengeGet(
    `/stock-inventories/${costCenterId}/items?offset=0&limit=1`,
  )
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' ||
      !('results' in payload) || !Array.isArray(payload.results)) {
    throw new SiengeRequestError('O Sienge respondeu em formato inesperado para a consulta de estoque.', 502)
  }
  return { returnedItems: payload.results.length }
}
