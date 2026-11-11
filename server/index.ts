import express from 'express'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import helmet from 'helmet'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { APP_TIMEZONE, env } from './config.js'
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
import inventoryRoutes from './routes/inventory.js'
import homeRoutes from './routes/home.js'
import syncRoutes from './routes/sync.js'
import settingsRoutes from './routes/settings.js'
import calendarRoutes from './routes/calendar.js'
import stockUnitsRoutes from './routes/stock-units.js'
import { cvcrmAutoSyncIsEnabled, cvcrmIsConfigured, syncCvcrmTickets } from './services/cvcrm.js'
import { getWhatsAppSettings, sendWhatsAppPdfDocument } from './services/evolution-api.js'
import { fetchDailyProgrammingData, generateSchedulePdf } from './services/schedule-pdf.js'
import { syncStockUnitsFromCvcrm } from './services/stock-units.js'
import { initPostgresSyncListener } from './services/sync-events.js'
import { getNextWorkingDay } from './services/working-days.js'

const app = express()
const PgSession = connectPgSimple(session)

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception capturada:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection capturada:', reason)
})

const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15, // 1.1: Prunar sessões expiradas a cada 15 minutos em vez de a cada 60s
})

sessionStore.on('error', (err) => {
  console.error('[Session Store] Erro na sessão PostgreSQL:', err instanceof Error ? err.message : err)
})

app.set('trust proxy', 1)
app.disable('x-powered-by')

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      res.redirect(301, `https://${req.headers.host ?? 'localhost'}${req.url}`)
      return
    }
    next()
  })
}

app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }))
app.use(express.json({ limit: '8mb' }))
app.use(
  session({
    name: 'atech.sid',
    store: sessionStore,
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

const resolveClientIp = (req: express.Request) =>
  ipKeyGenerator(req.ip || req.socket.remoteAddress || '127.0.0.1')

const resolveClientKey = (req: express.Request) => {
  const user = req.session?.user
  if (user?.id) {
    return `user_${user.id}`
  }
  return resolveClientIp(req)
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: resolveClientIp,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
})

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: resolveClientIp,
  message: { error: 'Muitas tentativas de validação de PIN. Aguarde alguns minutos e tente novamente.' },
})

const heavyMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: resolveClientKey,
  message: { error: 'Muitas operações pesadas em sequência. Aguarde alguns minutos e tente novamente.' },
})

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: resolveClientKey,
  skip: (req) => {
    return req.path === '/sync/events' || req.path === '/health'
  },
  message: { error: 'Limite de requisições excedido. Aguarde alguns instantes e tente novamente.' },
})

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

