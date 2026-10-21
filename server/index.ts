import express from 'express'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config.js'
import { pool } from './db.js'
import authRoutes from './routes/auth.js'
import collaboratorRoutes from './routes/collaborators.js'
import programmingRoutes from './routes/programming.js'
import teamRoutes from './routes/team.js'
import ticketRoutes from './routes/tickets.js'
import userRoutes from './routes/users.js'
import profileRoutes from './routes/profile.js'
import enterpriseInformationRoutes from './routes/enterprise-information.js'
import warrantyRoutes from './routes/warranties.js'
import legalProcessRoutes from './routes/legal-processes.js'
import personalActivityRoutes from './routes/personal-activities.js'
import { cvcrmAutoSyncIsEnabled, cvcrmIsConfigured, syncCvcrmTickets } from './services/cvcrm.js'

const app = express()
const PgSession = connectPgSimple(session)

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }))
app.use(express.json({ limit: '8mb' }))
app.use(
  session({
    name: 'atech.sid',
    store: new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
})

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use('/api/auth/admin/login', authLimiter)
app.use('/api/auth/google', authLimiter)
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/collaborators', collaboratorRoutes)
app.use('/api/tickets', ticketRoutes)
app.use('/api/programming', programmingRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/enterprise-information', enterpriseInformationRoutes)
app.use('/api/warranties', warrantyRoutes)
app.use('/api/legal-processes', legalProcessRoutes)
app.use('/api/personal-activities', personalActivityRoutes)

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Erro na API:', error)
  res.status(500).json({ error: 'Não foi possível concluir a solicitação.' })
})

const server = app.listen(env.PORT, env.API_HOST, () => {
  console.log(`API ATech disponível em http://${env.API_HOST}:${env.PORT}`)
})

if (cvcrmIsConfigured()) {
  const brasiliaClock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  let lastSyncSlot = ''

  const checkAndRunSync = async () => {
    const parts = Object.fromEntries(
      brasiliaClock.formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
    const minute = Number(parts.minute)
    const minuteOfDay = Number(parts.hour) * 60 + minute
    if ((minute !== 0 && minute !== 30) || minuteOfDay < 450 || minuteOfDay >= 1080) {
      return
    }
    const slot = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`
    if (slot === lastSyncSlot) return
    lastSyncSlot = slot

    try {
      const isEnabled = await cvcrmAutoSyncIsEnabled()
      if (!isEnabled) {
        return
      }
      await syncCvcrmTickets()
    } catch (error: unknown) {
      console.error('[CVCRM] Falha na atualização periódica:', error instanceof Error ? error.message : 'erro desconhecido')
    }
  }

  // Check short intervals so sync starts at the scheduled half-hour slots.
  const syncTimer = setInterval(() => {
    void checkAndRunSync()
  }, 30_000)
  syncTimer.unref()
}

async function shutdown() {
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)