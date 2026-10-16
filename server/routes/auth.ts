import { Router } from 'express'
import type { Request } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { pageAccessKeys } from '../auth.js'
import { env } from '../config.js'
import { pool } from '../db.js'
import type { SessionUser, UserRole } from '../domain/user.js'

const router = Router()
const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null

const credentialsSchema = z.object({
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1).max(200),
})

function setSessionUser(req: Request, user: SessionUser) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error)
        return
      }

      req.session.user = user
      req.session.save((saveError) => {
        if (saveError) reject(saveError)
        else resolve()
      })
    })
  })
}

router.get('/session', async (req, res, next) => {
  const sessionUser = req.session.user
  if (!sessionUser) {
    res.json({ user: null, corporateDomain: env.CORPORATE_DOMAIN, canAccessLegalProcesses: false, pageAccess: [] })
    return
  }
  try {
    const result = await pool.query<{ page_access: string[] }>(
      `SELECT COALESCE((
         SELECT array_agg(page_key ORDER BY page_key)
         FROM user_page_access WHERE user_id = $1
       ), ARRAY[]::varchar[]) AS page_access
       FROM users WHERE id = $1 AND role = $2 AND status = 'active'`,
      [sessionUser.id, sessionUser.role],
    )
    if (result.rowCount) {
      const pageAccess = sessionUser.role === 'admin' ? [...pageAccessKeys] : result.rows[0].page_access
      res.json({
        user: sessionUser,
        corporateDomain: env.CORPORATE_DOMAIN,
        canAccessLegalProcesses: sessionUser.role === 'admin' || pageAccess.includes('legal-processes'),
        pageAccess,
      })
      return
    }
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('atech.sid')
      res.json({ user: null, corporateDomain: env.CORPORATE_DOMAIN, canAccessLegalProcesses: false, pageAccess: [] })
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
      password_hash: string
    }>(
      `SELECT id, email, display_name, role, password_hash
       FROM users WHERE lower(email) = lower($1) AND role = 'admin' AND status = 'active'`,
      [email],
    )
    const admin = result.rows[0]

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' })
      return
    }

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
       WHERE lower(email) = lower($1) AND role = 'member' AND status IN ('invited', 'active')
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