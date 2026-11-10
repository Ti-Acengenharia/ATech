import type { Response } from 'express'
import { pool } from '../db.js'

export interface SyncEvent {
  id?: string
  scope: string
  action?: string
  entityId?: string | number
  meta?: Record<string, unknown>
  timestamp?: number
}

interface ConnectedClient {
  id: string
  res: Response
  userId: number
}

const clients = new Map<string, ConnectedClient>()
const recentEventIds = new Set<string>()

function addRecentEventId(id: string) {
  recentEventIds.add(id)
  if (recentEventIds.size > 200) {
    const first = recentEventIds.values().next().value
    if (first) recentEventIds.delete(first)
  }
}

export function registerSyncClient(id: string, res: Response, userId: number): () => void {
  clients.set(id, { id, res, userId })

  return () => {
    clients.delete(id)
  }
}

function sendToLocalClients(event: SyncEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients.values()) {
    try {
      client.res.write(payload)
    } catch {
      clients.delete(client.id)
    }
  }
}

export async function broadcastSyncEvent(event: Omit<SyncEvent, 'id' | 'timestamp'> & { id?: string }): Promise<void> {
  const fullEvent: SyncEvent = {
    ...event,
    id: event.id || `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
  }

  addRecentEventId(fullEvent.id!)
  sendToLocalClients(fullEvent)

  try {
    await pool.query('SELECT pg_notify($1, $2)', ['atech_sync', JSON.stringify(fullEvent)])
  } catch (error) {
    // Local broadcast succeeded even if pg_notify failed
    console.error('[sync-events] pg_notify error:', error)
  }
}

// Dedicated listener for PostgreSQL notifications across multiple processes
let isListening = false

export async function initPostgresSyncListener(): Promise<void> {
  if (isListening) return

  try {
    const listenerClient = await pool.connect()
    isListening = true

    await listenerClient.query('LISTEN atech_sync')

    listenerClient.on('notification', (msg) => {
      if (msg.channel === 'atech_sync' && msg.payload) {
        try {
          const parsed = JSON.parse(msg.payload) as SyncEvent
          if (parsed.id && recentEventIds.has(parsed.id)) {
            // Already broadcast locally
            return
          }
          if (parsed.id) addRecentEventId(parsed.id)
          sendToLocalClients(parsed)
        } catch {
          // ignore malformed payloads
        }
      }
    })

    listenerClient.on('error', (err) => {
      console.warn('[sync-events] PostgreSQL listener client error, reconnecting in 5s:', err)
      try {
        listenerClient.release(true)
      } catch {
        // ignore
      }
      isListening = false
      setTimeout(() => void initPostgresSyncListener(), 5000)
    })
  } catch (err) {
    console.warn('[sync-events] Could not establish LISTEN client, retrying in 10s:', err)
    isListening = false
    setTimeout(() => void initPostgresSyncListener(), 10000)
  }
}

// Keep-alive heartbeat every 25 seconds to keep proxies and firewalls alive
setInterval(() => {
  if (clients.size === 0) return
  for (const client of clients.values()) {
    try {
      client.res.write(': keepalive\n\n')
    } catch {
      clients.delete(client.id)
    }
  }
}, 25_000)