app.use('/api', (req, res, next) => {
  if (!mutatingMethods.has(req.method.toUpperCase())) {
    next()
    return
  }
  const requestedWith = req.headers['x-requested-with']
  const secFetchSite = req.headers['sec-fetch-site']
  const originHeader = req.headers.origin ?? req.headers.referer
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host

  // 1. Requisições autenticadas com cabeçalho customizado (ATechClient) ou same-origin nativo
  if (requestedWith === 'ATechClient' || secFetchSite === 'same-origin') {
    if (typeof originHeader === 'string') {
      try {
        const originUrl = new URL(originHeader)
        const originHostname = originUrl.hostname.toLowerCase()
        const isLocal =
          originHostname === 'localhost' ||
          originHostname === '127.0.0.1' ||
          originHostname === '::1'

        if (isLocal) {
          next()
          return
        }

        if (typeof hostHeader === 'string') {
          const targetHost = String(hostHeader).split(',')[0].trim().toLowerCase()
          const targetHostname = targetHost.split(':')[0]
          if (originHostname === targetHostname || originUrl.host.toLowerCase() === targetHost) {
            next()
            return
          }
        }
      } catch {
        res.status(403).json({ error: 'Solicitação de origem não autorizada (proteção CSRF).' })
        return
      }
    } else {
      next()
      return
    }
  }

  // 2. Validação por casamento de Origin/Referer e Host
  if (typeof originHeader === 'string' && typeof hostHeader === 'string') {
    try {
      const originUrl = new URL(originHeader)
      const originHostname = originUrl.hostname.toLowerCase()
      const targetHost = String(hostHeader).split(',')[0].trim().toLowerCase()
      const targetHostname = targetHost.split(':')[0]

      const isLocal =
        (originHostname === 'localhost' || originHostname === '127.0.0.1' || originHostname === '::1') &&
        (targetHostname === 'localhost' || targetHostname === '127.0.0.1' || targetHostname === '::1')

      if (isLocal || originUrl.host.toLowerCase() === targetHost || originHostname === targetHostname) {
        next()
        return
      }
    } catch {
      // cai no 403
    }
  }

  res.status(403).json({ error: 'Solicitação de origem não autorizada (proteção CSRF).' })
})

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use('/api', apiLimiter)
app.use('/api/auth/admin/login', authLimiter)
app.use('/api/auth/google', authLimiter)
app.use('/api/profile/signature', pinLimiter)
app.use('/api/inventory/documents', pinLimiter)
app.use('/api/tickets/import-csv', heavyMutationLimiter)
app.use('/api/tickets/sync', heavyMutationLimiter)
app.use('/api/tickets/integration/import-all', heavyMutationLimiter)
app.use('/api/legal-processes/import-csv', heavyMutationLimiter)
app.use('/api/warranties/sync', heavyMutationLimiter)
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
app.use('/api/inventory', inventoryRoutes)
app.use('/api/home', homeRoutes)
app.use('/api/sync', syncRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/calendar', calendarRoutes)
app.use('/api/stock-units', stockUnitsRoutes)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint da API não encontrado.' })
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Erro na API:', error)
  res.status(500).json({ error: 'Não foi possível concluir a solicitação.' })
})

async function ensureDatabaseSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collaborator_absences (
        id BIGSERIAL PRIMARY KEY,
        collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
        type VARCHAR(30) NOT NULL CHECK (type IN ('atestado', 'falta_injustificada')),
        start_date DATE NOT NULL,
        days_count INTEGER NOT NULL CHECK (days_count >= 1),
        end_date DATE NOT NULL,
        cid VARCHAR(20),
        notes TEXT,
        created_by BIGINT NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT collaborator_absences_valid_range CHECK (end_date >= start_date)
      );
      CREATE INDEX IF NOT EXISTS collaborator_absences_collaborator_idx
        ON collaborator_absences (collaborator_id, start_date DESC);
      CREATE INDEX IF NOT EXISTS collaborator_absences_date_range_idx
        ON collaborator_absences (start_date, end_date);
      CREATE TABLE IF NOT EXISTS application_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by BIGINT REFERENCES users(id)
      );
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS login_failed_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ;
      ALTER TABLE legal_process_comment_mentions
        ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX IF NOT EXISTS legal_process_comment_mentions_user_unread_idx
        ON legal_process_comment_mentions (user_id, read_at, comment_id DESC);
      CREATE TABLE IF NOT EXISTS system_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        actor_name VARCHAR(160) NOT NULL DEFAULT '',
        action VARCHAR(80) NOT NULL,
        resource_type VARCHAR(60) NOT NULL,
        resource_id VARCHAR(120) NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS system_audit_logs_created_idx
        ON system_audit_logs (created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS system_audit_logs_resource_idx
        ON system_audit_logs (resource_type, resource_id);
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE personal_activities
        ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium';
      ALTER TABLE ticket_programming
        ADD COLUMN IF NOT EXISTS is_finalization BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS completion_term_delivered BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS personal_activity_checklists (
        id BIGSERIAL PRIMARY KEY,
        activity_id BIGINT NOT NULL REFERENCES personal_activities(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL CHECK (length(btrim(title)) > 0),
        is_done BOOLEAN NOT NULL DEFAULT FALSE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS personal_activity_checklists_activity_position_idx
        ON personal_activity_checklists (activity_id, position, id);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM application_settings WHERE setting_key = 'migration_046_letter_filling_backfilled'
        ) THEN
          INSERT INTO user_page_access (user_id, page_key, granted_by)
          SELECT user_id, 'letter-filling', granted_by
          FROM user_page_access
          WHERE page_key = 'tickets'
          ON CONFLICT (user_id, page_key) DO NOTHING;

          INSERT INTO application_settings (setting_key, setting_value, updated_at)
          VALUES ('migration_046_letter_filling_backfilled', 'true'::jsonb, now())
          ON CONFLICT (setting_key) DO NOTHING;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS tickets_opened_at_idx ON tickets (opened_at);
      CREATE INDEX IF NOT EXISTS tickets_active_opened_idx ON tickets (source_active, opened_at);
      CREATE INDEX IF NOT EXISTS ticket_activity_history_event_created_idx ON ticket_activity_history (event_type, created_at);
      CREATE INDEX IF NOT EXISTS tickets_enterprise_lower_idx ON tickets ((lower(btrim(enterprise))));
      CREATE INDEX IF NOT EXISTS tickets_block_lower_idx ON tickets ((lower(btrim(block))));
      CREATE INDEX IF NOT EXISTS tickets_unit_lower_idx ON tickets ((lower(btrim(unit))));
      CREATE INDEX IF NOT EXISTS tickets_subsubject_lower_idx ON tickets ((lower(btrim(subsubject))));
      CREATE INDEX IF NOT EXISTS tickets_source_subject_id_idx ON tickets (source_subject_id);
      CREATE INDEX IF NOT EXISTS tickets_source_status_name_idx ON tickets (source_status_name);
      CREATE INDEX IF NOT EXISTS tickets_source_modified_active_idx ON tickets (source_active, source_modified_at) WHERE NOT source_active;
    `)
  } catch (error) {
    console.error('Erro ao verificar esquema inicial do banco:', error)
  }
}
void ensureDatabaseSchema()

const server = app.listen(env.PORT, env.API_HOST, () => {
  console.log(`API ATech disponível em http://${env.API_HOST}:${env.PORT}`)
})

