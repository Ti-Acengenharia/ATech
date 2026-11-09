import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'

const router = Router()
router.use(requireAuth)

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
  const user = req.session.user!
  try {
    const accessResult = await pool.query<{ page_key: string }>(
      `SELECT page_key FROM user_page_access WHERE user_id = $1`,
      [user.id],
    )
    const allowedPages = new Set(accessResult.rows.map((r) => r.page_key))
    const canTickets = user.role === 'admin' || allowedPages.has('tickets')
    const canLegal = user.role === 'admin' || allowedPages.has('legal-processes')
    const canStock = user.role === 'admin' || allowedPages.has('stock-units')

    const [ticketNotifs, ticketUnread, legalNotifs, legalUnread, stockNotifs, stockUnread] = await Promise.all([
      canTickets
        ? pool.query<{
            id: string
            ticket_id: string
            protocol: string
            comment_id: string | null
            kind: string
            message: string
            created_at: Date
            read_at: Date | null
            actor_name: string
          }>(
            `SELECT ('ticket:' || n.id::text) AS id,
                    n.ticket_id::text AS ticket_id,
                    t.protocol,
                    n.comment_id::text AS comment_id,
                    n.kind,
                    n.message,
                    n.created_at,
                    n.read_at,
                    COALESCE(u.display_name, 'Usuário removido') AS actor_name
             FROM user_notifications n
             JOIN tickets t ON t.source_id = n.ticket_id
             LEFT JOIN ticket_comments c ON c.id = n.comment_id
             LEFT JOIN users u ON u.id = c.author_id
             WHERE n.user_id = $1
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT 40`,
            [user.id],
          ).then((r) => r.rows)
        : Promise.resolve([]),

      canTickets
        ? pool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM user_notifications WHERE user_id = $1 AND read_at IS NULL',
            [user.id],
          ).then((r) => Number(r.rows[0]?.count ?? 0))
        : Promise.resolve(0),

      canLegal
        ? pool.query<{
            id: string
            process_id: string
            process_number: string
            process_title: string
            comment_id: string
            message: string
            created_at: Date
            read_at: Date | null
            actor_name: string
          }>(
            `SELECT ('legal:' || m.comment_id::text) AS id,
                    p.id::text AS process_id,
                    p.process_number,
                    p.title AS process_title,
                    m.comment_id::text AS comment_id,
                    left(c.body, 200) AS message,
                    COALESCE(m.created_at, c.created_at) AS created_at,
                    m.read_at,
                    COALESCE(u.display_name, 'Usuário removido') AS actor_name
             FROM legal_process_comment_mentions m
             JOIN legal_process_comments c ON c.id = m.comment_id
             JOIN legal_processes p ON p.id = c.process_id
             LEFT JOIN users u ON u.id = c.author_id
             WHERE m.user_id = $1 AND c.author_id <> $1
             ORDER BY c.created_at DESC, m.comment_id DESC
             LIMIT 40`,
            [user.id],
          ).then((r) => r.rows)
        : Promise.resolve([]),

      canLegal
        ? pool.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM legal_process_comment_mentions m
             JOIN legal_process_comments c ON c.id = m.comment_id
             WHERE m.user_id = $1 AND m.read_at IS NULL AND c.author_id <> $1`,
            [user.id],
          ).then((r) => Number(r.rows[0]?.count ?? 0))
        : Promise.resolve(0),

      canStock
        ? pool.query<{
            id: string
            stock_unit_id: string
            enterprise_name: string
            block_name: string | null
            unit_name: string
            old_status: string | null
            new_status: string
            message: string
            created_at: Date
            read_at: Date | null
          }>(
            `SELECT ('stock:' || n.id::text) AS id,
                    n.stock_unit_id::text AS stock_unit_id,
                    n.enterprise_name,
                    n.block_name,
                    n.unit_name,
                    n.old_status,
                    n.new_status,
                    n.message,
                    n.created_at,
                    n.read_at
             FROM stock_unit_notifications n
             WHERE n.user_id = $1
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT 40`,
            [user.id],
          ).then((r) => r.rows)
        : Promise.resolve([]),

      canStock
        ? pool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM stock_unit_notifications WHERE user_id = $1 AND read_at IS NULL',
            [user.id],
          ).then((r) => Number(r.rows[0]?.count ?? 0))
        : Promise.resolve(0),
    ])

    const combined = [
      ...ticketNotifs.map((n) => ({
        id: n.id,
        source: 'ticket' as const,
        ticket_id: n.ticket_id,
        process_id: null,
        stock_unit_id: null,
        protocol: n.protocol,
        process_number: null,
        comment_id: n.comment_id,
        kind: n.kind,
        message: n.message,
        created_at: n.created_at.toISOString(),
        read_at: n.read_at ? n.read_at.toISOString() : null,
        actor_name: n.actor_name,
      })),
      ...legalNotifs.map((n) => ({
        id: n.id,
        source: 'legal-process' as const,
        ticket_id: null,
        process_id: n.process_id,
        stock_unit_id: null,
        protocol: n.process_number || n.process_title,
        process_number: n.process_number || n.process_title,
        comment_id: n.comment_id,
        kind: 'legal_mention',
        message: n.message,
        created_at: n.created_at.toISOString(),
        read_at: n.read_at ? n.read_at.toISOString() : null,
        actor_name: n.actor_name,
      })),
      ...stockNotifs.map((n) => ({
        id: n.id,
        source: 'stock-unit' as const,
        ticket_id: null,
        process_id: null,
        stock_unit_id: n.stock_unit_id,
        protocol: `${n.enterprise_name} · ${n.block_name ? n.block_name + ' - ' : ''}${n.unit_name}`,
        process_number: null,
        comment_id: null,
        kind: 'stock_status_change',
        message: n.message,
        created_at: n.created_at.toISOString(),
        read_at: n.read_at ? n.read_at.toISOString() : null,
        actor_name: 'Estoque CV CRM',
      })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)

    res.json({
      notifications: combined,
      unreadCount: ticketUnread + legalUnread + stockUnread,
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/notifications/read-all', async (req, res, next) => {
  const userId = req.session.user!.id
  try {
    await Promise.all([
      pool.query(
        'UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [userId],
      ),
      pool.query(
        'UPDATE legal_process_comment_mentions SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [userId],
      ),
      pool.query(
        'UPDATE stock_unit_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [userId],
      ),
    ])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/notifications/:id/read', async (req, res, next) => {
  const rawId = String(req.params.id ?? '')
  const userId = req.session.user!.id

  try {
    if (rawId.startsWith('stock:')) {
      const notifId = z.coerce.number().int().positive().safeParse(rawId.slice('stock:'.length))
      if (!notifId.success) {
        res.status(400).json({ error: 'Notificação inválida.' })
        return
      }
      const result = await pool.query(
        `UPDATE stock_unit_notifications
         SET read_at = COALESCE(read_at, now())
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [notifId.data, userId],
      )
      if (!result.rowCount) {
        res.status(404).json({ error: 'Notificação não encontrada.' })
        return
      }
      res.status(204).end()
      return
    }

    if (rawId.startsWith('legal:')) {
      const commentId = z.coerce.number().int().positive().safeParse(rawId.slice('legal:'.length))
      if (!commentId.success) {
        res.status(400).json({ error: 'Notificação inválida.' })
        return
      }
      const result = await pool.query(
        `UPDATE legal_process_comment_mentions
         SET read_at = COALESCE(read_at, now())
         WHERE comment_id = $1 AND user_id = $2
         RETURNING comment_id`,
        [commentId.data, userId],
      )
      if (!result.rowCount) {
        res.status(404).json({ error: 'Notificação não encontrada.' })
        return
      }
      res.status(204).end()
      return
    }

    const numericPart = rawId.startsWith('ticket:') ? rawId.slice('ticket:'.length) : rawId
    const notificationId = z.coerce.number().int().positive().safeParse(numericPart)
    if (!notificationId.success) {
      res.status(400).json({ error: 'Notificação inválida.' })
      return
    }
    const result = await pool.query(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [notificationId.data, userId],
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
