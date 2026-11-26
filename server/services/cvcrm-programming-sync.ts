import { createHash } from 'node:crypto'
import { APP_TIMEZONE, env } from '../config.js'
import { pool } from '../db.js'
import { broadcastSyncEvent } from './sync-events.js'
import { recordTicketActivity } from './ticket-activity.js'

const SETTING_KEY = 'cvcrm_programming_comment_sync'

export interface CvcrmProgrammingSyncSettings {
  enabled: boolean
  dispatchTime: string // HH:MM (ex: "17:40")
  lastRunAt: string | null
  lastRunDate: string | null
  lastRunTrigger: 'auto' | 'manual' | null
  lastRunSuccess: boolean | null
  lastRunTicketsCount: number
  lastRunItemsCount: number
  lastRunMessage: string | null
}

const DEFAULT_SETTINGS: CvcrmProgrammingSyncSettings = {
  enabled: true,
  dispatchTime: '17:40',
  lastRunAt: null,
  lastRunDate: null,
  lastRunTrigger: null,
  lastRunSuccess: null,
  lastRunTicketsCount: 0,
  lastRunItemsCount: 0,
  lastRunMessage: null,
}

export interface ProgrammingSyncSnapshot {
  date: string
  dateLabel: string
  startTime: string
  endTime: string
  collaboratorId: string
  collaboratorName: string
  collaboratorRoleLabel: string
  activityDescription: string
  enterprise: string
  block: string
  unit: string
  commonAreaLocation: string
  isFinalization: boolean
  cancelled: boolean
  cancellationReasonType: string | null
  cancellationReason: string | null
}

interface RawProgrammingRow {
  id: string
  ticket_id: string
  protocol: string
  collaborator_id: string
  collaborator_name: string
  collaborator_role_label: string
  activity_description: string
  starts_at: Date
  ends_at: Date
  enterprise: string
  block: string
  unit: string
  common_area_location: string
  is_finalization: boolean
  cancelled: boolean
  cancellation_reason_type: string | null
  cancellation_reason: string | null
  cvcrm_synced_hash: string | null
  cvcrm_synced_snapshot: ProgrammingSyncSnapshot | null
  updated_at: Date
}

let syncInProgress = false
let baselineInitialized = false

const dateIsoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const dateBrFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function buildSnapshot(row: RawProgrammingRow): ProgrammingSyncSnapshot {
  const starts = new Date(row.starts_at)
  const ends = new Date(row.ends_at)
  return {
    date: dateIsoFormatter.format(starts),
    dateLabel: dateBrFormatter.format(starts),
    startTime: timeFormatter.format(starts),
    endTime: timeFormatter.format(ends),
    collaboratorId: String(row.collaborator_id),
    collaboratorName: row.collaborator_name.trim(),
    collaboratorRoleLabel: row.collaborator_role_label.trim(),
    activityDescription: row.activity_description.trim(),
    enterprise: (row.enterprise || '').trim(),
    block: (row.block || '').trim(),
    unit: (row.unit || '').trim(),
    commonAreaLocation: (row.common_area_location || '').trim(),
    isFinalization: Boolean(row.is_finalization),
    cancelled: Boolean(row.cancelled),
    cancellationReasonType: row.cancellation_reason_type ?? null,
    cancellationReason: row.cancellation_reason ? row.cancellation_reason.trim() : null,
  }
}

