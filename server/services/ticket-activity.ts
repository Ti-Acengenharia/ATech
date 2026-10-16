import type { PoolClient } from 'pg'

export async function recordTicketActivity(
  client: PoolClient,
  ticketId: number | string,
  actorId: number | string | null,
  eventType: string,
  summary: string,
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO ticket_activity_history (ticket_id, actor_id, event_type, summary, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, actorId, eventType, summary, JSON.stringify(details)],
  )
}
