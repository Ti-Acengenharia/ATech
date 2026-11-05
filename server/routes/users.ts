import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config.js'
import { pageAccessKeys, requireAdmin } from '../auth.js'
import { pool } from '../db.js'
import type { ManagedUser, UserStatus } from '../domain/user.js'
import { recordAuditLog } from '../services/audit-log.js'
import { broadcastSyncEvent } from '../services/sync-events.js'

const router = Router()

const invitationSchema = z.object({
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
})

const statusSchema = z.object({
  status: z.enum(['active', 'suspended']),
})

const roleSchema = z.object({
  role: z.enum(['admin', 'member']),
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

router.get('/audit-logs', async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: string
      actor_user_id: number | null
      actor_name: string
      action: string
      resource_type: string
      resource_id: string
      summary: string
      metadata: Record<string, unknown> | null
      created_at: Date
    }>(
      `SELECT id::text, actor_user_id, actor_name, action, resource_type, resource_id, summary, metadata, created_at
       FROM system_audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT 150`,
    )
    res.json({
      logs: result.rows.map((row) => {
        let meta = row.metadata
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta)
          } catch {
            meta = { raw: meta }
          }
        }
        return {
          id: row.id,
          actorUserId: row.actor_user_id,
          actorName: row.actor_name,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          summary: row.summary,
          metadata: meta ?? {},
          createdAt: row.created_at.toISOString(),
        }
      }),
    })
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
       FROM (VALUES ('home'), ('tickets'), ('letter-filling'), ('schedule'), ('collaborators'), ('inventory'), ('information'), ('personal-activities')) AS defaults(page_key)
       ON CONFLICT (user_id, page_key) DO NOTHING`,
      [user.id, req.session.user!.id],
    )

    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_invited',
      resourceType: 'user',
      resourceId: user.id,
      summary: `Convite enviado para ${user.email}`,
      metadata: { email: user.email },
    })

    void broadcastSyncEvent({ scope: 'users', action: 'invite' })
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

  if (parsed.data.status === 'suspended' && userId.data === req.session.user!.id) {
    res.status(400).json({ error: 'Você não pode suspender seu próprio acesso.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existing = await client.query<{ id: number; email: string; display_name: string; role: string; status: string }>(
      'SELECT id, email, display_name, role, status FROM users WHERE id = $1',
      [userId.data],
    )

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário não encontrado.' })
      return
    }

    if (parsed.data.status === 'suspended' && existing.rows[0].role === 'admin') {
      const otherAdmins = await client.query<{ count: string }>(
        "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
        [userId.data],
      )
      if (Number(otherAdmins.rows[0]?.count ?? 0) < 1) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Não é possível suspender o único administrador ativo do sistema.' })
        return
      }
    }

    await client.query(
      `UPDATE users SET status = $1, updated_at = now()
       WHERE id = $2`,
      [parsed.data.status, userId.data],
    )

    if (parsed.data.status === 'suspended') {
      await client.query(
        `DELETE FROM user_sessions
         WHERE sess->'user'->>'id' = $1`,
        [String(userId.data)],
      )
    }

    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_status_changed',
      resourceType: 'user',
      resourceId: userId.data,
      summary: `Status de ${existing.rows[0].display_name} (${existing.rows[0].email}) alterado para ${parsed.data.status === 'suspended' ? 'suspenso' : 'ativo'}`,
      metadata: { previousStatus: existing.rows[0].status, newStatus: parsed.data.status },
    }, client)

    await client.query('COMMIT')
    void broadcastSyncEvent({ scope: 'users', action: 'update' })
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/role', async (req, res, next) => {
  const userId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = roleSchema.safeParse(req.body)
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Permissão ou identificador de usuário inválido.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const targetUser = await client.query<{ id: number; email: string; display_name: string; role: string; status: string }>(
      'SELECT id, email, display_name, role, status FROM users WHERE id = $1',
      [userId.data],
    )

    if (targetUser.rowCount === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário não encontrado.' })
      return
    }

    const currentRole = targetUser.rows[0].role
    const newRole = parsed.data.role

    if (currentRole === newRole) {
      await client.query('ROLLBACK')
      res.json({ ok: true, role: newRole })
      return
    }

    if (currentRole === 'admin' && newRole === 'member') {
      if (userId.data === req.session.user!.id) {
        const otherAdmins = await client.query<{ count: string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
          [userId.data],
        )
        if (Number(otherAdmins.rows[0]?.count ?? 0) < 1) {
          await client.query('ROLLBACK')
          res.status(400).json({ error: 'Você não pode remover seu próprio perfil de administrador sem outro administrador ativo.' })
          return
        }
      } else {
        const otherAdmins = await client.query<{ count: string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
          [userId.data],
        )
        if (Number(otherAdmins.rows[0]?.count ?? 0) < 1) {
          await client.query('ROLLBACK')
          res.status(400).json({ error: 'Não é possível remover a permissão do único administrador ativo do sistema.' })
          return
        }
      }
    }

    if (newRole === 'admin') {
      if (targetUser.rows[0].status === 'suspended') {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Reative o usuário antes de promovê-lo a administrador.' })
        return
      }

      await client.query(
        `INSERT INTO user_page_access (user_id, page_key, granted_by)
         SELECT $1, page_key, $2
         FROM (VALUES ('home'), ('tickets'), ('letter-filling'), ('schedule'), ('collaborators'), ('inventory'), ('information'), ('personal-activities'), ('legal-processes')) AS defaults(page_key)
         ON CONFLICT (user_id, page_key) DO NOTHING`,
        [userId.data, req.session.user!.id],
      )
    }

    await client.query(
      'UPDATE users SET role = $1, updated_at = now() WHERE id = $2',
      [newRole, userId.data],
    )

    // Atualiza a sessão ativa do usuário se ele estiver conectado
    await client.query(
      `UPDATE user_sessions
       SET sess = jsonb_set(sess::jsonb, '{user,role}', to_jsonb($1::text))
       WHERE sess->'user'->>'id' = $2`,
      [newRole, String(userId.data)],
    )

    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_role_changed',
      resourceType: 'user',
      resourceId: userId.data,
      summary: `Perfil de ${targetUser.rows[0].display_name} (${targetUser.rows[0].email}) alterado para ${newRole === 'admin' ? 'Administrador' : 'Equipe técnica'}`,
      metadata: { previousRole: currentRole, newRole },
    }, client)

    await client.query('COMMIT')
    res.json({ ok: true, role: newRole })
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
    const member = await pool.query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM users WHERE id = $1 AND status = 'active'`,
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
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_legal_access_changed',
      resourceType: 'user',
      resourceId: userId.data,
      summary: `Acesso ao Jurídico ${parsed.data.enabled ? 'liberado' : 'removido'} para ${member.rows[0].display_name}`,
      metadata: { enabled: parsed.data.enabled },
    })
    void broadcastSyncEvent({ scope: 'users', action: 'update' })
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
    const member = await client.query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM users WHERE id = $1`,
      [userId.data],
    )
    if (!member.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário não encontrado.' })
      return
    }
    const uniquePages = [...new Set(parsed.data.pages)]
    await client.query('DELETE FROM user_page_access WHERE user_id = $1', [userId.data])
    for (const page of uniquePages) {
      await client.query(
        `INSERT INTO user_page_access (user_id, page_key, granted_by)
         VALUES ($1, $2, $3)`,
        [userId.data, page, req.session.user!.id],
      )
    }
    if (uniquePages.includes('legal-processes')) {
      await client.query(
        `INSERT INTO legal_process_access (user_id, granted_by)
         VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId.data, req.session.user!.id],
      )
    } else {
      await client.query('DELETE FROM legal_process_access WHERE user_id = $1', [userId.data])
    }

    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_page_access_changed',
      resourceType: 'user',
      resourceId: userId.data,
      summary: `Permissões de página atualizadas para ${member.rows[0].display_name} (${uniquePages.length} páginas)`,
      metadata: { pages: uniquePages },
    }, client)

    await client.query('COMMIT')
    void broadcastSyncEvent({ scope: 'users', action: 'update' })
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
    const member = await pool.query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM users WHERE id = $1`,
      [userId.data],
    )
    if (!member.rowCount) {
      res.status(404).json({ error: 'Usuário não encontrado.' })
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
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'user_personal_activities_access_changed',
      resourceType: 'user',
      resourceId: userId.data,
      summary: `Visualização de quadros de outros usuários ${parsed.data.enabled ? 'liberada' : 'removida'} para ${member.rows[0].display_name}`,
      metadata: { enabled: parsed.data.enabled },
    })
    void broadcastSyncEvent({ scope: 'users', action: 'update' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