function computeSnapshotHash(snap: ProgrammingSyncSnapshot): string {
  const payload = JSON.stringify({
    date: snap.date,
    startTime: snap.startTime,
    endTime: snap.endTime,
    collaboratorId: snap.collaboratorId,
    cancelled: snap.cancelled,
    cancellationReasonType: snap.cancellationReasonType,
    cancellationReason: snap.cancellationReason,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 40)
}

function formatCollaboratorLabel(snap: { collaboratorName: string }) {
  return snap.collaboratorName
}

function isDuplicateOfRescheduledCancellation(
  newItem: PendingTicketItem,
  cancelledItems: PendingTicketItem[],
): boolean {
  const s = newItem.currentSnap
  const dateAndTimeToken = `${s.dateLabel} das ${s.startTime} às ${s.endTime}`

  for (const cItem of cancelledItems) {
    const cs = cItem.currentSnap
    const reason = cs.cancellationReason || ''

    // Verifica se o cancelamento é um reagendamento para esta exata data e horário
    if (reason.includes(dateAndTimeToken)) {
      if (!reason.includes(' com ') || reason.includes(s.collaboratorName)) {
        return true
      }
    }

    // Verifica se foi um remanejamento no mesmo dia/horário para este profissional
    if (
      cs.cancellationReasonType === 'remanejamento' &&
      cs.date === s.date &&
      cs.startTime === s.startTime &&
      cs.endTime === s.endTime &&
      reason.includes(s.collaboratorName)
    ) {
      return true
    }
  }

  return false
}

function formatCancellationTypeLabel(type: string | null): string {
  if (type === 'cliente') return 'Cancelamento por parte do cliente'
  if (type === 'reagendamento') return 'Reagendamento de dia/horário'
  if (type === 'remanejamento') return 'Remanejamento de profissional'
  if (type === 'ac_engenharia') return 'Cancelamento AC Engenharia'
  return 'Cancelamento'
}

/**
 * Inicializa o baseline das programações antigas (anteriores ao dia atual que nunca foram sincronizadas)
 * e readequa o hash daquelas já sincronizadas sem novas alterações, evitando que agendamentos
 * históricos de meses atrás sejam enviados indevidamente.
 */
async function ensureHistoricalBaseline(): Promise<void> {
  if (baselineInitialized) return
  try {
    const todayStr = dateIsoFormatter.format(new Date())

    // 1. Programações históricas não sincronizadas de datas anteriores
    const oldUnsynced = await pool.query<RawProgrammingRow>(
      `SELECT p.id, p.ticket_id::text, COALESCE(t.protocol, p.ticket_id::text) AS protocol,
              p.collaborator_id::text, c.name AS collaborator_name, r.label AS collaborator_role_label,
              p.activity_description, p.starts_at, p.ends_at,
              p.enterprise, p.block, p.unit, p.common_area_location,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.cancelled, FALSE) AS cancelled,
              p.cancellation_reason_type, p.cancellation_reason,
              p.cvcrm_synced_hash, p.cvcrm_synced_snapshot, p.updated_at
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE p.ticket_id IS NOT NULL
         AND (
           (p.cvcrm_synced_at IS NULL AND p.updated_at < ($1::date AT TIME ZONE '${APP_TIMEZONE}'))
           OR
           (p.cvcrm_synced_at IS NOT NULL AND p.updated_at <= p.cvcrm_synced_at)
         )`,
      [todayStr],
    )

    for (const row of oldUnsynced.rows) {
      const snap = buildSnapshot(row)
      const hash = computeSnapshotHash(snap)
      if (row.cvcrm_synced_hash !== hash) {
        await pool.query(
          `UPDATE ticket_programming
           SET cvcrm_synced_hash = $1,
               cvcrm_synced_snapshot = $2::jsonb
           WHERE id = $3`,
          [hash, JSON.stringify(snap), row.id],
        )
      }
    }
    baselineInitialized = true
  } catch (err) {
    console.error('[CVCRM Programming Sync] Erro ao inicializar baseline histórico:', err)
  }
}

export async function getCvcrmProgrammingSyncSettings(): Promise<
  CvcrmProgrammingSyncSettings & {
    cvcrmConfigured: boolean
    pendingTicketsCount: number
    pendingItemsCount: number
  }
> {
  await ensureHistoricalBaseline()

  let stored: Partial<CvcrmProgrammingSyncSettings> = {}
  try {
    const res = await pool.query<{ setting_value: Partial<CvcrmProgrammingSyncSettings> }>(
      `SELECT setting_value FROM application_settings WHERE setting_key = $1`,
      [SETTING_KEY],
    )
    if (res.rowCount && res.rows[0].setting_value) {
      stored = res.rows[0].setting_value
    }
  } catch {
    // ignore
  }

  const settings: CvcrmProgrammingSyncSettings = {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    dispatchTime:
      typeof stored.dispatchTime === 'string' && /^\d{2}:\d{2}$/.test(stored.dispatchTime)
        ? stored.dispatchTime
        : DEFAULT_SETTINGS.dispatchTime,
    lastRunAt: stored.lastRunAt ?? null,
    lastRunDate: stored.lastRunDate ?? null,
    lastRunTrigger: stored.lastRunTrigger ?? null,
    lastRunSuccess: typeof stored.lastRunSuccess === 'boolean' ? stored.lastRunSuccess : null,
    lastRunTicketsCount: Number(stored.lastRunTicketsCount ?? 0),
    lastRunItemsCount: Number(stored.lastRunItemsCount ?? 0),
    lastRunMessage: stored.lastRunMessage ?? null,
  }

  const pending = await collectPendingProgrammingByTicket()
  const pendingTicketsCount = pending.size
  let pendingItemsCount = 0
  for (const list of pending.values()) {
    pendingItemsCount += list.items.length
  }

  return {
    ...settings,
    cvcrmConfigured: Boolean(env.CVCRM_SUBDOMAIN && env.CVCRM_API_EMAIL && env.CVCRM_API_TOKEN),
    pendingTicketsCount,
    pendingItemsCount,
  }
}

export async function saveCvcrmProgrammingSyncSettings(
  input: { enabled?: boolean; dispatchTime?: string },
  userId?: number,
) {
  const current = await getCvcrmProgrammingSyncSettings()
  const nextEnabled = input.enabled !== undefined ? input.enabled : current.enabled
  const nextTime =
    input.dispatchTime && /^\d{2}:\d{2}$/.test(input.dispatchTime)
      ? input.dispatchTime
      : current.dispatchTime

  // Se o administrador mudou o horário de disparo, permite que o novo horário dispare ainda hoje caso seja futuro
  const nextLastRunDate = nextTime !== current.dispatchTime ? null : current.lastRunDate

  const toSave: CvcrmProgrammingSyncSettings = {
    enabled: nextEnabled,
    dispatchTime: nextTime,
    lastRunAt: current.lastRunAt,
    lastRunDate: nextLastRunDate,
    lastRunTrigger: current.lastRunTrigger,
    lastRunSuccess: current.lastRunSuccess,
    lastRunTicketsCount: current.lastRunTicketsCount,
    lastRunItemsCount: current.lastRunItemsCount,
    lastRunMessage: current.lastRunMessage,
  }

  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTING_KEY, JSON.stringify(toSave), userId ?? null],
  )

  void broadcastSyncEvent({ scope: 'settings', action: 'cvcrm_programming_sync_updated' })
  return getCvcrmProgrammingSyncSettings()
}

