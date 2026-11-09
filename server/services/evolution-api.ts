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
 * Obtém as configurações do WhatsApp com credenciais exclusivamente das variáveis de ambiente (.env)
 * O status do disparo automático pode ser alternado pelo .env (EVOLUTION_AUTO_DISPATCH_ENABLED)
 * ou pela tela de preferências operacionais do sistema.
 */
export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  const apiUrl = (env.EVOLUTION_API_URL || '').replace(/\/+$/, '')
  const apiKey = env.EVOLUTION_API_KEY || ''
  const instanceName = env.EVOLUTION_INSTANCE_NAME || ''
  const programmingGroupJid = env.EVOLUTION_PROGRAMMING_GROUP_JID || ''
  const foremanPhoneNumber = env.EVOLUTION_FOREMAN_PHONE_NUMBER || ''

  let autoDispatchEnabled = env.EVOLUTION_AUTO_DISPATCH_ENABLED ?? true

  try {
    const res = await pool.query<{ setting_value: string | boolean }>(
      `SELECT setting_value #>> '{}' AS setting_value
       FROM application_settings
       WHERE setting_key = 'whatsapp_programming_auto_dispatch_enabled'`,
    )
    if (res.rows[0]?.setting_value !== undefined && res.rows[0]?.setting_value !== null) {
      const val = res.rows[0].setting_value
      autoDispatchEnabled = val === true || val === 'true' || val === '1'
    }
  } catch {
    // Mantém o padrão do .env se a tabela ainda não estiver disponível
  }

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
 * Retorna o status das configurações para exibição no frontend (oculta a chave)
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
 * Testa o estado da conexão na Evolution API usando as credenciais do .env
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
      message: 'Evolution API não configurada no .env da VPS. Defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME.',
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
    throw new Error('Evolution API não está configurada no .env do servidor.')
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
    throw new Error('Evolution API não está configurada no .env do servidor.')
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

