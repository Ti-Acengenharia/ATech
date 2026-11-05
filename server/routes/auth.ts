import { Router } from 'express'
import type { Request } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { pageAccessKeys } from '../auth.js'
import { env } from '../config.js'
import { pool } from '../db.js'
import type { SessionUser, UserRole } from '../domain/user.js'
import { recordAuditLog } from '../services/audit-log.js'
import { getSessionTimeoutMinutes } from '../services/session-settings.js'

const router = Router()
const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null

const credentialsSchema = z.object({
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1).max(200),
})

const MAX_LOGIN_FAILED_ATTEMPTS = 5
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000

function setSessionUser(req: Request, user: SessionUser) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate(async (error) => {
      if (error) {
        reject(error)
        return
      }

      const timeoutMinutes = await getSessionTimeoutMinutes()
      const timeoutMs = timeoutMinutes * 60 * 1000

      req.session.user = user
      req.session.loginTime = Date.now()
      req.session.lastActivity = Date.now()
      if (req.session.cookie) {
        req.session.cookie.maxAge = timeoutMs
      }

      req.session.save((saveError) => {
        if (saveError) reject(saveError)
        else resolve()
      })
    })
  })
}

router.get('/session', async (req, res, next) => {
  const timeoutMinutes = await getSessionTimeoutMinutes()
  const timeoutMs = timeoutMinutes * 60 * 1000
  const sessionUser = req.session.user
  if (!sessionUser) {
    res.json({
      user: null,
      corporateDomain: env.CORPORATE_DOMAIN,
      canAccessLegalProcesses: false,
      canViewOtherPersonalActivities: false,
      pageAccess: [],
      sessionTimeoutMinutes: timeoutMinutes,
    })
    return
  }

  // Check if session has exceeded timeout
  const now = Date.now()
  const lastActivity = req.session.lastActivity || req.session.loginTime || now
  if (now - lastActivity > timeoutMs) {
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('atech.sid')
      res.json({
        user: null,
        corporateDomain: env.CORPORATE_DOMAIN,
        canAccessLegalProcesses: false,
        canViewOtherPersonalActivities: false,
        pageAccess: [],
        sessionTimeoutMinutes: timeoutMinutes,
      })
    })
    return
  }

  req.session.lastActivity = now
  if (req.session.cookie) {
    req.session.cookie.maxAge = timeoutMs
  }

  try {
    const result = await pool.query<{ page_access: string[]; can_view_other_personal_activities: boolean }>(
      `SELECT COALESCE((
         SELECT array_agg(page_key ORDER BY page_key)
         FROM user_page_access WHERE user_id = $1
       ), ARRAY[]::varchar[]) AS page_access,
       COALESCE((
         SELECT can_view_others FROM user_personal_activity_permissions WHERE user_id = $1
       ), FALSE) OR $2 = 'admin' AS can_view_other_personal_activities
       FROM users WHERE id = $1 AND role = $2 AND status = 'active'`,
      [sessionUser.id, sessionUser.role],
    )
    if (result.rowCount) {
      const pageAccess = sessionUser.role === 'admin' ? [...pageAccessKeys] : result.rows[0].page_access
      res.json({
        user: sessionUser,
        corporateDomain: env.CORPORATE_DOMAIN,
        canAccessLegalProcesses: sessionUser.role === 'admin' || pageAccess.includes('legal-processes'),
        canViewOtherPersonalActivities: result.rows[0].can_view_other_personal_activities,
        pageAccess,
        sessionTimeoutMinutes: timeoutMinutes,
      })
      return
    }
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('atech.sid')
      res.json({
        user: null,
        corporateDomain: env.CORPORATE_DOMAIN,
        canAccessLegalProcesses: false,
        canViewOtherPersonalActivities: false,
        pageAccess: [],
        sessionTimeoutMinutes: timeoutMinutes,
      })
    })
  } catch (error) {
    next(error)
  }
})