interface PendingTicketItem {
  row: RawProgrammingRow
  currentSnap: ProgrammingSyncSnapshot
  currentHash: string
  previousSnap: ProgrammingSyncSnapshot | null
}

async function collectPendingProgrammingByTicket(): Promise<
  Map<string, { ticketId: string; protocol: string; items: PendingTicketItem[] }>
> {
  await ensureHistoricalBaseline()

  const res = await pool.query<RawProgrammingRow>(
    `SELECT p.id::text, p.ticket_id::text, COALESCE(t.protocol, p.ticket_id::text) AS protocol,
            p.collaborator_id::text, c.name AS collaborator_name, r.label AS collaborator_role_label,
            p.activity_description, p.starts_at, p.ends_at,
            COALESCE(NULLIF(TRIM(p.enterprise), ''), t.enterprise, '') AS enterprise,
            COALESCE(NULLIF(TRIM(p.block), ''), t.block, '') AS block,
            COALESCE(NULLIF(TRIM(p.unit), ''), t.unit, '') AS unit,
            p.common_area_location,
            COALESCE(p.is_finalization, FALSE) AS is_finalization,
            COALESCE(p.cancelled, FALSE) AS cancelled,
            p.cancellation_reason_type, p.cancellation_reason,
            p.cvcrm_synced_hash, p.cvcrm_synced_snapshot, p.updated_at
     FROM ticket_programming p
     LEFT JOIN tickets t ON t.source_id = p.ticket_id
     JOIN collaborators c ON c.id = p.collaborator_id
     JOIN collaborator_roles r ON r.role_key = c.role
     WHERE p.ticket_id IS NOT NULL
     ORDER BY p.starts_at ASC, c.name ASC, p.id ASC`,
  )

  const byTicket = new Map<string, { ticketId: string; protocol: string; items: PendingTicketItem[] }>()

  for (const row of res.rows) {
    const currentSnap = buildSnapshot(row)
    const currentHash = computeSnapshotHash(currentSnap)

    if (row.cvcrm_synced_hash === currentHash) {
      continue
    }

    if (!byTicket.has(row.ticket_id)) {
      byTicket.set(row.ticket_id, {
        ticketId: row.ticket_id,
        protocol: row.protocol,
        items: [],
      })
    }

    byTicket.get(row.ticket_id)!.items.push({
      row,
      currentSnap,
      currentHash,
      previousSnap: row.cvcrm_synced_snapshot ?? null,
    })
  }

  return byTicket
}

