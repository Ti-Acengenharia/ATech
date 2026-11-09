import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { pool } from '../db.js'
import {
  getPublicWhatsAppSettings,
  saveWhatsAppSettings,
  sendWhatsAppTextMessage,
  testEvolutionConnection,
} from '../services/evolution-api.js'
import { getSessionTimeoutMinutes, setSessionTimeoutMinutes } from '../services/session-settings.js'
import { broadcastSyncEvent } from '../services/sync-events.js'

const router = Router()

const sessionTimeoutSchema = z.object({
  timeoutMinutes: z.number().int().min(15).max(10080),
})

router.get('/session-timeout', requireAuth, async (_req, res, next) => {
  try {
    const timeoutMinutes = await getSessionTimeoutMinutes()
    const result = await pool.query<{ updated_at: string; display_name: string | null }>(
      `SELECT s.updated_at, u.display_name
       FROM application_settings s
       LEFT JOIN users u ON u.id = s.updated_by
       WHERE s.setting_key = 'session_timeout_minutes'`,
    )

    res.json({
      timeoutMinutes,
      updatedAt: result.rows[0]?.updated_at ?? null,
      updatedByName: result.rows[0]?.display_name ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.put('/session-timeout', requireAdmin, async (req, res, next) => {
  const parsed = sessionTimeoutSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um tempo de sessão válido entre 15 minutos e 7 dias.' })
    return
  }

  try {
    const user = req.session.user!
    const result = await setSessionTimeoutMinutes(parsed.data.timeoutMinutes, user.id, user.displayName)

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'session_timeout',
      meta: { timeoutMinutes: result.timeoutMinutes },
    })

    res.json({
      success: true,
      timeoutMinutes: result.timeoutMinutes,
      updatedAt: result.updatedAt,
      updatedByName: user.displayName,
    })
  } catch (error) {
    next(error)
  }
})

const whatsappSettingsSchema = z.object({
  apiUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  instanceName: z.string().trim().optional(),
  programmingGroupJid: z.string().trim().optional(),
  foremanPhoneNumber: z.string().trim().optional(),
  autoDispatchEnabled: z.boolean().optional(),
})

router.get('/whatsapp', requireAuth, async (_req, res, next) => {
  try {
    const [publicSettings, metaRes, lastDispatchRes] = await Promise.all([
      getPublicWhatsAppSettings(),
      pool.query<{ updated_at: string; display_name: string | null }>(
        `SELECT s.updated_at, u.display_name
         FROM application_settings s
         LEFT JOIN users u ON u.id = s.updated_by
         WHERE s.setting_key = 'whatsapp_settings'`,
      ),
      pool.query<{ setting_value: string }>(
        `SELECT setting_value #>> '{}' AS setting_value
         FROM application_settings
         WHERE setting_key = 'whatsapp_programming_last_auto_dispatch'`,
      ),
    ])

    res.json({
      ...publicSettings,
      updatedAt: metaRes.rows[0]?.updated_at ?? null,
      updatedByName: metaRes.rows[0]?.display_name ?? null,
      lastAutoDispatchDate: lastDispatchRes.rows[0]?.setting_value ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.put('/whatsapp', requireAdmin, async (req, res, next) => {
  const parsed = whatsappSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados de configuração do WhatsApp inválidos.' })
    return
  }

  try {
    const user = req.session.user!
    await saveWhatsAppSettings(parsed.data, user.id)
    const publicSettings = await getPublicWhatsAppSettings()

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'whatsapp_settings',
      meta: { updatedBy: user.displayName },
    })

    res.json({
      success: true,
      ...publicSettings,
      updatedAt: new Date().toISOString(),
      updatedByName: user.displayName,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/whatsapp/test-connection', requireAdmin, async (_req, res, next) => {
  try {
    const result = await testEvolutionConnection()
    res.json(result)
  } catch (error) {
    next(error)
  }
})

const testSendSchema = z.object({
  target: z.string().min(1),
  message: z.string().min(1).default('Teste de integração Evolution API (ATech)'),
})

router.post('/whatsapp/test-send', requireAdmin, async (req, res, next) => {
  const parsed = testSendSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe o número de destino ou JID do grupo.' })
    return
  }

  try {
    await sendWhatsAppTextMessage({
      target: parsed.data.target,
      text: `🤖 *ATech — Teste de Conexão WhatsApp*\n\n${parsed.data.message}\n\nEnviado às ${new Date().toLocaleTimeString('pt-BR')} com sucesso!`,
    })
    res.json({ success: true, message: 'Mensagem de teste enviada com sucesso!' })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Falha ao enviar mensagem de teste.',
    })
  }
})

export default router


