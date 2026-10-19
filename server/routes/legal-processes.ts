import { Router } from 'express'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'

const router = Router()
const idSchema = z.coerce.number().int().positive()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const externalUrlSchema = z.string().trim().max(2000).refine((value) => {
  if (!value) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
})
const processSchema = z.object({
  title: z.string().trim().min(1).max(240),
  statusId: z.number().int().positive(),
  startDate: dateSchema,
  endDate: dateSchema,
  description: z.string().max(20_000),
  caseValue: z.number().finite().nonnegative().max(99_999_999_999.99).nullable(),
  claimant: z.string().trim().max(240),
  driveUrl: externalUrlSchema,
  notebookUrl: externalUrlSchema,
  distributionDate: dateSchema,
  assigneeIds: z.array(z.number().int().positive()).max(100),
  children: z.array(z.object({
    id: z.number().int().positive().optional(),
    processNumber: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
    statusId: z.number().int().positive(),
    movementDate: dateSchema,
    isDone: z.boolean(),
  })).max(100),
}).refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: 'A data de início deve ser anterior ou igual à data de finalização.',
  path: ['endDate'],
})
const statusSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[\da-f]{6}$/i),
})
const statusOrderSchema = z.object({
  statusIds: z.array(idSchema).min(1).max(100),
}).refine(({ statusIds }) => new Set(statusIds).size === statusIds.length, {
  message: 'A ordem contém status duplicados.',
})
const paymentSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: z.number().finite().nonnegative().max(99_999_999_999.99),
  dueDate: dateSchema,
  isPaid: z.boolean(),
})
const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  contentBase64: z.string().min(4).max(7_000_000),
})
const commentSchema = z.object({
  body: z.string().trim().min(1).max(6000),
  mentionIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
  parentCommentId: z.coerce.number().int().positive().nullable().optional().default(null),
})
const csvImportTaskSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(80),
  assignee: z.string().trim().max(500),
  priority: z.string().trim().max(100),
  dueDate: z.string().trim().max(200),
  taskContent: z.string().max(10_000),
  latestComment: z.string().max(6_000),
  commentCount: z.string().trim().max(20),
})
type CsvImportTask = z.infer<typeof csvImportTaskSchema>

function csvTaskDescription(task: CsvImportTask) {
  return [
    `Task ID ClickUp: ${task.id}`,
    `Responsável: ${task.assignee || 'Não informado'}`,
    `Prioridade: ${task.priority || 'Não informada'}`,
    `Prazo: ${task.dueDate || 'Não informado'}`,
    `Comentários no ClickUp: ${task.commentCount || '0'}`,
    task.taskContent ? `Descrição:\n${task.taskContent}` : '',
    task.latestComment ? `Último comentário:\n${task.latestComment}` : '',
  ].filter(Boolean).join('\n\n')
}

const csvImportSchema = z.object({
  tasks: z.array(csvImportTaskSchema).min(1).max(5000),
}).refine(({ tasks }) => new Set(tasks.map((task) => task.id)).size === tasks.length, {
  message: 'O CSV contém Task IDs duplicados.',
}).refine(({ tasks }) => Buffer.byteLength(JSON.stringify(tasks), 'utf8') <= 7_000_000, {
  message: 'O conteúdo do CSV é grande demais para importar em uma única operação.',
}).refine(({ tasks }) => tasks.every((task) => {
  return csvTaskDescription(task).length <= 20_000
}), {
  message: 'Uma ou mais tarefas têm descrição e comentário acima do limite permitido por cartão.',
})

router.use(requireAuth)
async function validateChildStatuses(client: PoolClient, children: z.infer<typeof processSchema>['children']) {
  const statusIds = [...new Set(children.map((child) => child.statusId))]
  if (!statusIds.length) return true
  const result = await client.query(
    'SELECT id FROM legal_process_statuses WHERE id = ANY($1::bigint[])',
    [statusIds],
  )
  return result.rowCount === statusIds.length
}

