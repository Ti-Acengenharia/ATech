import { Router, type Request, type Response } from 'express'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'

const router = Router()
const columnSchema = z.object({ name: z.string().trim().min(1).max(80) })
const columnOrderSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(30),
}).refine(({ ids }) => new Set(ids).size === ids.length)
const activitySchema = z.object({
  columnId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(6000).default(''),
  startDate: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
})
const activityUpdateSchema = activitySchema.partial().refine((value) => Object.keys(value).length > 0)
const tagSchema = z.object({ name: z.string().trim().min(1).max(40) })
const commentSchema = z.object({ body: z.string().trim().min(1).max(6000) })
const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  contentBase64: z.string().min(4).max(7_000_000),
})

router.use(requireAuth, requirePageAccess('personal-activities'))

async function getOwnerId(req: Request, res: Response) {
  const currentUserId = Number(req.session.user!.id)
  const requested = req.query.userId === undefined
    ? currentUserId
    : z.coerce.number().int().positive().safeParse(req.query.userId)
  if (typeof requested === 'number') return requested
  if (!requested.success) {
    res.status(400).json({ error: 'Usuário selecionado inválido.' })
    return null
  }
  if (requested.data !== currentUserId && req.session.user!.role !== 'admin') {
    const permission = await pool.query<{ can_view_others: boolean }>(
      `SELECT can_view_others FROM user_personal_activity_permissions
       WHERE user_id = $1`,
      [currentUserId],
    )
    if (!permission.rows[0]?.can_view_others) {
      res.status(403).json({ error: 'Você não tem permissão para visualizar atividades de outras pessoas.' })
      return null
    }
  }
  if (requested.data !== currentUserId) {
    const target = await pool.query(
      `SELECT u.id FROM users u
       WHERE u.id = $1 AND u.status = 'active'
         AND (u.role = 'admin' OR EXISTS (
           SELECT 1 FROM user_page_access p
           WHERE p.user_id = u.id AND p.page_key = 'personal-activities'
         ))`,
      [requested.data],
    )
    if (!target.rowCount) {
      res.status(404).json({ error: 'Usuário não encontrado.' })
      return null
    }
  }
  return requested.data
}

async function getActivityAccess(req: Request, res: Response, activityId: number, write = false) {
  const currentUserId = Number(req.session.user!.id)
  const result = await pool.query<{ user_id: string; status: string; role: string; has_page: boolean }>(
    `SELECT a.user_id, u.status, u.role,
            EXISTS (SELECT 1 FROM user_page_access p
                    WHERE p.user_id = u.id AND p.page_key = 'personal-activities') AS has_page
     FROM personal_activities a JOIN users u ON u.id = a.user_id
     WHERE a.id = $1`,
    [activityId],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Atividade não encontrada.' })
    return null
  }
  const ownerId = Number(result.rows[0].user_id)
  if (result.rows[0].status !== 'active' || (result.rows[0].role !== 'admin' && !result.rows[0].has_page)) {
    res.status(404).json({ error: 'Atividade não encontrada.' })
    return null
  }
  if (write && ownerId !== currentUserId) {
    res.status(403).json({ error: 'Este quadro está em modo somente leitura.' })
    return null
  }
  if (ownerId !== currentUserId && req.session.user!.role !== 'admin') {
    const permission = await pool.query<{ can_view_others: boolean }>(
      `SELECT can_view_others FROM user_personal_activity_permissions
       WHERE user_id = $1`,
      [currentUserId],
    )
    if (!permission.rows[0]?.can_view_others) {
      res.status(403).json({ error: 'Você não tem permissão para visualizar atividades de outras pessoas.' })
      return null
    }
  }
  return ownerId
}

async function persistTagNames(client: PoolClient, userId: number, tags: string[]) {
  if (!tags.length) return
  await client.query(
    `INSERT INTO personal_activity_tags (user_id, name)
     SELECT $1, tag.name
     FROM unnest($2::text[]) AS tag(name)
     ON CONFLICT DO NOTHING`,
    [userId, tags],
  )
}

async function canonicalizeTagNames(client: PoolClient, userId: number, tags: string[]) {
  const catalog = await client.query<{ name: string }>(
    'SELECT name FROM personal_activity_tags WHERE user_id = $1',
    [userId],
  )
  const savedNames = new Map(catalog.rows.map(({ name }) => [name.trim().toLocaleLowerCase('pt-BR'), name]))
  const seen = new Set<string>()
  return tags.flatMap((tag) => {
    const name = tag.trim()
    const key = name.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return []
    seen.add(key)
    return [savedNames.get(key) ?? name]
  })
}

