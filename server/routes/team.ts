import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'

const router = Router()
router.use(requireAuth, requirePageAccess('tickets'))

router.get('/mentions', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, display_name AS "displayName", email
       FROM users
       WHERE status = 'active'
       ORDER BY lower(display_name), id`,
    )
    res.json({ people: result.rows })
  } catch (error) {
    next(error)
  }
})

router.get('/notifications', async (req, res, next) => {
  try {
    const [notifications, unread] = await Promise.all([
      pool.query(
        `SELECT n.id, n.ticket_id, t.protocol, n.comment_id, n.kind, n.message,
                n.created_at, n.read_at, COALESCE(u.display_name, 'Usuário removido') AS actor_name
         FROM user_notifications n
         JOIN tickets t ON t.source_id = n.ticket_id
         LEFT JOIN ticket_comments c ON c.id = n.comment_id
         LEFT JOIN users u ON u.id = c.author_id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT 50`,
        [req.session.user!.id],
      ),
      pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM user_notifications WHERE user_id = $1 AND read_at IS NULL',
        [req.session.user!.id],
      ),
    ])
    res.json({ notifications: notifications.rows, unreadCount: Number(unread.rows[0]?.count ?? 0) })
  } catch (error) {
    next(error)
  }
})

router.patch('/notifications/read-all', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [req.session.user!.id],
    )
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/notifications/:id/read', async (req, res, next) => {
  const notificationId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!notificationId.success) {
    res.status(400).json({ error: 'Notificação inválida.' })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [notificationId.data, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Notificação não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router