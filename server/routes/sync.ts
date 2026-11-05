import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { registerSyncClient } from '../services/sync-events.js'

const router = Router()

router.get('/events', requireAuth, (req, res) => {
  const user = req.session.user!

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Critical for Nginx reverse proxy
  })

  // Flush headers if supported by compression or Express
  if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }

  // Initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ userId: user.id, time: Date.now() })}\n\n`)

  const clientId = `client_${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const cleanup = registerSyncClient(clientId, res, user.id)

  req.on('close', () => {
    cleanup()
  })
})

export default router