router.get('/', async (req, res, next) => {
  const client = await pool.connect()
  try {
    const userId = await getOwnerId(req, res)
    if (userId === null) return
    await client.query('BEGIN')
    const owner = await client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    )
    if (!owner.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Usuário não encontrado.' })
      return
    }
    await client.query(
      `INSERT INTO personal_activity_columns (user_id, name, position)
       SELECT $1, defaults.name, defaults.position
       FROM (VALUES
         ('Novo', 0),
         ('Em andamento', 1),
         ('Pendente Validação', 2),
         ('Concluído', 3)
       ) AS defaults(name, position)
       WHERE NOT EXISTS (
         SELECT 1 FROM personal_activity_columns WHERE user_id = $1
       )`,
      [userId],
    )
    const [columns, activities, tags] = await Promise.all([
      client.query<{ id: string; name: string; position: number }>(
        `SELECT id, name, position FROM personal_activity_columns
         WHERE user_id = $1 ORDER BY position, id`,
        [userId],
      ),
      client.query<{
        id: string; column_id: string; title: string; description: string; start_date: string | null; due_date: string | null; tags: string[]; comments_count: number; attachments_count: number
      }>(
        `SELECT a.id, a.column_id, a.title, a.description, a.start_date::text, a.due_date::text, a.tags,
                (SELECT count(*)::int FROM personal_activity_comments c WHERE c.activity_id = a.id) AS comments_count,
                (SELECT count(*)::int FROM personal_activity_attachments f WHERE f.activity_id = a.id) AS attachments_count
         FROM personal_activities a WHERE a.user_id = $1 ORDER BY a.created_at, a.id`,
        [userId],
      ),
      client.query<{ id: string; name: string }>(
        `SELECT id, name FROM personal_activity_tags
         WHERE user_id = $1 ORDER BY lower(name), id`,
        [userId],
      ),
    ])
    await client.query('COMMIT')
    res.json({
      userId,
      userName: owner.rows[0].display_name,
      columns: columns.rows.map((column) => ({ id: Number(column.id), name: column.name, position: column.position })),
      tags: tags.rows.map((tag) => ({ id: Number(tag.id), name: tag.name })),
      activities: activities.rows.map((activity) => ({
        id: Number(activity.id),
        columnId: Number(activity.column_id),
        title: activity.title,
        description: activity.description,
        startDate: activity.start_date,
        dueDate: activity.due_date,
        tags: activity.tags,
        commentsCount: activity.comments_count,
        attachmentsCount: activity.attachments_count,
      })),
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/users', async (req, res, next) => {
  try {
    const permission = await pool.query<{ can_view_others: boolean }>(
      `SELECT can_view_others FROM user_personal_activity_permissions WHERE user_id = $1`,
      [req.session.user!.id],
    )
    if (req.session.user!.role !== 'admin' && !permission.rows[0]?.can_view_others) {
      res.status(403).json({ error: 'Você não tem permissão para selecionar outros quadros.' })
      return
    }
    const result = await pool.query<{ id: number; display_name: string }>(
      `SELECT u.id, u.display_name FROM users u
       WHERE u.status = 'active' AND (u.role = 'admin' OR EXISTS (
         SELECT 1 FROM user_page_access p
         WHERE p.user_id = u.id AND p.page_key = 'personal-activities'
       ))
       ORDER BY lower(u.display_name), u.id`,
    )
    res.json({ users: result.rows.map((user) => ({ id: user.id, displayName: user.display_name })) })
  } catch (error) {
    next(error)
  }
})

router.post('/tags', async (req, res, next) => {
  const parsed = tagSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um nome de tag com até 40 caracteres.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; name: string }>(
      `INSERT INTO personal_activity_tags (user_id, name)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id, name`,
      [req.session.user!.id, parsed.data.name],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'Você já tem uma tag com esse nome neste quadro.' })
      return
    }
    res.status(201).json({ tag: { id: Number(result.rows[0].id), name: result.rows[0].name } })
  } catch (error) {
    next(error)
  }
})