router.use(requirePageAccess('legal-processes'))

router.post('/import-csv', async (req, res, next) => {
  const parsed = csvImportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do CSV inválidos.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_process_csv_imports IN SHARE ROW EXCLUSIVE MODE')
    await client.query('LOCK TABLE legal_process_statuses IN SHARE ROW EXCLUSIVE MODE')

    const existingStatuses = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM legal_process_statuses ORDER BY position, id',
    )
    const statusIds = new Map(existingStatuses.rows.map((status) => [status.name.trim().toLocaleLowerCase(), status.id]))
    let nextPosition = existingStatuses.rows.length
    let statusesCreated = 0
    let importedCount = 0
    let skippedCount = 0
    const palette = ['#3478a8', '#a67824', '#7557a5', '#43805b', '#a44f4f', '#5c7183']

    for (const task of parsed.data.tasks) {
      const alreadyImported = await client.query(
        'SELECT 1 FROM legal_process_csv_imports WHERE external_task_id = $1',
        [task.id],
      )
      if (alreadyImported.rowCount) {
        skippedCount += 1
        continue
      }

      const normalizedStatus = task.status.trim()
      let statusId = statusIds.get(normalizedStatus.toLocaleLowerCase())
      if (!statusId) {
        const created = await client.query<{ id: string; name: string }>(
          `INSERT INTO legal_process_statuses (name, position, color, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (lower(name)) DO NOTHING
           RETURNING id, name`,
          [normalizedStatus, nextPosition, palette[statusesCreated % palette.length], req.session.user!.id],
        )
        if (created.rowCount) {
          statusId = created.rows[0].id
          nextPosition += 1
          statusesCreated += 1
        } else {
          const existing = await client.query<{ id: string; name: string }>(
            'SELECT id, name FROM legal_process_statuses WHERE lower(name) = lower($1)',
            [normalizedStatus],
          )
          statusId = existing.rows[0]?.id
        }
        if (!statusId) throw new Error(`Não foi possível obter a fase "${normalizedStatus}" do CSV.`)
        statusIds.set(normalizedStatus.toLocaleLowerCase(), statusId)
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO legal_processes (title, status_id, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [task.name, statusId, csvTaskDescription(task), req.session.user!.id],
      )
      await client.query(
        `INSERT INTO legal_process_csv_imports (external_task_id, process_id, imported_by)
         VALUES ($1, $2, $3)`,
        [task.id, inserted.rows[0].id, req.session.user!.id],
      )
      importedCount += 1
    }

    await client.query('COMMIT')
    res.status(201).json({ importedCount, skippedCount, statusesCreated })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/statuses', async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id::int AS id, name, position, color FROM legal_process_statuses ORDER BY position, id',
    )
    res.json({ statuses: result.rows })
  } catch (error) {
    next(error)
  }
})

router.put('/statuses/order', async (req, res, next) => {
  const parsed = statusOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Ordem dos status inválida.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_process_statuses IN SHARE ROW EXCLUSIVE MODE')
    const existing = await client.query<{ id: number }>(
      'SELECT id::int AS id FROM legal_process_statuses ORDER BY position, id',
    )
    const expectedIds = existing.rows.map((status) => status.id)
    if (
      parsed.data.statusIds.length !== expectedIds.length ||
      parsed.data.statusIds.some((id) => !expectedIds.includes(id))
    ) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'A lista de status mudou. Atualize a página e tente novamente.' })
      return
    }
    for (const [position, id] of parsed.data.statusIds.entries()) {
      await client.query('UPDATE legal_process_statuses SET position = $1 WHERE id = $2', [position, id])
    }
    const statuses = await client.query(
      'SELECT id::int AS id, name, position, color FROM legal_process_statuses ORDER BY position, id',
    )
    await client.query('COMMIT')
    res.json({ statuses: statuses.rows })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.post('/statuses', async (req, res, next) => {
  const parsed = statusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Status inválido.' })
    return
  }
  try {
    const position = await pool.query<{ position: number }>(
      'SELECT COALESCE(max(position), -1) + 1 AS position FROM legal_process_statuses',
    )
    const result = await pool.query(
      `INSERT INTO legal_process_statuses (name, position, color, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id::int AS id, name, position, color`,
      [parsed.data.name, position.rows[0].position, parsed.data.color, req.session.user!.id],
    )
    res.status(201).json({ status: result.rows[0] })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe um status com esse nome.' })
      return
    }
    next(error)
  }
})

