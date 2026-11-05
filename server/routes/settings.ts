import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../auth.js'
import { pool } from '../db.js'
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

export default router

