import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { pool } from '../db.js'
import {
  getPublicWhatsAppSettings,
  sendWhatsAppTextMessage,
  testEvolutionConnection,
} from '../services/evolution-api.js'
import {
  getCvcrmProgrammingSyncSettings,
  runCvcrmProgrammingCommentSync,
  saveCvcrmProgrammingSyncSettings,
} from '../services/cvcrm-programming-sync.js'
import { recordAuditLog } from '../services/audit-log.js'
import { getSessionTimeoutMinutes, setSessionTimeoutMinutes } from '../services/session-settings.js'
import {
  getSiengeDailyUsage,
  isSiengeConfigured,
  getSiengeStockSettings,
  MAX_SIENGE_DAILY_REQUEST_LIMIT,
  SiengeRequestError,
  testSiengeStockAccess,
} from '../services/sienge.js'
import { broadcastSyncEvent } from '../services/sync-events.js'

const router = Router()

const sessionTimeoutSchema = z.object({
  timeoutMinutes: z.number().int().min(15).max(10080),
})

const siengeStockSettingsSchema = z.object({
  dailyRequestLimit: z.number().int().min(1).max(MAX_SIENGE_DAILY_REQUEST_LIMIT),
  issueDocumentId: z.string().trim().max(20),
  issueMovementTypeId: z.number().int().positive().nullable(),
  epiDocumentId: z.string().trim().max(20),
  epiMovementTypeId: z.number().int().positive().nullable(),
  uniformDocumentId: z.string().trim().max(20),
  uniformMovementTypeId: z.number().int().positive().nullable(),
  transferDocumentId: z.string().trim().max(20),
  transferMovementTypeId: z.number().int().positive().nullable(),
})