router.patch('/tags/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = tagSchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Tag ou nome inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM personal_activity_tags
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id.data, req.session.user!.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Tag não encontrada neste quadro.' })
      return
    }
    const duplicate = await client.query(
      `SELECT 1 FROM personal_activity_tags
       WHERE user_id = $1 AND id <> $2 AND lower(btrim(name)) = lower(btrim($3))`,
      [req.session.user!.id, id.data, parsed.data.name],
    )
    if (duplicate.rowCount) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Já existe outra tag com esse nome neste quadro.' })
      return
    }
    const oldName = current.rows[0].name
    const newName = parsed.data.name
    await client.query(
      `UPDATE personal_activities activity
       SET tags = COALESCE((
         SELECT array_agg(tag.tag ORDER BY tag.first_position)
         FROM (
           SELECT min(mapped.tag) AS tag, min(mapped.position) AS first_position
           FROM (
             SELECT CASE WHEN lower(btrim(item.tag)) = lower(btrim($2)) THEN $3 ELSE item.tag END AS tag,
                    item.position
             FROM unnest(activity.tags) WITH ORDINALITY AS item(tag, position)
           ) mapped
           GROUP BY lower(btrim(mapped.tag))
         ) tag
       ), '{}'::text[]),
       updated_at = now()
       WHERE activity.user_id = $1 AND EXISTS (
         SELECT 1 FROM unnest(activity.tags) item(tag)
         WHERE lower(btrim(item.tag)) = lower(btrim($2))
       )`,
      [req.session.user!.id, oldName, newName],
    )
    const updated = await client.query<{ id: string; name: string }>(
      `UPDATE personal_activity_tags SET name = $1, updated_at = now()
       WHERE id = $2 AND user_id = $3
       RETURNING id, name`,
      [newName, id.data, req.session.user!.id],
    )
    await client.query('COMMIT')
    res.json({ tag: { id: Number(updated.rows[0].id), name: updated.rows[0].name } })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.delete('/tags/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Identificador de tag inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ name: string }>(
      `SELECT name FROM personal_activity_tags
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id.data, req.session.user!.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Tag não encontrada neste quadro.' })
      return
    }
    await client.query(
      `UPDATE personal_activities activity
       SET tags = COALESCE((
         SELECT array_agg(item.tag ORDER BY item.position)
         FROM unnest(activity.tags) WITH ORDINALITY AS item(tag, position)
         WHERE lower(btrim(item.tag)) <> lower(btrim($2))
       ), '{}'::text[]),
       updated_at = now()
       WHERE activity.user_id = $1 AND EXISTS (
         SELECT 1 FROM unnest(activity.tags) item(tag)
         WHERE lower(btrim(item.tag)) = lower(btrim($2))
       )`,
      [req.session.user!.id, current.rows[0].name],
    )
    await client.query(
      'DELETE FROM personal_activity_tags WHERE id = $1 AND user_id = $2',
      [id.data, req.session.user!.id],
    )
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.post('/columns', async (req, res, next) => {
  const parsed = columnSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um nome válido para a coluna.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; name: string; position: number }>(
      `INSERT INTO personal_activity_columns (user_id, name, position)
       SELECT $1, $2, count(*)::int FROM personal_activity_columns
       WHERE user_id = $1 HAVING count(*) < 30
       RETURNING id, name, position`,
      [req.session.user!.id, parsed.data.name],
    )
    if (!result.rowCount) {
      res.status(400).json({ error: 'O quadro pode ter no máximo 30 colunas.' })
      return
    }
    res.status(201).json({ column: { ...result.rows[0], id: Number(result.rows[0].id) } })
  } catch (error) {
    next(error)
  }
})

router.patch('/columns/order', async (req, res, next) => {
  const parsed = columnOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'A ordem das colunas é inválida.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ id: string }>(
      `SELECT id FROM personal_activity_columns WHERE user_id = $1 FOR UPDATE`,
      [req.session.user!.id],
    )
    const currentIds = new Set(current.rows.map((column) => Number(column.id)))
    if (currentIds.size !== parsed.data.ids.length || parsed.data.ids.some((id) => !currentIds.has(id))) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'A ordem precisa incluir todas as colunas deste quadro.' })
      return
    }
    await client.query(
      `UPDATE personal_activity_columns column_to_update
       SET position = ordered.position - 1
       FROM unnest($1::bigint[]) WITH ORDINALITY AS ordered(id, position)
       WHERE column_to_update.user_id = $2 AND column_to_update.id = ordered.id`,
      [parsed.data.ids, req.session.user!.id],
    )
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/columns/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = columnSchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Coluna ou nome inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE personal_activity_columns SET name = $1
       WHERE id = $2 AND user_id = $3 RETURNING id`,
      [parsed.data.name, id.data, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Coluna não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/columns/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Coluna inválida.' })
    return
  }
  try {
    const result = await pool.query(
      `DELETE FROM personal_activity_columns column_to_delete
       WHERE column_to_delete.id = $1 AND column_to_delete.user_id = $2
         AND (SELECT count(*) FROM personal_activity_columns WHERE user_id = $2) > 1
         AND NOT EXISTS (SELECT 1 FROM personal_activities WHERE column_id = column_to_delete.id)
       RETURNING id`,
      [id.data, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'A coluna não existe, ainda contém atividades ou é a última do quadro. Mova ou exclua as atividades primeiro.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/items', async (req, res, next) => {
  const parsed = activitySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Atividade inválida.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tags = await canonicalizeTagNames(client, Number(req.session.user!.id), parsed.data.tags)
    const result = await client.query<{
      id: string; column_id: string; title: string; description: string; start_date: string | null; due_date: string | null; tags: string[]
    }>(
      `INSERT INTO personal_activities (user_id, column_id, title, description, start_date, due_date, tags)
       SELECT $1, c.id, $3, $4, $5, $6, $7
       FROM personal_activity_columns c WHERE c.id = $2 AND c.user_id = $1
       RETURNING id, column_id, title, description, start_date::text, due_date::text, tags`,
      [req.session.user!.id, parsed.data.columnId, parsed.data.title, parsed.data.description, parsed.data.startDate ?? null, parsed.data.dueDate ?? null, tags],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'A coluna selecionada não existe neste quadro.' })
      return
    }
    const activity = result.rows[0]
    await persistTagNames(client, Number(req.session.user!.id), activity.tags)
    await client.query('COMMIT')
    res.status(201).json({
      activity: { id: Number(activity.id), columnId: Number(activity.column_id), title: activity.title, description: activity.description, startDate: activity.start_date, dueDate: activity.due_date, tags: activity.tags },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/items/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = activityUpdateSchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Atividade inválida.' })
    return
  }
  const { columnId, title, description, startDate, dueDate, tags } = parsed.data
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const canonicalTags = tags === undefined
      ? undefined
      : await canonicalizeTagNames(client, Number(req.session.user!.id), tags)
    const result = await client.query(
      `UPDATE personal_activities a
       SET column_id = COALESCE($1, a.column_id),
           title = COALESCE($2, a.title),
           description = COALESCE($3, a.description),
           due_date = CASE WHEN $4::boolean THEN $5::date ELSE a.due_date END,
           start_date = CASE WHEN $6::boolean THEN $7::date ELSE a.start_date END,
           tags = CASE WHEN $8::boolean THEN $9::text[] ELSE a.tags END,
           updated_at = now()
       WHERE a.id = $10 AND a.user_id = $11
         AND ($1::bigint IS NULL OR EXISTS (
           SELECT 1 FROM personal_activity_columns c WHERE c.id = $1 AND c.user_id = a.user_id
         ))
       RETURNING a.id`,
      [columnId ?? null, title ?? null, description ?? null, dueDate !== undefined, dueDate ?? null,
        startDate !== undefined, startDate ?? null, tags !== undefined, canonicalTags ?? null, id.data, req.session.user!.id],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Atividade ou coluna não encontrada.' })
      return
    }
    if (canonicalTags !== undefined) await persistTagNames(client, Number(req.session.user!.id), canonicalTags)
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/items/:id/comments', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Identificador de atividade inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data)
    if (ownerId === null) return
    const result = await pool.query<{
      id: string; body: string; created_at: Date; updated_at: Date; author_id: string; author_name: string
    }>(
      `SELECT c.id, c.body, c.created_at, c.updated_at, c.author_id, u.display_name AS author_name
       FROM personal_activity_comments c JOIN users u ON u.id = c.author_id
       WHERE c.activity_id = $1 ORDER BY c.created_at, c.id`,
      [id.data],
    )
    res.json({ comments: result.rows.map((comment) => ({
      id: Number(comment.id),
      body: comment.body,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      authorId: Number(comment.author_id),
      authorName: comment.author_name,
    })) })
  } catch (error) {
    next(error)
  }
})

router.post('/items/:id/comments', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = commentSchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador de atividade inválido.' : parsed.error.issues[0]?.message })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data, true)
    if (ownerId === null) return
    const result = await pool.query<{
      id: string; body: string; created_at: Date; updated_at: Date; author_id: string; author_name: string
    }>(
      `INSERT INTO personal_activity_comments (activity_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at, updated_at, author_id,
         (SELECT display_name FROM users WHERE id = $2) AS author_name`,
      [id.data, req.session.user!.id, parsed.data.body],
    )
    const comment = result.rows[0]
    res.status(201).json({ comment: {
      id: Number(comment.id), body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at,
      authorId: Number(comment.author_id), authorName: comment.author_name,
    } })
  } catch (error) {
    next(error)
  }
})