/**
 * Monta o comentário interno consolidado de um chamado, de forma simples e direta:
 * - Apenas dia, horário e colaborador previsto (sem função, sem serviço a realizar e sem local).
 * - Quando há um cancelamento por reagendamento/remanejamento, exibe apenas o cancelamento e o reagendamento,
 *   omitindo a programação reagendada da lista de "Novas programações".
 */
export function buildConsolidatedTicketComment(
  protocol: string,
  items: PendingTicketItem[],
): string {
  const rawNewItems: PendingTicketItem[] = []
  const updatedItems: PendingTicketItem[] = []
  const cancelledItems: PendingTicketItem[] = []

  for (const item of items) {
    if (item.currentSnap.cancelled) {
      cancelledItems.push(item)
    } else if (!item.previousSnap) {
      rawNewItems.push(item)
    } else {
      updatedItems.push(item)
    }
  }

  // Filtra das novas programações aquelas que já estão descritas em um cancelamento por reagendamento/remanejamento
  const newItems = rawNewItems.filter(
    (item) => !isDuplicateOfRescheduledCancellation(item, cancelledItems),
  )

  const sections: string[] = []
  sections.push(`[ATech · Atualização Interna de Programação — Protocolo #${protocol}]`)

  // 1. NOVAS PROGRAMAÇÕES AGENDADAS
  if (newItems.length > 0) {
    const slotsMap = new Map<
      string,
      {
        date: string
        dateLabel: string
        startTime: string
        endTime: string
        collaborators: string[]
      }
    >()

    for (const item of newItems) {
      const s = item.currentSnap
      const slotKey = `${s.date}||${s.startTime}||${s.endTime}`
      if (!slotsMap.has(slotKey)) {
        slotsMap.set(slotKey, {
          date: s.date,
          dateLabel: s.dateLabel,
          startTime: s.startTime,
          endTime: s.endTime,
          collaborators: [],
        })
      }

      const collabLabel = formatCollaboratorLabel(s)
      const slot = slotsMap.get(slotKey)!
      if (!slot.collaborators.includes(collabLabel)) {
        slot.collaborators.push(collabLabel)
      }
    }

    const lines: string[] = []
    lines.push('PROGRAMAÇÕES AGENDADAS:')

    // Agrupa dias (mesmo não seguidos) quando o(s) mesmo(s) colaborador(es) está(ão) escalado(s) no mesmo horário
    const teamTimeGroups = new Map<
      string,
      {
        startTime: string
        endTime: string
        collaboratorsLabel: string
        dateLabels: string[]
      }
    >()

    const sortedSlots = [...slotsMap.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    )

    for (const slot of sortedSlots) {
      const collaboratorsLabel = slot.collaborators.join(', ')
      const teamTimeKey = `${slot.startTime}||${slot.endTime}||${collaboratorsLabel}`
      if (!teamTimeGroups.has(teamTimeKey)) {
        teamTimeGroups.set(teamTimeKey, {
          startTime: slot.startTime,
          endTime: slot.endTime,
          collaboratorsLabel,
          dateLabels: [],
        })
      }
      const tGroup = teamTimeGroups.get(teamTimeKey)!
      if (!tGroup.dateLabels.includes(slot.dateLabel)) {
        tGroup.dateLabels.push(slot.dateLabel)
      }
    }

    for (const tGroup of teamTimeGroups.values()) {
      lines.push(
        `• ${tGroup.dateLabels.join(', ')} das ${tGroup.startTime} às ${tGroup.endTime} — ${tGroup.collaboratorsLabel}`,
      )
    }

    sections.push(lines.join('\n'))
  }

  // 2. ATUALIZAÇÕES EM PROGRAMAÇÕES EXISTENTES
  if (updatedItems.length > 0) {
    const updateGroups = new Map<
      string,
      {
        origDateLabel: string
        origStartTime: string
        origEndTime: string
        collaborators: string[]
        changes: string[]
      }
    >()

    for (const item of updatedItems) {
      const prev = item.previousSnap!
      const curr = item.currentSnap
      const changes: string[] = []

      if (prev.cancelled && !curr.cancelled) {
        changes.push(
          `Reativada para ${curr.dateLabel} das ${curr.startTime} às ${curr.endTime}`,
        )
      }

      if (
        prev.date !== curr.date ||
        prev.startTime !== curr.startTime ||
        prev.endTime !== curr.endTime
      ) {
        if (prev.date !== curr.date && (prev.startTime !== curr.startTime || prev.endTime !== curr.endTime)) {
          changes.push(
            `Alterado para ${curr.dateLabel} das ${curr.startTime} às ${curr.endTime}`,
          )
        } else if (prev.date !== curr.date) {
          changes.push(
            `Data alterada para ${curr.dateLabel} (${curr.startTime} às ${curr.endTime})`,
          )
        } else {
          changes.push(
            `Horário alterado para ${curr.startTime} às ${curr.endTime}`,
          )
        }
      }

      if (prev.collaboratorId !== curr.collaboratorId) {
        changes.push(
          `Colaborador alterado de ${formatCollaboratorLabel(prev)} para ${formatCollaboratorLabel(curr)}`,
        )
      }

      if (changes.length === 0) {
        continue
      }

      // Agrupa colaboradores que estavam na mesma programação (mesmo dia e mesmo horário) e sofreram o mesmo ajuste
      const groupKey = `${prev.date}||${prev.startTime}||${prev.endTime}||${changes.join(';;')}`
      if (!updateGroups.has(groupKey)) {
        updateGroups.set(groupKey, {
          origDateLabel: prev.dateLabel,
          origStartTime: prev.startTime,
          origEndTime: prev.endTime,
          collaborators: [],
          changes,
        })
      }

      const uGroup = updateGroups.get(groupKey)!
      const collabLabel = formatCollaboratorLabel(curr)
      if (!uGroup.collaborators.includes(collabLabel)) {
        uGroup.collaborators.push(collabLabel)
      }
    }

    if (updateGroups.size > 0) {
      const lines: string[] = []
      lines.push('AJUSTES DE PROGRAMAÇÃO:')
      for (const uGroup of updateGroups.values()) {
        lines.push(
          `• ${uGroup.origDateLabel} das ${uGroup.origStartTime} às ${uGroup.origEndTime} — ${uGroup.collaborators.join(', ')}: ${uGroup.changes.join(' | ')}`,
        )
      }
      sections.push(lines.join('\n'))
    }
  }

  // 3. CANCELAMENTOS / REAGENDAMENTOS / REMANEJAMENTOS
  if (cancelledItems.length > 0) {
    const cancelGroups = new Map<
      string,
      {
        date: string
        dateLabel: string
        startTime: string
        endTime: string
        reasonType: string | null
        reasonTypeLabel: string
        reasonText: string
        collaborators: string[]
      }
    >()

    for (const item of cancelledItems) {
      const s = item.currentSnap
      const reasonTypeLabel = formatCancellationTypeLabel(s.cancellationReasonType)
      const reasonText = s.cancellationReason || reasonTypeLabel
      const groupKey = `${s.date}||${s.startTime}||${s.endTime}||${reasonTypeLabel}||${reasonText}`

      if (!cancelGroups.has(groupKey)) {
        cancelGroups.set(groupKey, {
          date: s.date,
          dateLabel: s.dateLabel,
          startTime: s.startTime,
          endTime: s.endTime,
          reasonType: s.cancellationReasonType,
          reasonTypeLabel,
          reasonText,
          collaborators: [],
        })
      }

      const cGroup = cancelGroups.get(groupKey)!
      const collabLabel = formatCollaboratorLabel(s)
      if (!cGroup.collaborators.includes(collabLabel)) {
        cGroup.collaborators.push(collabLabel)
      }
    }

    const lines: string[] = []
    lines.push('CANCELAMENTOS / REAGENDAMENTOS:')
    const sortedCancels = [...cancelGroups.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    )

    for (const cGroup of sortedCancels) {
      lines.push(
        `• Cancelado: ${cGroup.dateLabel} das ${cGroup.startTime} às ${cGroup.endTime} — ${cGroup.collaborators.join(', ')}`,
      )
      if (
        cGroup.reasonType === 'reagendamento' ||
        cGroup.reasonType === 'remanejamento' ||
        cGroup.reasonText.toLowerCase().includes('reagendado') ||
        cGroup.reasonText.toLowerCase().includes('remanejado')
      ) {
        lines.push(`  ↳ ${cGroup.reasonText}`)
      } else {
        const detail =
          cGroup.reasonText && cGroup.reasonText !== cGroup.reasonTypeLabel
            ? `${cGroup.reasonTypeLabel} (${cGroup.reasonText})`
            : cGroup.reasonTypeLabel
        lines.push(`  ↳ Motivo: ${detail}`)
      }
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}

/**
 * Envia o comentário interno para o chamado no CVCRM.
 * Tenta a rota padrão CVIO (/cvio/mensagem_atendimento) e faz fallback caso necessário,
 * sempre com as flags de mensagem estritamente interna (não visível ao cliente).
 */
async function postInternalCommentToCvcrm(
  ticketId: string,
  protocol: string,
  message: string,
): Promise<void> {
  if (!env.CVCRM_SUBDOMAIN || !env.CVCRM_API_EMAIL || !env.CVCRM_API_TOKEN) {
    throw new Error('CVCRM não configurado (defina CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env).')
  }

  const baseUrl = `https://${env.CVCRM_SUBDOMAIN}.cvcrm.com.br/api`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    email: env.CVCRM_API_EMAIL,
    token: env.CVCRM_API_TOKEN,
  }

  const payload = {
    idatendimento: Number(ticketId),
    idAtendimento: Number(ticketId),
    protocolo: protocol,
    mensagem: message,
    resposta: message,
    cliente_visualiza: false,
    exibir_mensagem_cliente: false,
    exibirMensagemCliente: false,
    enviar_email_cliente: false,
    interno: true,
    comentario_interno: true,
  }

  const candidatePaths = [
    '/cvio/mensagem_atendimento',
    `/v1/relacionamento/atendimentos/${encodeURIComponent(ticketId)}/mensagens`,
    '/v1/relacionamento/atendimentos/mensagens',
  ]

  let lastError = ''

  for (const path of candidatePaths) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })

      if (response.ok) {
        return
      }

      const text = await response.text().catch(() => '')
      lastError = `HTTP ${response.status} em ${path}${text ? `: ${text.slice(0, 220)}` : ''}`

      // Se não for 404/405, não precisa tentar rotas alternativas de fallback
      if (response.status !== 404 && response.status !== 405) {
        break
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Erro de rede ao comunicar com CVCRM'
    }
  }

  throw new Error(lastError || 'Não foi possível registrar comentário interno no CVCRM.')
}

