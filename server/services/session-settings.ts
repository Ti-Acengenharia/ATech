import { pool } from '../db.js'
import { recordAuditLog } from './audit-log.js'

let cachedTimeoutMinutes: number | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 1 minute in-memory cache

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60 // 1 hour

export async function getSessionTimeoutMinutes(): Promise<number> {
  const now = Date.now()
  if (cachedTimeoutMinutes !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedTimeoutMinutes
  }

  try {
    const result = await pool.query<{ setting_value: unknown }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = 'session_timeout_minutes'`,
    )

    if (result.rowCount && result.rows[0].setting_value !== undefined) {
      const parsed = Number(result.rows[0].setting_value)
      if (!Number.isNaN(parsed) && parsed >= 15 && parsed <= 10080) {
        cachedTimeoutMinutes = parsed
        cacheTimestamp = now
        return parsed
      }
    }
  } catch {
    // If table doesn't exist yet or query fails, fall back safely
  }

  cachedTimeoutMinutes = DEFAULT_SESSION_TIMEOUT_MINUTES
  cacheTimestamp = now
  return DEFAULT_SESSION_TIMEOUT_MINUTES
}

export async function setSessionTimeoutMinutes(
  minutes: number,
  userId: number,
  userDisplayName: string,
): Promise<{ timeoutMinutes: number; updatedAt: string }> {
  const clamped = Math.max(15, Math.min(10080, Math.round(minutes))) // min 15m, max 7 days

  const result = await pool.query<{ updated_at: string }>(
    `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ('session_timeout_minutes', $1::jsonb, now(), $2)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value,
                   updated_at = EXCLUDED.updated_at,
                   updated_by = EXCLUDED.updated_by
     RETURNING updated_at`,
    [JSON.stringify(clamped), userId],
  )

  cachedTimeoutMinutes = clamped
  cacheTimestamp = Date.now()

  await recordAuditLog({
    actorUserId: userId,
    actorName: userDisplayName,
    action: 'settings_update',
    resourceType: 'system_settings',
    resourceId: 'session_timeout_minutes',
    summary: `Tempo limite de expiração de sessão alterado para ${clamped} minuto(s) (${Math.round((clamped / 60) * 10) / 10}h).`,
  })

  return {
    timeoutMinutes: clamped,
    updatedAt: result.rows[0]?.updated_at || new Date().toISOString(),
  }
}

