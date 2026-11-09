import { env } from '../config.js'
import { pool } from '../db.js'

export interface WhatsAppSettings {
  apiUrl: string
  apiKey: string
  instanceName: string
  programmingGroupJid: string
  foremanPhoneNumber: string
  autoDispatchEnabled: boolean
}

export interface WhatsAppPublicSettings {
  apiUrl: string
  hasApiKey: boolean
  instanceName: string
  programmingGroupJid: string
  foremanPhoneNumber: string
  autoDispatchEnabled: boolean
  isConfigured: boolean
}

/**
 * Normaliza o destino (grupo ou número individual de telefone)
 */
export function normalizeWhatsAppTarget(target: string): string {
  const clean = target.trim()
  if (!clean) return ''

  // Se já tiver sufixo de grupo ou de usuário WhatsApp
  if (clean.includes('@g.us') || clean.includes('@s.whatsapp.net')) {
    return clean
  }

  // Se for ID de grupo composto (ex: 120363028374829102)
  if (clean.startsWith('120363') || clean.includes('-')) {
    return clean.endsWith('@g.us') ? clean : `${clean}@g.us`
  }

  // Número de telefone: remove caracteres não numéricos
  const digits = clean.replace(/\D/g, '')
  if (!digits) return clean

  // Se tiver 10 ou 11 dígitos (DDD + número no Brasil sem DDI 55)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }

  return digits
}

/**
 * Obtém as configurações do WhatsApp combinando o banco de dados e as variáveis de ambiente
 */
