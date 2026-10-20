import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config.js'
import { pageAccessKeys, requireAdmin } from '../auth.js'
import { pool } from '../db.js'
import type { ManagedUser, UserStatus } from '../domain/user.js'

const router = Router()

const invitationSchema = z.object({
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
})

const statusSchema = z.object({
  status: z.enum(['active', 'suspended']),
})
const pageAccessSchema = z.object({
  pages: z.array(z.enum(pageAccessKeys)).max(pageAccessKeys.length),
})

router.use(requireAdmin)

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: number
      email: string
      display_name: string
      role: ManagedUser['role']
      status: UserStatus
      created_at: Date
      last_login_at: Date | null
      can_access_legal_processes: boolean
      can_view_other_personal_activities: boolean
      page_access: string[]
    }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at, u.last_login_at,
              (u.role = 'admin' OR a.user_id IS NOT NULL OR EXISTS (
                SELECT 1 FROM user_page_access p WHERE p.user_id = u.id AND p.page_key = 'legal-processes'
              )) AS can_access_legal_processes,
              COALESCE((
                SELECT array_agg(p.page_key ORDER BY p.page_key)
                FROM user_page_access p WHERE p.user_id = u.id
              ), ARRAY[]::varchar[]) AS page_access
              , COALESCE((
                SELECT can_view_others FROM user_personal_activity_permissions p WHERE p.user_id = u.id
              ), FALSE) AS can_view_other_personal_activities
       FROM users u LEFT JOIN legal_process_access a ON a.user_id = u.id
       ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.created_at DESC`,
    )

    const users: ManagedUser[] = result.rows.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      status: user.status,
      createdAt: user.created_at.toISOString(),
      lastLoginAt: user.last_login_at?.toISOString() ?? null,
      canAccessLegalProcesses: user.can_access_legal_processes,
      pageAccess: user.role === 'admin' ? [...pageAccessKeys] : user.page_access,
      canViewOtherPersonalActivities: user.can_view_other_personal_activities,
    }))
    res.json({ users })
  } catch (error) {
    next(error)
  }
})

router.post('/invitations', async (req, res, next) => {
  const parsed = invitationSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um endereço de e-mail válido.' })
    return
  }

  const { email } = parsed.data
  if (!email.endsWith(`@${env.CORPORATE_DOMAIN}`)) {
    res.status(400).json({ error: `Convide somente endereços @${env.CORPORATE_DOMAIN}.` })
    return
  }

  try {
    const displayName = email.slice(0, email.lastIndexOf('@'))
    const result = await pool.query<{
      id: number
      email: string
      display_name: string
      role: ManagedUser['role']
      status: UserStatus
      created_at: Date
      last_login_at: Date | null
    }>(
      `INSERT INTO users (email, display_name, role, status, invited_by)
       VALUES ($1, $2, 'member', 'invited', $3)
       ON CONFLICT (lower(email)) DO UPDATE
         SET status = 'invited', invited_by = EXCLUDED.invited_by, updated_at = now()
         WHERE users.role = 'member' AND users.status = 'suspended'
       RETURNING id, email, display_name, role, status, created_at, last_login_at`,
      [email, displayName, req.session.user!.id],
    )
    const user = result.rows[0]

    if (!user) {
      res.status(409).json({ error: 'Este endereço já possui um convite ou acesso ativo.' })
      return
    }

    await pool.query(
      `INSERT INTO user_page_access (user_id, page_key, granted_by)
       SELECT $1, page_key, $2
       FROM (VALUES ('home'), ('tickets'), ('schedule'), ('collaborators'), ('information'), ('personal-activities')) AS defaults(page_key)
       ON CONFLICT (user_id, page_key) DO NOTHING`,
      [user.id, req.session.user!.id],
    )

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        createdAt: user.created_at.toISOString(),
        lastLoginAt: user.last_login_at?.toISOString() ?? null,
      },
    })

  } catch (error) {
    next(error)
  }
})

router.patch('/:id/status', async (req, res, next) => {
  const userId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = statusSchema.safeParse(req.body)
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Solicitação de atualização inválida.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE users SET status = $1, updated_at = now()
       WHERE id = $2 AND role = 'member'
       RETURNING id`,
      [parsed.data.status, userId.data],
    )

    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário não encontrado ou protegido.' })
      return
    }

    if (parsed.data.status === 'suspended') {
      await client.query(
        `DELETE FROM user_sessions
         WHERE sess->'user'->>'id' = $1`,
        [String(userId.data)],
      )
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/legal-processes-access', async (req, res, next) => {
  const userId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body)
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Permissão de acesso inválida.' })
    return
  }
  try {
    const member = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'member' AND status = 'active'`,
      [userId.data],
    )
    if (!member.rowCount) {
      res.status(404).json({ error: 'Usuário ativo não encontrado.' })
      return
    }
    if (parsed.data.enabled) {
      await pool.query(
        `INSERT INTO legal_process_access (user_id, granted_by)
         VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId.data, req.session.user!.id],
      )
      await pool.query(
        `INSERT INTO user_page_access (user_id, page_key, granted_by)
         VALUES ($1, 'legal-processes', $2) ON CONFLICT (user_id, page_key) DO NOTHING`,
        [userId.data, req.session.user!.id],
      )
    } else {
      await pool.query('DELETE FROM legal_process_access WHERE user_id = $1', [userId.data])
      await pool.query(
        `DELETE FROM user_page_access WHERE user_id = $1 AND page_key = 'legal-processes'`,
        [userId.data],
      )
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/page-access', async (req, res, next) => {
  const userId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = pageAccessSchema.safeParse(req.body)
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Selecione páginas válidas para o acesso.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const member = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'member'`,
      [userId.data],
    )
    if (!member.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário da equipe não encontrado.' })
      return
    }
    await client.query('DELETE FROM user_page_access WHERE user_id = $1', [userId.data])
    for (const page of [...new Set(parsed.data.pages)]) {
      await client.query(
        `INSERT INTO user_page_access (user_id, page_key, granted_by)
         VALUES ($1, $2, $3)`,
        [userId.data, page, req.session.user!.id],
      )
    }
    if (parsed.data.pages.includes('legal-processes')) {
      await client.query(
        `INSERT INTO legal_process_access (user_id, granted_by)
         VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId.data, req.session.user!.id],
      )
    } else {
      await client.query('DELETE FROM legal_process_access WHERE user_id = $1', [userId.data])
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/personal-activities-view-access', async (req, res, next) => {
  const userId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body)
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Permissão de visualização inválida.' })
    return
  }
  try {
    const member = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'member'`,
      [userId.data],
    )
    if (!member.rowCount) {
      res.status(404).json({ error: 'Usuário da equipe não encontrado.' })
      return
    }
    await pool.query(
      `INSERT INTO user_personal_activity_permissions (user_id, can_view_others, granted_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
       SET can_view_others = EXCLUDED.can_view_others,
           granted_by = EXCLUDED.granted_by,
           updated_at = now()`,
      [userId.data, parsed.data.enabled, req.session.user!.id],
    )
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router