router.patch('/items/:id/comments/:commentId', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const commentId = z.coerce.number().int().positive().safeParse(req.params.commentId)
  const parsed = commentSchema.safeParse(req.body)
  if (!id.success || !commentId.success || !parsed.success) {
    res.status(400).json({ error: 'Comentário inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data, true)
    if (ownerId === null) return
    const result = await pool.query(
      `UPDATE personal_activity_comments SET body = $1, updated_at = now()
       WHERE id = $2 AND activity_id = $3
         AND (author_id = $4 OR $5::bigint = $4)
       RETURNING id`,
      [parsed.data.body, commentId.data, id.data, req.session.user!.id, ownerId],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:id/comments/:commentId', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const commentId = z.coerce.number().int().positive().safeParse(req.params.commentId)
  if (!id.success || !commentId.success) {
    res.status(400).json({ error: 'Identificador de comentário inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data, true)
    if (ownerId === null) return
    const result = await pool.query(
      `DELETE FROM personal_activity_comments
       WHERE id = $1 AND activity_id = $2 AND (author_id = $3 OR $4::bigint = $3)
       RETURNING id`,
      [commentId.data, id.data, req.session.user!.id, ownerId],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/items/:id/attachments', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Identificador de atividade inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data)
    if (ownerId === null) return
    const result = await pool.query<{
      id: string; file_name: string; content_type: string; file_size: number; created_at: Date; uploaded_by: string; uploaded_by_name: string
    }>(
      `SELECT a.id, a.file_name, a.content_type, a.file_size, a.created_at, a.uploaded_by, u.display_name AS uploaded_by_name
       FROM personal_activity_attachments a JOIN users u ON u.id = a.uploaded_by
       WHERE a.activity_id = $1 ORDER BY a.created_at, a.id`,
      [id.data],
    )
    res.json({ attachments: result.rows.map((file) => ({
      id: Number(file.id), fileName: file.file_name, contentType: file.content_type,
      fileSize: file.file_size, createdAt: file.created_at, uploadedBy: Number(file.uploaded_by),
      uploadedByName: file.uploaded_by_name,
    })) })
  } catch (error) {
    next(error)
  }
})

router.post('/items/:id/attachments', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = uploadSchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Arquivo inválido ou maior que o limite permitido.' })
    return
  }
  const fileName = parsed.data.fileName.replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
  const contentType = parsed.data.contentType.toLowerCase()
  const content = Buffer.from(parsed.data.contentBase64, 'base64')
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv'])
  if (!fileName || !allowedTypes.has(contentType) || !content.length || content.length > 5 * 1024 * 1024 ||
      content.toString('base64') !== parsed.data.contentBase64) {
    res.status(400).json({ error: 'Anexe PDF, imagem JPEG/PNG/WebP ou arquivo de texto/CSV de até 5 MiB.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data, true)
    if (ownerId === null) return
    const result = await pool.query<{ id: string }>(
      `INSERT INTO personal_activity_attachments
         (activity_id, uploaded_by, file_name, content_type, file_size, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id.data, req.session.user!.id, fileName, contentType, content.length, content],
    )
    res.status(201).json({ id: Number(result.rows[0].id) })
  } catch (error) {
    next(error)
  }
})

router.get('/items/:id/attachments/:attachmentId', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const attachmentId = z.coerce.number().int().positive().safeParse(req.params.attachmentId)
  if (!id.success || !attachmentId.success) {
    res.status(400).json({ error: 'Identificador de anexo inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data)
    if (ownerId === null) return
    const result = await pool.query<{ file_name: string; content_type: string; content: Buffer }>(
      `SELECT file_name, content_type, content FROM personal_activity_attachments
       WHERE id = $1 AND activity_id = $2`,
      [attachmentId.data, id.data],
    )
    const file = result.rows[0]
    if (!file) {
      res.status(404).json({ error: 'Anexo não encontrado.' })
      return
    }
    const asciiName = file.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    res.setHeader('Content-Type', file.content_type)
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(file.content)
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:id/attachments/:attachmentId', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  const attachmentId = z.coerce.number().int().positive().safeParse(req.params.attachmentId)
  if (!id.success || !attachmentId.success) {
    res.status(400).json({ error: 'Identificador de anexo inválido.' })
    return
  }
  try {
    const ownerId = await getActivityAccess(req, res, id.data, true)
    if (ownerId === null) return
    const result = await pool.query(
      'DELETE FROM personal_activity_attachments WHERE id = $1 AND activity_id = $2 RETURNING id',
      [attachmentId.data, id.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Anexo não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Atividade inválida.' })
    return
  }
  try {
    const result = await pool.query(
      `DELETE FROM personal_activities WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id.data, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Atividade não encontrada.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