export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  let dbSettings: Partial<WhatsAppSettings> = {}

  try {
    const result = await pool.query<{ setting_value: Partial<WhatsAppSettings> }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = 'whatsapp_settings'`,
    )
    if (result.rows[0]?.setting_value) {
      dbSettings = result.rows[0].setting_value
    }
  } catch (err) {
    console.error('[EvolutionAPI] Erro ao carregar configurações do banco:', err)
  }

  const apiUrl = (dbSettings.apiUrl?.trim() || env.EVOLUTION_API_URL || '').replace(/\/+$/, '')
  const apiKey = dbSettings.apiKey?.trim() || env.EVOLUTION_API_KEY || ''
  const instanceName = dbSettings.instanceName?.trim() || env.EVOLUTION_INSTANCE_NAME || ''
  const programmingGroupJid = dbSettings.programmingGroupJid?.trim() || env.EVOLUTION_PROGRAMMING_GROUP_JID || ''
  const foremanPhoneNumber = dbSettings.foremanPhoneNumber?.trim() || env.EVOLUTION_FOREMAN_PHONE_NUMBER || ''
  const autoDispatchEnabled = dbSettings.autoDispatchEnabled ?? true

  return {
    apiUrl,
    apiKey,
    instanceName,
    programmingGroupJid,
    foremanPhoneNumber,
    autoDispatchEnabled,
  }
}

/**
 * Retorna as configurações seguras para exibição no frontend (oculta a chave)
 */
export async function getPublicWhatsAppSettings(): Promise<WhatsAppPublicSettings> {
  const settings = await getWhatsAppSettings()
  return {
    apiUrl: settings.apiUrl,
    hasApiKey: Boolean(settings.apiKey),
    instanceName: settings.instanceName,
    programmingGroupJid: settings.programmingGroupJid,
    foremanPhoneNumber: settings.foremanPhoneNumber,
    autoDispatchEnabled: settings.autoDispatchEnabled,
    isConfigured: Boolean(settings.apiUrl && settings.apiKey && settings.instanceName),
  }
}

/**
 * Salva as configurações de WhatsApp no banco
 */
export async function saveWhatsAppSettings(
  newSettings: Partial<WhatsAppSettings>,
  userId?: string | number,
): Promise<WhatsAppSettings> {
  const current = await getWhatsAppSettings()

  const updated: WhatsAppSettings = {
    apiUrl: newSettings.apiUrl !== undefined ? newSettings.apiUrl.trim() : current.apiUrl,
    apiKey: newSettings.apiKey !== undefined && newSettings.apiKey.trim() !== ''
      ? newSettings.apiKey.trim()
      : current.apiKey,
    instanceName: newSettings.instanceName !== undefined ? newSettings.instanceName.trim() : current.instanceName,
    programmingGroupJid: newSettings.programmingGroupJid !== undefined ? newSettings.programmingGroupJid.trim() : current.programmingGroupJid,
    foremanPhoneNumber: newSettings.foremanPhoneNumber !== undefined ? newSettings.foremanPhoneNumber.trim() : current.foremanPhoneNumber,
    autoDispatchEnabled: newSettings.autoDispatchEnabled !== undefined ? Boolean(newSettings.autoDispatchEnabled) : current.autoDispatchEnabled,
  }

  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ('whatsapp_settings', $1::jsonb, now(), $2::bigint)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(updated), userId ?? null],
  )

  return updated
}

/**
 * Testa o estado da conexão na Evolution API
 */
export async function testEvolutionConnection(): Promise<{
  ok: boolean
  state?: string
  instanceName?: string
  message: string
}> {
  const config = await getWhatsAppSettings()
  if (!config.apiUrl || !config.apiKey || !config.instanceName) {
    return {
      ok: false,
      message: 'Evolution API não configurada. Preencha URL, Chave de API e Nome da Instância.',
    }
  }

  try {
    const url = `${config.apiUrl}/instance/connectionState/${encodeURIComponent(config.instanceName)}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: config.apiKey,
      },
    })

    if (!res.ok) {
      const errorText = await res.text()
      return {
        ok: false,
        message: `Falha na requisição à Evolution API (HTTP ${res.status}): ${errorText.slice(0, 160)}`,
      }
    }

    const data = await res.json() as { instance?: { state?: string }; state?: string }
    const state = data.instance?.state || data.state || 'desconhecido'

    const isConnected = state.toLowerCase() === 'open'

    return {
      ok: isConnected,
      state,
      instanceName: config.instanceName,
      message: isConnected
        ? `Instância "${config.instanceName}" conectada com sucesso (estado: ${state}).`
        : `Instância "${config.instanceName}" encontrada, porém não está conectada ao WhatsApp (estado: ${state}). Conecte o QR Code na Evolution API.`,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Erro ao conectar com a Evolution API: ${err instanceof Error ? err.message : 'Falha na comunicação de rede'}`,
    }
  }
}

/**
 * Envia um documento PDF via Evolution API
 */
export async function sendWhatsAppPdfDocument({
  target,
  pdfBuffer,
  fileName,
  caption,
}: {
  target: string
  pdfBuffer: Buffer
  fileName: string
  caption: string
}): Promise<{ ok: boolean; responseData?: unknown }> {
  const config = await getWhatsAppSettings()
  if (!config.apiUrl || !config.apiKey || !config.instanceName) {
    throw new Error('Evolution API não está configurada no servidor.')
  }

  const normalizedTarget = normalizeWhatsAppTarget(target)
  if (!normalizedTarget) {
    throw new Error('Destinatário do WhatsApp não informado.')
  }

  const base64Pdf = pdfBuffer.toString('base64')
  const url = `${config.apiUrl}/message/sendMedia/${encodeURIComponent(config.instanceName)}`

  const payload = {
    number: normalizedTarget,
    media: base64Pdf,
    mediatype: 'document',
    mediaType: 'document',
    mimetype: 'application/pdf',
    fileName: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
    caption,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Erro ao enviar documento pelo WhatsApp (HTTP ${res.status}): ${errorText.slice(0, 200)}`)
  }

  const responseData = await res.json().catch(() => null)
  return { ok: true, responseData }
}

/**
 * Envia uma mensagem de texto simples pelo WhatsApp (útil para testes ou avisos)
 */
export async function sendWhatsAppTextMessage({
  target,
  text,
}: {
  target: string
  text: string
}): Promise<{ ok: boolean; responseData?: unknown }> {
  const config = await getWhatsAppSettings()
  if (!config.apiUrl || !config.apiKey || !config.instanceName) {
    throw new Error('Evolution API não está configurada no servidor.')
  }

  const normalizedTarget = normalizeWhatsAppTarget(target)
  if (!normalizedTarget) {
    throw new Error('Destino da mensagem do WhatsApp não informado.')
  }

  const url = `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instanceName)}`

  const payload = {
    number: normalizedTarget,
    text,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Erro ao enviar mensagem pelo WhatsApp (HTTP ${res.status}): ${errorText.slice(0, 200)}`)
  }

  const responseData = await res.json().catch(() => null)
  return { ok: true, responseData }
}

