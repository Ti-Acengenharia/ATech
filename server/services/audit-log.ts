import type { Pool, PoolClient } from 'pg'
import { pool } from '../db.js'

export interface AuditLogInput {
  actorUserId: number | null
  actorName: string
  action: string
  resourceType: string
  resourceId?: string | number
  summary: string
  metadata?: Record<string, unknown>
}

export async function recordAuditLog(
  input: AuditLogInput,
  dbClient: Pool | PoolClient = pool,
): Promise<void> {
  try {
    await dbClient.query(
      `INSERT INTO system_audit_logs (
         actor_user_id, actor_name, action, resource_type, resource_id, summary, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.actorUserId,
        input.actorName.slice(0, 160),
        input.action.slice(0, 80),
        input.resourceType.slice(0, 60),
        String(input.resourceId ?? '').slice(0, 120),
        input.summary,
        JSON.stringify(input.metadata ?? {}),
      ],
    )
  } catch (error) {
    console.error('[AuditLog] Falha ao gravar log de auditoria:', error)
  }
}