router.get('/sienge', requireAdmin, async (_req, res, next) => {
  try {
    const [settings, usage, centerMetadata, settingsMetadata] = await Promise.all([
      getSiengeStockSettings(),
      getSiengeDailyUsage(),
      pool.query<{ center_count: string; first_cost_center_id: string | null }>(
        `SELECT count(*) FILTER (WHERE location_id IS NOT NULL)::text AS center_count,
                min(cost_center_id) FILTER (WHERE location_id IS NOT NULL)::text AS first_cost_center_id
         FROM inventory_sienge_cost_centers`,
      ),
      pool.query<{ updated_at: string; display_name: string | null }>(
        `SELECT setting.updated_at, user_record.display_name
         FROM application_settings setting
         LEFT JOIN users user_record ON user_record.id = setting.updated_by
         WHERE setting.setting_key = 'sienge_stock_settings'`,
      ),
    ])
    res.json({
      ...settings,
      mappedCostCenterCount: Number(centerMetadata.rows[0]?.center_count ?? 0),
      firstCostCenterId: centerMetadata.rows[0]?.first_cost_center_id ? Number(centerMetadata.rows[0].first_cost_center_id) : null,
      requestCountToday: usage.requestCount,
      usageDate: usage.usageDate,
      isConfigured: isSiengeConfigured(),
      updatedAt: settingsMetadata.rows[0]?.updated_at ?? null,
      updatedByName: settingsMetadata.rows[0]?.display_name ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.put('/sienge', requireAdmin, async (req, res, next) => {
  const parsed = siengeStockSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? 'Configurações de estoque do Sienge inválidas.',
    })
    return
  }

  try {
    const user = req.session.user!
    const settings = parsed.data
    const result = await pool.query<{ updated_at: string }>(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('sienge_stock_settings', $1::jsonb, now(), $2)
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_at = now(),
                     updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [JSON.stringify(settings), user.id],
    )

    await recordAuditLog({
      actorUserId: user.id,
      actorName: user.displayName,
      action: 'settings_update',
      resourceType: 'system_settings',
      resourceId: 'sienge_stock_settings',
      summary: 'Configurações de integração de estoque do Sienge atualizadas.',
      metadata: settings,
    })
    await broadcastSyncEvent({
      scope: 'settings',
      action: 'sienge_stock_settings',
      meta: { updatedBy: user.displayName },
    })

    const usage = await getSiengeDailyUsage()
    const centerMetadata = await pool.query<{ center_count: string; first_cost_center_id: string | null }>(
      `SELECT count(*) FILTER (WHERE location_id IS NOT NULL)::text AS center_count,
              min(cost_center_id) FILTER (WHERE location_id IS NOT NULL)::text AS first_cost_center_id
       FROM inventory_sienge_cost_centers`,
    )
    res.json({
      success: true,
      ...settings,
      mappedCostCenterCount: Number(centerMetadata.rows[0]?.center_count ?? 0),
      firstCostCenterId: centerMetadata.rows[0]?.first_cost_center_id ? Number(centerMetadata.rows[0].first_cost_center_id) : null,
      requestCountToday: usage.requestCount,
      usageDate: usage.usageDate,
      isConfigured: isSiengeConfigured(),
      updatedAt: result.rows[0]?.updated_at ?? new Date().toISOString(),
      updatedByName: user.displayName,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/sienge/test-connection', requireAdmin, async (_req, res, next) => {
  try {
    const centerResult = await pool.query<{ cost_center_id: number }>(
      `SELECT cost_center_id FROM inventory_sienge_cost_centers
       WHERE location_id IS NOT NULL ORDER BY cost_center_id LIMIT 1`,
    )
    const costCenterId = centerResult.rows[0]?.cost_center_id
    if (!costCenterId) {
      res.status(400).json({ error: 'Cadastre ao menos um centro de custo antes de testar a consulta.' })
      return
    }
    const result = await testSiengeStockAccess(costCenterId)
    const usage = await getSiengeDailyUsage()
    res.json({
      success: true,
      costCenterId,
      returnedItems: result.returnedItems,
      requestCountToday: usage.requestCount,
    })
  } catch (error) {
    if (error instanceof SiengeRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  }
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

router.get('/whatsapp', requireAuth, async (_req, res, next) => {
  try {
    const [publicSettings, lastDispatchRes] = await Promise.all([
      getPublicWhatsAppSettings(),
      pool.query<{ setting_value: string }>(
        `SELECT setting_value #>> '{}' AS setting_value
         FROM application_settings
         WHERE setting_key = 'whatsapp_programming_last_auto_dispatch'`,
      ),
    ])

    res.json({
      ...publicSettings,
      lastAutoDispatchDate: lastDispatchRes.rows[0]?.setting_value ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.put('/whatsapp/auto-dispatch', requireAdmin, async (req, res, next) => {
  const schema = z.object({ enabled: z.boolean() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Parâmetro inválido para ativação do envio automático.' })
    return
  }

  try {
    const user = req.session.user!
    await pool.query(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('whatsapp_programming_auto_dispatch_enabled', to_jsonb($1::boolean), now(), $2::bigint)
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [parsed.data.enabled, user.id],
    )

    await broadcastSyncEvent({
      scope: 'settings',
      action: 'whatsapp_settings',
      meta: { updatedBy: user.displayName },
    })

    res.json({
      success: true,
      autoDispatchEnabled: parsed.data.enabled,
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

// Configurações de Sincronização de Comentários Internos da Programação com o CVCRM
router.get('/cvcrm-programming-sync', requireAuth, async (_req, res, next) => {
  try {
    const data = await getCvcrmProgrammingSyncSettings()
    res.json(data)
  } catch (error) {
    next(error)
  }
})

const cvcrmProgrammingSyncSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  dispatchTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Informe um horário válido no formato HH:MM.').optional(),
})

router.put('/cvcrm-programming-sync', requireAdmin, async (req, res, next) => {
  const parsed = cvcrmProgrammingSyncSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? 'Parâmetros inválidos para a sincronização CVCRM.',
    })
    return
  }

  try {
    const user = req.session.user!
    const updated = await saveCvcrmProgrammingSyncSettings(parsed.data, user.id)

    await recordAuditLog({
      actorUserId: user.id,
      actorName: user.displayName,
      action: 'settings_update',
      resourceType: 'system_settings',
      resourceId: 'cvcrm_programming_comment_sync',
      summary: `Atualizou configurações de sincronização de comentários de programação com o CVCRM (${updated.enabled ? 'Ativada' : 'Desativada'} às ${updated.dispatchTime}).`,
      metadata: parsed.data,
    })

    res.json({
      success: true,
      ...updated,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/cvcrm-programming-sync/run-now', requireAdmin, async (req, res, next) => {
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


