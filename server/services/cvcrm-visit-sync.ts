import { env } from '../config.js'
import { pool } from '../db.js'

export type VisitDocumentVisibility = 'private' | 'public'

export interface CvcrmVisitSyncSettings {
  enabled: boolean
  declarationVisibility: VisitDocumentVisibility
  reportVisibility: VisitDocumentVisibility
}

const SETTINGS_KEY = 'cvcrm_visit_sync_settings'

const DEFAULT_SETTINGS: CvcrmVisitSyncSettings = {
  enabled: false,
  declarationVisibility: 'private',
  reportVisibility: 'private',
}

export async function getCvcrmVisitSyncSettings(): Promise<CvcrmVisitSyncSettings> {
  try {
    const res = await pool.query<{ setting_value: Partial<CvcrmVisitSyncSettings> }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = $1`,
      [SETTINGS_KEY],
    )
    const raw = res.rows[0]?.setting_value
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }

    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
      declarationVisibility: raw.declarationVisibility === 'public' ? 'public' : 'private',
      reportVisibility: raw.reportVisibility === 'public' ? 'public' : 'private',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveCvcrmVisitSyncSettings(
  input: CvcrmVisitSyncSettings,
  userId: number | null,
): Promise<CvcrmVisitSyncSettings> {
  const sanitized: CvcrmVisitSyncSettings = {
    enabled: Boolean(input.enabled),
    declarationVisibility: input.declarationVisibility === 'public' ? 'public' : 'private',
    reportVisibility: input.reportVisibility === 'public' ? 'public' : 'private',
  }

  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(sanitized), userId],
  )

  return sanitized
}

export async function sendCvcrmVisitDocumentComment(params: {
  ticketId: string | number
  protocol: string
  message: string
  isPublic: boolean
  fileName: string
  fileBuffer: Buffer
}): Promise<void> {
  if (!env.CVCRM_SUBDOMAIN || !env.CVCRM_API_EMAIL || !env.CVCRM_API_TOKEN) {
    throw new Error('CVCRM não configurado (defina CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env).')
  }

  const baseUrl = `https://${env.CVCRM_SUBDOMAIN}.cvcrm.com.br/api`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    email: env.CVCRM_API_EMAIL,
    token: env.CVCRM_API_TOKEN,
  }

  const base64Pdf = params.fileBuffer.toString('base64')
  const payload = {
    idatendimento: Number(params.ticketId),
    mensagem: params.message,
    cliente_visualiza: params.isPublic ? 'S' : 'N',
    arquivos: [
      {
        nome: params.fileName,
        tamanho_bytes: String(params.fileBuffer.length),
        tipo: 'application/pdf',
        base64: base64Pdf,
      },
    ],
  }

  const candidatePaths = [
    '/v1/relacionamento/atendimentos/mensagem-atendimento',
    `/v4/relacionamento/atendimentos/${encodeURIComponent(String(params.ticketId))}/mensagens`,
  ]

  let lastError = ''

  for (const path of candidatePaths) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      })

      const text = await response.text().catch(() => '')
      if (response.ok) {
        if (text) {
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>
            const code = typeof parsed.code === 'number'
              ? parsed.code
              : typeof parsed.codigo === 'number'
                ? parsed.codigo
                : Number(parsed.codigo ?? parsed.code)
            const hasLogicalError =
              parsed.erro === true ||
              parsed.sucesso === false ||
              parsed.status === false ||
              Boolean(parsed.error) ||
              (Number.isFinite(code) && code >= 400)

            if (hasLogicalError) {
              const errosList = Array.isArray(parsed.erros) ? parsed.erros.join(', ') : ''
              const msg = String(parsed.error || parsed.mensagem || errosList || text.slice(0, 220))
              lastError = `CVCRM recusou em ${path}: ${msg}`
              break
            }
          } catch {
            // Resposta não-JSON com HTTP 2xx considerada aceita
          }
        }
        return
      }

      lastError = `HTTP ${response.status} em ${path}${text ? `: ${text.slice(0, 220)}` : ''}`

      if (response.status !== 404 && response.status !== 405) {
        break
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Erro de rede ao comunicar com CVCRM'
    }
  }

  throw new Error(lastError || 'Falha ao enviar documento da visita ao CVCRM.')
}
