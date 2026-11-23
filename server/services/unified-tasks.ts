import type { PoolClient } from 'pg'

export interface UserActivityColumnsInfo {
  initialColumnId: number
  completedColumnId: number
  columns: { id: number; name: string; position: number }[]
}

export async function ensureUserActivityColumns(
  client: PoolClient,
  userId: number | string,
): Promise<UserActivityColumnsInfo> {
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

  const colsRes = await client.query<{ id: string; name: string; position: number }>(
    `SELECT id::text, name, position
     FROM personal_activity_columns
     WHERE user_id = $1
     ORDER BY position, id`,
    [userId],
  )

  const columns = colsRes.rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    position: r.position,
  }))

  const initialCol = columns[0]
  const doneCol = [...columns].reverse().find((c) => /conclu/i.test(c.name)) ?? columns[columns.length - 1]

  return {
    initialColumnId: initialCol?.id ?? 0,
    completedColumnId: doneCol?.id ?? initialCol?.id ?? 0,
    columns,
  }
}

export async function createUnifiedTicketTask(
  client: PoolClient,
  params: {
    ticketId: string | number
    protocol?: string
    title: string
    assignedTo: number | null
    dueAt: string | null
    createdBy: number | string
  },
): Promise<{ subtaskId: string; personalActivityId: number }> {
  const userId = Number(params.createdBy)
  const { initialColumnId } = await ensureUserActivityColumns(client, userId)

  let protocol = params.protocol
  if (!protocol) {
    const ticketRes = await client.query<{ protocol: string }>(
      'SELECT protocol FROM tickets WHERE source_id = $1',
      [params.ticketId],
    )
    protocol = ticketRes.rows[0]?.protocol || String(params.ticketId)
  }

  const tag = `Chamado #${protocol.trim() || String(params.ticketId)}`.slice(0, 40)
  await client.query(
    `INSERT INTO personal_activity_tags (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, tag],
  )

  const dueDate = params.dueAt ? params.dueAt.slice(0, 10) : null
  const cleanTitle = params.title.trim().slice(0, 240)

  const activityRes = await client.query<{ id: string }>(
    `INSERT INTO personal_activities (
       user_id, column_id, title, description, priority, due_date, tags, ticket_id
     )
     VALUES ($1, $2, $3, '', 'medium', $4, $5, $6)
     RETURNING id::text`,
    [userId, initialColumnId, cleanTitle, dueDate, [tag], params.ticketId],
  )

  const personalActivityId = Number(activityRes.rows[0].id)

  const subtaskRes = await client.query<{ id: string }>(
    `INSERT INTO ticket_subtasks (
       ticket_id, title, assigned_to, due_at, is_done, created_by, personal_activity_id
     )
     VALUES ($1, $2, $3, $4, FALSE, $5, $6)
     RETURNING id::text`,
    [
      params.ticketId,
      params.title.trim().slice(0, 300),
      params.assignedTo,
      params.dueAt,
      userId,
      personalActivityId,
    ],
  )

  return {
    subtaskId: subtaskRes.rows[0].id,
    personalActivityId,
  }
}

export async function createUnifiedLegalTask(
  client: PoolClient,
  params: {
    processId: number | string
    title: string
    isDone: boolean
    position: number
    createdBy: number | string
    isDemo?: boolean
  },
): Promise<{ itemId: number; personalActivityId: number | null }> {
  const userId = Number(params.createdBy)

  if (params.isDemo) {
    const itemRes = await client.query<{ id: string }>(
      `INSERT INTO legal_process_items (process_id, title, is_done, position, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text`,
      [params.processId, params.title.trim().slice(0, 500), params.isDone, params.position, userId],
    )
    return { itemId: Number(itemRes.rows[0].id), personalActivityId: null }
  }

  const { initialColumnId, completedColumnId } = await ensureUserActivityColumns(client, userId)
  const targetColumnId = params.isDone ? completedColumnId : initialColumnId
  const tag = 'Jurídico'

  await client.query(
    `INSERT INTO personal_activity_tags (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, tag],
  )

  const cleanTitle = params.title.trim().slice(0, 240)
  const activityRes = await client.query<{ id: string }>(
    `INSERT INTO personal_activities (
       user_id, column_id, title, description, priority, tags, legal_process_id
     )
     VALUES ($1, $2, $3, '', 'medium', $4, $5)
     RETURNING id::text`,
    [userId, targetColumnId, cleanTitle, [tag], params.processId],
  )
  const personalActivityId = Number(activityRes.rows[0].id)

  const itemRes = await client.query<{ id: string }>(
    `INSERT INTO legal_process_items (
       process_id, title, is_done, position, created_by, personal_activity_id
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id::text`,
    [
      params.processId,
      params.title.trim().slice(0, 500),
      params.isDone,
      params.position,
      userId,
      personalActivityId,
    ],
  )

  return {
    itemId: Number(itemRes.rows[0].id),
    personalActivityId,
  }
}

export async function syncPersonalActivityFromSource(
  client: PoolClient,
  params: {
    personalActivityId: number | string | null | undefined
    title?: string
    isDone?: boolean
    dueDate?: string | null
  },
): Promise<void> {
  if (!params.personalActivityId) return

  const actRes = await client.query<{
    id: string
    user_id: string
    column_id: string
    column_name: string
  }>(
    `SELECT a.id::text, a.user_id::text, a.column_id::text, c.name AS column_name
     FROM personal_activities a
     JOIN personal_activity_columns c ON c.id = a.column_id
     WHERE a.id = $1
     FOR UPDATE`,
    [params.personalActivityId],
  )

  if (!actRes.rowCount) return
  const act = actRes.rows[0]
  const userId = Number(act.user_id)
  const isCurrentlyInDoneCol = /conclu/i.test(act.column_name)

  let nextColumnId = Number(act.column_id)
  if (params.isDone !== undefined) {
    const { initialColumnId, completedColumnId } = await ensureUserActivityColumns(client, userId)
    if (params.isDone && !isCurrentlyInDoneCol) {
      nextColumnId = completedColumnId
    } else if (!params.isDone && isCurrentlyInDoneCol) {
      nextColumnId = initialColumnId
    }
  }

  const nextTitle = params.title !== undefined ? params.title.trim().slice(0, 240) : null
  const updateDueDate = params.dueDate !== undefined

  await client.query(
    `UPDATE personal_activities
     SET column_id = $1,
         title = COALESCE($2, title),
         due_date = CASE WHEN $3::boolean THEN $4::date ELSE due_date END,
         updated_at = now()
     WHERE id = $5`,
    [nextColumnId, nextTitle, updateDueDate, params.dueDate ?? null, params.personalActivityId],
  )
}

export async function syncSourceFromPersonalActivity(
  client: PoolClient,
  activityId: number | string,
): Promise<{ ticketId: string | null; legalProcessId: number | null }> {
  const actRes = await client.query<{
    id: string
    title: string
    due_date: string | null
    ticket_id: string | null
    legal_process_id: string | null
    column_name: string
  }>(
    `SELECT a.id::text, a.title, a.due_date::text,
            a.ticket_id::text, a.legal_process_id::text,
            c.name AS column_name
     FROM personal_activities a
     JOIN personal_activity_columns c ON c.id = a.column_id
     WHERE a.id = $1`,
    [activityId],
  )

  if (!actRes.rowCount) {
    return { ticketId: null, legalProcessId: null }
  }

  const act = actRes.rows[0]
  const isDone = /conclu/i.test(act.column_name)

  const subtaskUpdate = await client.query<{ ticket_id: string }>(
    `UPDATE ticket_subtasks
     SET title = $1,
         is_done = $2,
         due_at = CASE
           WHEN $3::date IS NULL THEN NULL
           WHEN due_at IS NOT NULL AND (due_at AT TIME ZONE 'America/Maceio')::date = $3::date THEN due_at
           ELSE ($3::text || 'T12:00:00-03:00')::timestamptz
         END,
         updated_at = now()
     WHERE personal_activity_id = $4
     RETURNING ticket_id::text`,
    [act.title.slice(0, 300), isDone, act.due_date, activityId],
  )

  const legalItemUpdate = await client.query<{ process_id: string }>(
    `UPDATE legal_process_items
     SET title = $1,
         is_done = $2
     WHERE personal_activity_id = $3
     RETURNING process_id::text`,
    [act.title.slice(0, 500), isDone, activityId],
  )

  const ticketId = subtaskUpdate.rows[0]?.ticket_id ?? act.ticket_id ?? null
  const legalProcessIdRaw = legalItemUpdate.rows[0]?.process_id ?? act.legal_process_id ?? null

  return {
    ticketId,
    legalProcessId: legalProcessIdRaw ? Number(legalProcessIdRaw) : null,
  }
}