router.post('/admin/login', async (req, res, next) => {
  const parsed = credentialsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um e-mail e uma senha válidos.' })
    return
  }

  try {
    const { email, password } = parsed.data
    const result = await pool.query<{
      id: number
      email: string
      display_name: string
      role: UserRole
      password_hash: string | null
      login_failed_attempts: number
      login_locked_until: Date | null
    }>(
      `SELECT id, email, display_name, role, password_hash,
              COALESCE(login_failed_attempts, 0) AS login_failed_attempts,
              login_locked_until
       FROM users WHERE lower(email) = lower($1) AND role = 'admin' AND status = 'active'`,
      [email],
    )
    const admin = result.rows[0]

    if (admin?.login_locked_until && admin.login_locked_until.getTime() > Date.now()) {
      const remainingMinutes = Math.max(1, Math.ceil((admin.login_locked_until.getTime() - Date.now()) / 60_000))
      res.status(429).json({
        error: `Conta temporariamente bloqueada após múltiplas tentativas incorretas. Tente novamente em ${remainingMinutes} min.`,
      })
      return
    }

    if (!admin || !admin.password_hash || !(await bcrypt.compare(password, admin.password_hash))) {
      if (admin) {
        const nextAttempts = (admin.login_failed_attempts ?? 0) + 1
        const shouldLock = nextAttempts >= MAX_LOGIN_FAILED_ATTEMPTS
        const lockedUntil = shouldLock ? new Date(Date.now() + LOGIN_LOCK_DURATION_MS) : null
        await pool.query(
          `UPDATE users
           SET login_failed_attempts = $1,
               login_locked_until = $2,
               updated_at = now()
           WHERE id = $3`,
          [shouldLock ? 0 : nextAttempts, lockedUntil, admin.id],
        )
        if (shouldLock) {
          await recordAuditLog({
            actorUserId: admin.id,
            actorName: admin.display_name,
            action: 'admin_login_locked',
            resourceType: 'user',
            resourceId: admin.id,
            summary: `Conta administrativa ${admin.email} bloqueada temporariamente por excesso de tentativas de senha.`,
          })
        }
      }
      res.status(401).json({ error: 'E-mail ou senha incorretos.' })
      return
    }

    await pool.query(
      `UPDATE users
       SET login_failed_attempts = 0,
           login_locked_until = NULL,
           last_login_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [admin.id],
    )

    const user: SessionUser = {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
    }
    await setSessionUser(req, user)
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

router.post('/google', async (req, res, next) => {
  const idToken = z.string().min(1).safeParse(req.body?.credential)
  if (!idToken.success) {
    res.status(400).json({ error: 'Credencial Google inválida.' })
    return
  }

  if (!googleClient) {
    res.status(503).json({ error: 'O acesso Google ainda não foi configurado.' })
    return
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken.data,
      audience: env.GOOGLE_CLIENT_ID,
    })
    const identity = ticket.getPayload()
    const email = identity?.email?.toLowerCase()

    if (
      !email ||
      identity?.email_verified !== true ||
      identity.hd?.toLowerCase() !== env.CORPORATE_DOMAIN ||
      !email.endsWith(`@${env.CORPORATE_DOMAIN}`)
    ) {
      res.status(403).json({ error: `Use uma conta Google Workspace @${env.CORPORATE_DOMAIN}.` })
      return
    }

    const result = await pool.query<{
      id: number
      email: string
      display_name: string
      role: UserRole
      status: string
    }>(
      `UPDATE users
       SET status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
           display_name = CASE
             WHEN display_name_customized THEN display_name
             ELSE COALESCE(NULLIF($2, ''), display_name)
           END,
           last_login_at = now(), updated_at = now()
       WHERE lower(email) = lower($1) AND status IN ('invited', 'active')
       RETURNING id, email, display_name, role, status`,
      [email, identity.name ?? ''],
    )
    const account = result.rows[0]

    if (!account) {
      res.status(403).json({ error: 'Este e-mail ainda não recebeu um convite ativo da ATech.' })
      return
    }

    const user: SessionUser = {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      role: account.role,
    }
    await setSessionUser(req, user)
    res.json({ user })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error)
      return
    }

    res.clearCookie('atech.sid')
    res.status(204).end()
  })
})

export default router