export interface RunCvcrmProgrammingSyncResult {
  ran: boolean
  trigger: 'auto' | 'manual'
  ticketsSynced: number
  itemsSynced: number
  ticketsFailed: number
  errors: Array<{ ticketId: string; protocol: string; error: string }>
  message: string
}

export async function runCvcrmProgrammingCommentSync(
  trigger: 'auto' | 'manual',
  actorUserId?: number | null,
): Promise<RunCvcrmProgrammingSyncResult> {
  if (syncInProgress) {
    throw new Error('Já existe uma sincronização de comentários de programação com o CVCRM em andamento.')
  }

  syncInProgress = true
  const todayStr = dateIsoFormatter.format(new Date())

  try {
    const pendingByTicket = await collectPendingProgrammingByTicket()
    if (pendingByTicket.size === 0) {
      const msg = 'Nenhuma nova programação, alteração ou cancelamento pendente de envio ao CVCRM.'
      await updateLastRunMetadata({
        trigger,
        todayStr,
        success: true,
        ticketsCount: 0,
        itemsCount: 0,
        message: msg,
      })
      return {
        ran: true,
        trigger,
        ticketsSynced: 0,
        itemsSynced: 0,
        ticketsFailed: 0,
        errors: [],
        message: msg,
      }
    }

    let ticketsSynced = 0
    let itemsSynced = 0
    const errors: Array<{ ticketId: string; protocol: string; error: string }> = []

    for (const ticketGroup of pendingByTicket.values()) {
      const commentBody = buildConsolidatedTicketComment(ticketGroup.protocol, ticketGroup.items)

      try {
        await postInternalCommentToCvcrm(ticketGroup.ticketId, ticketGroup.protocol, commentBody)

        // Marca todas as programações deste chamado como sincronizadas com o snapshot atual
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          for (const item of ticketGroup.items) {
            await client.query(
              `UPDATE ticket_programming
               SET cvcrm_synced_hash = $1,
                   cvcrm_synced_snapshot = $2::jsonb,
                   cvcrm_synced_at = now()
               WHERE id = $3`,
              [item.currentHash, JSON.stringify(item.currentSnap), item.row.id],
            )
          }

          await recordTicketActivity(
            client,
            ticketGroup.ticketId,
            actorUserId ?? null,
            'cvcrm_programming_comment_synced',
            `Enviou comentário interno consolidado de programação ao CVCRM (${ticketGroup.items.length} registro(s)).`,
            {
              protocol: ticketGroup.protocol,
              trigger,
              itemsCount: ticketGroup.items.length,
              commentPreview: commentBody.slice(0, 500),
            },
          )
          await client.query('COMMIT')
        } catch (dbErr) {
          await client.query('ROLLBACK')
          throw dbErr
        } finally {
          client.release()
        }

        ticketsSynced++
        itemsSynced += ticketGroup.items.length
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Erro desconhecido'
        errors.push({
          ticketId: ticketGroup.ticketId,
          protocol: ticketGroup.protocol,
          error: errMsg,
        })
      }

      // Pausa leve de 350ms entre chamados para não sobrecarregar a API do CVCRM nem a aplicação
      if (pendingByTicket.size > 1) {
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }

    const summaryMsg =
      errors.length === 0
        ? `Sincronização concluída com sucesso: ${ticketsSynced} chamado(s) atualizado(s) no CVCRM (${itemsSynced} programação(ões)).`
        : `Sincronização parcial: ${ticketsSynced} chamado(s) enviado(s) e ${errors.length} falha(s) (${errors[0].protocol}: ${errors[0].error}).`

    await updateLastRunMetadata({
      trigger,
      todayStr,
      success: errors.length === 0,
      ticketsCount: ticketsSynced,
      itemsCount: itemsSynced,
      message: summaryMsg,
    })

    void broadcastSyncEvent({ scope: 'settings', action: 'cvcrm_programming_sync_ran' })
    void broadcastSyncEvent({ scope: 'programming', action: 'cvcrm_programming_sync_ran' })

    return {
      ran: true,
      trigger,
      ticketsSynced,
      itemsSynced,
      ticketsFailed: errors.length,
      errors,
      message: summaryMsg,
    }
  } finally {
    syncInProgress = false
  }
}

async function updateLastRunMetadata(params: {
  trigger: 'auto' | 'manual'
  todayStr: string
  success: boolean
  ticketsCount: number
  itemsCount: number
  message: string
}) {
  try {
    const current = await getCvcrmProgrammingSyncSettings()
    const next: CvcrmProgrammingSyncSettings = {
      enabled: current.enabled,
      dispatchTime: current.dispatchTime,
      lastRunAt: new Date().toISOString(),
      lastRunDate: params.trigger === 'auto' ? params.todayStr : current.lastRunDate,
      lastRunTrigger: params.trigger,
      lastRunSuccess: params.success,
      lastRunTicketsCount: params.ticketsCount,
      lastRunItemsCount: params.itemsCount,
      lastRunMessage: params.message,
    }

    await pool.query(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [SETTING_KEY, JSON.stringify(next)],
    )
  } catch (err) {
    console.error('[CVCRM Programming Sync] Erro ao salvar metadados da última execução:', err)
  }
}