router.delete('/statuses/:id', async (req, res, next) => {
  const statusId = idSchema.safeParse(req.params.id)
  if (!statusId.success) {
    res.status(400).json({ error: 'Identificador de status inválido.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE legal_process_statuses IN SHARE ROW EXCLUSIVE MODE')
    const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM legal_process_statuses')
    if (count.rows[0].count <= 1) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Mantenha pelo menos um status cadastrado.' })
      return
    }
    const result = await client.query(
      `DELETE FROM legal_process_statuses s
       WHERE s.id = $1
         AND NOT EXISTS (SELECT 1 FROM legal_processes p WHERE p.status_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM legal_process_children c WHERE c.status_id = s.id)
       RETURNING s.id`,
      [statusId.data],
    )
    if (!result.rowCount) {
      const exists = await client.query('SELECT 1 FROM legal_process_statuses WHERE id = $1', [statusId.data])
      await client.query('ROLLBACK')
      res.status(exists.rowCount ? 409 : 404).json({
        error: exists.rowCount ? 'Mova os processos e processos filhos deste status antes de excluí-lo.' : 'Status não encontrado.',
      })
      return
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

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id::int AS id, p.title, p.status_id::int AS status_id, s.name AS status_name, s.color AS status_color,
              p.start_date, p.end_date, p.description, p.case_value::text, p.claimant,
              p.drive_url, p.notebook_url, p.distribution_date, p.is_demo,
              p.created_at, p.updated_at,
              COALESCE((
                SELECT json_agg(json_build_object('id', u.id::int, 'displayName', u.display_name)
                                ORDER BY lower(u.display_name))
                FROM legal_process_assignees a JOIN users u ON u.id = a.user_id
                WHERE a.process_id = p.id
              ), '[]'::json) AS assignees,
              (SELECT count(*)::int FROM legal_process_children c WHERE c.process_id = p.id) AS children_count,
              (SELECT count(*)::int FROM legal_process_children c WHERE c.process_id = p.id AND c.is_done) AS completed_children_count,
              COALESCE((SELECT sum(pay.amount) FROM legal_process_payments pay
                        WHERE pay.process_id = p.id AND pay.is_paid), 0)::text AS paid_total,
              (SELECT count(*)::int FROM legal_process_payments pay WHERE pay.process_id = p.id) AS payment_count
       FROM legal_processes p
       JOIN legal_process_statuses s ON s.id = p.status_id
       ORDER BY s.position, p.updated_at DESC, p.id DESC`,
    )
    res.json({ processes: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/demo', async (req, res, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const status = await client.query<{ id: string }>(
      'SELECT id FROM legal_process_statuses ORDER BY position, id LIMIT 1',
    )
    if (!status.rowCount) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Crie uma situação antes de carregar o exemplo.' })
      return
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO legal_processes
         (title, status_id, start_date, end_date, description, case_value, claimant,
          drive_url, notebook_url, distribution_date, is_demo, created_by)
       VALUES ('DEMONSTRAÇÃO — Processo cível', $1, CURRENT_DATE, CURRENT_DATE + 30,
          'Registro fictício para conhecer a tela. Exclua este processo após a demonstração.',
          25000, 'Parte requerente fictícia', '', '', CURRENT_DATE, TRUE, $2)
       ON CONFLICT (is_demo) WHERE is_demo DO NOTHING
       RETURNING id`,
      [status.rows[0].id, req.session.user!.id],
    )
    if (!inserted.rowCount) {
      const existing = await client.query<{ id: string }>('SELECT id FROM legal_processes WHERE is_demo')
      await client.query('COMMIT')
      res.json({ id: existing.rows[0].id })
      return
    }
    const processId = inserted.rows[0].id
    await client.query(
      `INSERT INTO legal_process_children (process_id, process_number, description, status_id, movement_date, position)
       VALUES ($1, 'EX-001', 'Revisar documentos do processo', $2, CURRENT_DATE, 0),
              ($1, 'EX-002', 'Preparar manifestação inicial', $2, CURRENT_DATE, 1)`,
      [processId, status.rows[0].id],
    )
    await client.query(
      `INSERT INTO legal_process_payments (process_id, description, amount, due_date, is_paid, created_by)
       VALUES ($1, 'Custas iniciais — exemplo', 350.00, CURRENT_DATE, TRUE, $2)`,
      [processId, req.session.user!.id],
    )
    await client.query('COMMIT')
    res.status(201).json({ id: processId })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/:id', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  if (!processId.success) {
    res.status(400).json({ error: 'Identificador de processo inválido.' })
    return
  }
  try {
    const process = await pool.query(
      `SELECT p.id::int AS id, p.title, p.status_id::int AS "statusId", p.start_date AS "startDate",
              p.end_date AS "endDate", p.description, p.case_value::text AS "caseValue",
              p.claimant, p.drive_url AS "driveUrl", p.notebook_url AS "notebookUrl",
              p.distribution_date AS "distributionDate", p.is_demo AS "isDemo",
              COALESCE((SELECT array_agg(user_id::int ORDER BY user_id)
                        FROM legal_process_assignees WHERE process_id = p.id), '{}') AS "assigneeIds",
              COALESCE((SELECT json_agg(json_build_object(
                                        'id', c.id::int,
                                        'processNumber', c.process_number,
                                        'description', c.description,
                                        'statusId', c.status_id::int,
                                        'movementDate', c.movement_date,
                                        'isDone', c.is_done)
                                        ORDER BY c.position, c.id)
                        FROM legal_process_children c WHERE c.process_id = p.id), '[]'::json) AS children,
              COALESCE((SELECT json_agg(json_build_object(
                'id', c.id::int, 'body', c.body, 'parentCommentId', c.parent_comment_id::int,
                'authorId', c.author_id::int, 'authorName', u.display_name,
                'createdAt', c.created_at, 'updatedAt', c.updated_at,
                'mentions', COALESCE((SELECT json_agg(json_build_object('id', mu.id::int, 'displayName', mu.display_name))
                                      FROM legal_process_comment_mentions m
                                      JOIN users mu ON mu.id = m.user_id
                                      WHERE m.comment_id = c.id), '[]'::json)
              ) ORDER BY c.created_at, c.id)
                FROM legal_process_comments c JOIN users u ON u.id = c.author_id
                WHERE c.process_id = p.id), '[]'::json) AS comments,
              COALESCE((SELECT json_agg(json_build_object(
                'id', pay.id, 'description', pay.description, 'amount', pay.amount::text,
                'dueDate', pay.due_date, 'isPaid', pay.is_paid,
                'attachments', COALESCE((
                  SELECT json_agg(json_build_object('id', a.id, 'fileName', a.file_name,
                    'fileSize', a.file_size, 'contentType', a.content_type)
                    ORDER BY a.created_at, a.id)
                  FROM legal_process_payment_attachments a WHERE a.payment_id = pay.id
                ), '[]'::json)
              ) ORDER BY pay.due_date NULLS LAST, pay.id)
                FROM legal_process_payments pay WHERE pay.process_id = p.id), '[]'::json) AS payments,
              COALESCE((SELECT sum(amount) FROM legal_process_payments
                        WHERE process_id = p.id AND is_paid), 0)::text AS "paidTotal"
       FROM legal_processes p WHERE p.id = $1`,
      [processId.data],
    )
    if (!process.rowCount) {
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    res.json({ process: process.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  const parsed = processSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do processo inválidos.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const status = await client.query('SELECT 1 FROM legal_process_statuses WHERE id = $1', [parsed.data.statusId])
    if (!status.rowCount) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione um status válido.' })
      return
    }
    if (!(await validateChildStatuses(client, parsed.data.children))) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione um status válido para cada processo filho.' })
      return
    }
    const assignees = [...new Set(parsed.data.assigneeIds)]
    if (assignees.length) {
      const activeUsers = await client.query(
        `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND status = 'active'`,
        [assignees],
      )
      if (activeUsers.rowCount !== assignees.length) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Selecione somente responsáveis com acesso ativo.' })
        return
      }
    }
    const values = parsed.data
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO legal_processes
        (title, status_id, start_date, end_date, description, case_value, claimant,
         drive_url, notebook_url, distribution_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::int AS id`,
      [values.title, values.statusId, values.startDate, values.endDate, values.description,
        values.caseValue, values.claimant, values.driveUrl, values.notebookUrl,
        values.distributionDate, req.session.user!.id],
    )
    const processId = inserted.rows[0].id
    for (const userId of assignees) {
      await client.query('INSERT INTO legal_process_assignees (process_id, user_id) VALUES ($1, $2)', [processId, userId])
    }
    for (const [position, child] of values.children.entries()) {
      await client.query(
        `INSERT INTO legal_process_children
          (process_id, process_number, description, status_id, movement_date, is_done, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [processId, child.processNumber, child.description, child.statusId, child.movementDate, child.isDone, position],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ id: processId })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const parsed = processSchema.safeParse(req.body)
  if (!processId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const status = await client.query('SELECT 1 FROM legal_process_statuses WHERE id = $1', [parsed.data.statusId])
    if (!status.rowCount) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione um status válido.' })
      return
    }
    if (!(await validateChildStatuses(client, parsed.data.children))) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione um status válido para cada processo filho.' })
      return
    }
    const assignees = [...new Set(parsed.data.assigneeIds)]
    const activeUsers = assignees.length
      ? await client.query(`SELECT id FROM users WHERE id = ANY($1::bigint[]) AND status = 'active'`, [assignees])
      : { rowCount: 0 }
    if (activeUsers.rowCount !== assignees.length) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione somente responsáveis com acesso ativo.' })
      return
    }
    const values = parsed.data
    const updated = await client.query(
      `UPDATE legal_processes SET title = $1, status_id = $2, start_date = $3, end_date = $4,
         description = $5, case_value = $6, claimant = $7, drive_url = $8, notebook_url = $9,
         distribution_date = $10, updated_at = now()
       WHERE id = $11 RETURNING id`,
      [values.title, values.statusId, values.startDate, values.endDate, values.description,
        values.caseValue, values.claimant, values.driveUrl, values.notebookUrl, values.distributionDate, processId.data],
    )
    if (!updated.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    await client.query('DELETE FROM legal_process_assignees WHERE process_id = $1', [processId.data])
    for (const userId of assignees) {
      await client.query('INSERT INTO legal_process_assignees (process_id, user_id) VALUES ($1, $2)', [processId.data, userId])
    }
    await client.query('DELETE FROM legal_process_children WHERE process_id = $1', [processId.data])
    for (const [position, child] of values.children.entries()) {
      await client.query(
        `INSERT INTO legal_process_children
          (process_id, process_number, description, status_id, movement_date, is_done, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [processId.data, child.processNumber, child.description, child.statusId, child.movementDate, child.isDone, position],
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

router.patch('/:id/status', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const parsed = z.object({ statusId: z.number().int().positive() }).safeParse(req.body)
  if (!processId.success || !parsed.success) {
    res.status(400).json({ error: 'Processo ou status inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE legal_processes p SET status_id = $1, updated_at = now()
       WHERE p.id = $2 AND EXISTS (SELECT 1 FROM legal_process_statuses s WHERE s.id = $1)
       RETURNING p.id`,
      [parsed.data.statusId, processId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Processo ou status não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  if (!processId.success) {
    res.status(400).json({ error: 'Identificador de processo inválido.' })
    return
  }
  try {
    const result = await pool.query('DELETE FROM legal_processes WHERE id = $1 RETURNING id', [processId.data])
    if (!result.rowCount) {
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/links', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const parsed = z.object({
    field: z.enum(['driveUrl', 'notebookUrl']),
    url: externalUrlSchema,
  }).safeParse(req.body)
  if (!processId.success || !parsed.success) {
    res.status(400).json({ error: 'Link inválido.' })
    return
  }
  try {
    const column = parsed.data.field === 'driveUrl' ? 'drive_url' : 'notebook_url'
    const result = await pool.query(
      `UPDATE legal_processes SET ${column} = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [parsed.data.url, processId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/:id/comments', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const parsed = commentSchema.safeParse(req.body)
  if (!processId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const parentId = parsed.data.parentCommentId
    if (parentId) {
      const parent = await client.query(
        `SELECT id FROM legal_process_comments
         WHERE id = $1 AND process_id = $2 AND parent_comment_id IS NULL FOR UPDATE`,
        [parentId, processId.data],
      )
      if (!parent.rowCount) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Comentário para resposta não encontrado neste processo.' })
        return
      }
    }
    const mentionIds = [...new Set(parsed.data.mentionIds)]
    if (mentionIds.length) {
      const mentions = await client.query(
        `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND status = 'active'`,
        [mentionIds],
      )
      if (mentions.rowCount !== mentionIds.length) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Uma ou mais pessoas mencionadas não estão ativas.' })
        return
      }
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO legal_process_comments (process_id, author_id, parent_comment_id, body)
       SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM legal_processes WHERE id = $1)
       RETURNING id`,
      [processId.data, req.session.user!.id, parentId, parsed.data.body],
    )
    if (!inserted.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    for (const mentionId of mentionIds) {
      await client.query(
        'INSERT INTO legal_process_comment_mentions (comment_id, user_id) VALUES ($1, $2)',
        [inserted.rows[0].id, mentionId],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ id: inserted.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/:id/comments/:commentId', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const commentId = idSchema.safeParse(req.params.commentId)
  const parsed = z.object({ body: z.string().trim().min(1).max(6000) }).safeParse(req.body)
  if (!processId.success || !commentId.success || !parsed.success) {
    res.status(400).json({ error: 'Comentário inválido.' })
    return
  }
  try {
    const comment = await pool.query<{ author_id: string }>(
      'SELECT author_id FROM legal_process_comments WHERE id = $1 AND process_id = $2',
      [commentId.data, processId.data],
    )
    if (!comment.rowCount) {
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    if (comment.rows[0].author_id !== String(req.session.user!.id) && req.session.user!.role !== 'admin') {
      res.status(403).json({ error: 'Somente quem escreveu o comentário ou a administração pode editá-lo.' })
      return
    }
    await pool.query(
      'UPDATE legal_process_comments SET body = $1, updated_at = now() WHERE id = $2',
      [parsed.data.body, commentId.data],
    )
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const commentId = idSchema.safeParse(req.params.commentId)
  if (!processId.success || !commentId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  try {
    const comment = await pool.query<{ author_id: string }>(
      'SELECT author_id FROM legal_process_comments WHERE id = $1 AND process_id = $2',
      [commentId.data, processId.data],
    )
    if (!comment.rowCount) {
      res.status(404).json({ error: 'Comentário não encontrado.' })
      return
    }
    if (comment.rows[0].author_id !== String(req.session.user!.id) && req.session.user!.role !== 'admin') {
      res.status(403).json({ error: 'Somente quem escreveu o comentário ou a administração pode excluí-lo.' })
      return
    }
    await pool.query('DELETE FROM legal_process_comments WHERE id = $1', [commentId.data])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/:id/payments', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const parsed = paymentSchema.safeParse(req.body)
  if (!processId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO legal_process_payments (process_id, description, amount, due_date, is_paid, created_by)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM legal_processes WHERE id = $1)
       RETURNING id`,
      [processId.data, parsed.data.description, parsed.data.amount, parsed.data.dueDate, parsed.data.isPaid, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Processo não encontrado.' })
      return
    }
    res.status(201).json({ id: result.rows[0].id })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/payments/:paymentId', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const paymentId = idSchema.safeParse(req.params.paymentId)
  const parsed = paymentSchema.safeParse(req.body)
  if (!processId.success || !paymentId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE legal_process_payments SET description = $1, amount = $2, due_date = $3,
         is_paid = $4, updated_at = now()
       WHERE id = $5 AND process_id = $6 RETURNING id`,
      [parsed.data.description, parsed.data.amount, parsed.data.dueDate, parsed.data.isPaid, paymentId.data, processId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Pagamento não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/payments/:paymentId', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const paymentId = idSchema.safeParse(req.params.paymentId)
  if (!processId.success || !paymentId.success) {
    res.status(400).json({ error: 'Identificador de pagamento inválido.' })
    return
  }
  try {
    const result = await pool.query(
      'DELETE FROM legal_process_payments WHERE id = $1 AND process_id = $2 RETURNING id',
      [paymentId.data, processId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Pagamento não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/:id/payments/:paymentId/attachments', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const paymentId = idSchema.safeParse(req.params.paymentId)
  const parsed = uploadSchema.safeParse(req.body)
  if (!processId.success || !paymentId.success || !parsed.success) {
    res.status(400).json({ error: 'Arquivo inválido ou maior que o limite permitido.' })
    return
  }
  const safeName = parsed.data.fileName.replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
  const contentType = parsed.data.contentType.toLowerCase()
  const content = Buffer.from(parsed.data.contentBase64, 'base64')
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  if (!safeName || !allowedTypes.has(contentType) || !content.length || content.length > 5 * 1024 * 1024 ||
      content.toString('base64') !== parsed.data.contentBase64) {
    res.status(400).json({ error: 'Anexe PDF ou imagem JPEG, PNG ou WebP de até 5 MiB.' })
    return
  }
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO legal_process_payment_attachments
         (payment_id, uploaded_by, file_name, content_type, file_size, content)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE EXISTS (SELECT 1 FROM legal_process_payments WHERE id = $1 AND process_id = $7)
       RETURNING id`,
      [paymentId.data, req.session.user!.id, safeName, contentType, content.length, content, processId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Pagamento não encontrado neste processo.' })
      return
    }
    res.status(201).json({ id: result.rows[0].id })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/payments/:paymentId/attachments/:attachmentId', async (req, res, next) => {
  const processId = idSchema.safeParse(req.params.id)
  const paymentId = idSchema.safeParse(req.params.paymentId)
  const attachmentId = idSchema.safeParse(req.params.attachmentId)
  if (!processId.success || !paymentId.success || !attachmentId.success) {
    res.status(400).json({ error: 'Identificador de anexo inválido.' })
    return
  }
  try {
    const result = await pool.query<{ file_name: string; content_type: string; content: Buffer }>(
      `SELECT a.file_name, a.content_type, a.content
       FROM legal_process_payment_attachments a
       JOIN legal_process_payments p ON p.id = a.payment_id AND p.process_id = $2
       WHERE a.id = $1 AND a.payment_id = $3`,
      [attachmentId.data, processId.data, paymentId.data],
    )
    const file = result.rows[0]
    if (!file) {
      res.status(404).json({ error: 'Comprovante não encontrado.' })
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

export default router