async function cleanupExpiredSessions() {
  try {
    const res = await pool.query("DELETE FROM user_sessions WHERE expire < now() - interval '30 days'")
    if (res.rowCount && res.rowCount > 0) {
      console.log(`[manutenção] Limpeza de sessões expiradas: ${res.rowCount} sessão(ões) removida(s).`)
    }
  } catch (err) {
    console.error('[manutenção] Falha ao limpar sessões expiradas:', err)
  }
}
void cleanupExpiredSessions()
void initPostgresSyncListener()
const cleanupTimer = setInterval(() => {
  void cleanupExpiredSessions()
}, 24 * 60 * 60 * 1000)
cleanupTimer.unref()

if (cvcrmIsConfigured()) {
  const brasiliaClock = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  let lastSyncSlot = ''
  let lastStockWeeklySyncDay = ''
  let lastWhatsappProgrammingDay = ''

  const checkAndRunSync = async () => {
    const parts = Object.fromEntries(
      brasiliaClock.formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
    const hour = Number(parts.hour)
    const minute = Number(parts.minute)
    const minuteOfDay = hour * 60 + minute
    const todayKey = `${parts.year}-${parts.month}-${parts.day}`

    // Envio automático da programação do dia útil seguinte via WhatsApp (Evolution API): diariamente às 17:00
    if (hour === 17 && minute < 5 && lastWhatsappProgrammingDay !== todayKey) {
      lastWhatsappProgrammingDay = todayKey
      try {
        const prevSetting = await pool.query<{ val: string }>(
          `SELECT setting_value #>> '{}' AS val FROM application_settings WHERE setting_key = 'whatsapp_programming_last_auto_dispatch'`,
        )
        if (prevSetting.rows[0]?.val !== todayKey) {
          await pool.query(
            `INSERT INTO application_settings (setting_key, setting_value, updated_at)
             VALUES ('whatsapp_programming_last_auto_dispatch', to_jsonb($1::text), now())
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
            [todayKey],
          )

          const wsSettings = await getWhatsAppSettings()
          if (wsSettings.autoDispatchEnabled && wsSettings.apiUrl && wsSettings.apiKey && wsSettings.instanceName) {
            const nextWorkingDay = await getNextWorkingDay(todayKey)
            console.log(`[WhatsApp] Iniciando disparo automático da programação de ${nextWorkingDay} às 17h...`)

            // 1. Programação Geral -> Grupo do WhatsApp
            if (wsSettings.programmingGroupJid) {
              try {
                const generalPdf = await generateSchedulePdf({
                  date: nextWorkingDay,
                  programmingType: 'general',
                })
                await sendWhatsAppPdfDocument({
                  target: wsSettings.programmingGroupJid,
                  pdfBuffer: generalPdf.buffer,
                  fileName: generalPdf.fileName,
                  caption: generalPdf.caption,
                })
                console.log(`[WhatsApp] Programação geral (${nextWorkingDay}) enviada com sucesso para o grupo ${wsSettings.programmingGroupJid}`)
              } catch (err: unknown) {
                console.error('[WhatsApp] Falha ao enviar programação geral para o grupo:', err instanceof Error ? err.message : err)
              }
            }

            // 2. Programação de Encarregados -> Envia individualmente para o número de cada encarregado
            try {
              const foremanData = await fetchDailyProgrammingData(nextWorkingDay, 'foreman')
              const foremenWithAppointments = foremanData.collaborators.filter((c) => c.appointments.length > 0)
              const foremenToSend = foremenWithAppointments.length > 0 ? foremenWithAppointments : foremanData.collaborators

              for (const foreman of foremenToSend) {
                const target = foreman.phone || wsSettings.foremanPhoneNumber
                const name = foreman.nickname || foreman.name
                if (!target) {
                  console.warn(`[WhatsApp] Encarregado ${name} sem telefone para disparo automático de ${nextWorkingDay}.`)
                  continue
                }

                try {
                  const foremanPdf = await generateSchedulePdf({
                    date: nextWorkingDay,
                    programmingType: 'foreman',
                    collaboratorId: foreman.id,
                    recipientName: name,
                  })
                  await sendWhatsAppPdfDocument({
                    target,
                    pdfBuffer: foremanPdf.buffer,
                    fileName: foremanPdf.fileName,
                    caption: foremanPdf.caption,
                  })
                  console.log(`[WhatsApp] Programação do encarregado ${name} (${nextWorkingDay}) enviada com sucesso para ${target}`)
                } catch (collabErr: unknown) {
                  console.error(`[WhatsApp] Falha ao enviar para o encarregado ${name}:`, collabErr instanceof Error ? collabErr.message : collabErr)
                }
              }
            } catch (err: unknown) {
              console.error('[WhatsApp] Falha ao processar programações de encarregados:', err instanceof Error ? err.message : err)
            }
          }
        }
      } catch (err: unknown) {
        lastWhatsappProgrammingDay = ''
        console.error('[WhatsApp] Erro no envio automático das 17h:', err instanceof Error ? err.message : err)
      }
    }

    // Sincronização semanal automática das unidades em estoque: toda segunda-feira às 07:00
    const dayOfWeek = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12, 0, 0)).getUTCDay()
    if (dayOfWeek === 1 && hour === 7 && lastStockWeeklySyncDay !== todayKey) {
      lastStockWeeklySyncDay = todayKey
      try {
        const prevSetting = await pool.query<{ val: string }>(
          `SELECT setting_value #>> '{}' AS val FROM application_settings WHERE setting_key = 'stock_units_last_weekly_sync'`,
        )
        if (prevSetting.rows[0]?.val !== todayKey) {
          await pool.query(
            `INSERT INTO application_settings (setting_key, setting_value, updated_at)
             VALUES ('stock_units_last_weekly_sync', to_jsonb($1::text), now())
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
            [todayKey],
          )
          const stockSyncRes = await syncStockUnitsFromCvcrm()
          console.log(`[CVCRM] Sincronização semanal de estoque (segunda-feira 07h) concluída: ${stockSyncRes.totalInStock} unidades em ${stockSyncRes.enterprisesWithStock} obras.`)
        }
      } catch (err: unknown) {
        lastStockWeeklySyncDay = ''
        console.error('[CVCRM] Falha na sincronização semanal de estoque:', err instanceof Error ? err.message : 'erro desconhecido')
      }
    }

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