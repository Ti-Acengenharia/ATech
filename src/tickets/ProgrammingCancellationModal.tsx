import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  Clock3,
  Loader2,
  UserX,
  X,
} from 'lucide-react'
import { apiRequest } from '../api/client'
import {
  programmingDateString,
  programmingDateTimeToIso,
  programmingMinutes,
  programmingTimeString,
} from './programming-time'
import './ProgrammingCancellationModal.css'

export type CancellationReasonType = 'cliente' | 'reagendamento' | 'remanejamento' | 'ac_engenharia'

export interface ProgrammingTargetForCancellation {
  id: string
  ticket_id?: string | null
  legal_process_id?: string | null
  protocol?: string | null
  subject?: string | null
  legal_process_number?: string | null
  collaborator_id: string | number
  collaborator_name: string
  collaborator_role?: string
  activity_description: string
  starts_at: string
  ends_at: string
  enterprise?: string
  block?: string
  unit?: string
}

interface CollaboratorOption {
  id: string
  name: string
  role: string
  role_label?: string
  is_on_leave?: boolean
}

interface WorkingHoursSettings {
  monday_thursday: { start: string; end: string }
  friday: { start: string; end: string }
  work_saturday: { start: string; end: string }
}

interface CalendarEntry {
  id: string
  date: string
  description: string
  type: 'holiday' | 'work_saturday'
}

interface AvailabilityEntry {
  id: string
  ticket_id: string | null
  legal_process_id: string | null
  starts_at: string
  ends_at: string
}

interface AbsenceEntry {
  id: string
  type: 'atestado' | 'falta_injustificada'
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  cid: string | null
}

interface FreeSlot {
  startsAt: string
  endsAt: string
}

interface Props {
  appointment: ProgrammingTargetForCancellation
  onClose: () => void
  onCancelled: (rescheduledDate?: string) => void
}

function formatTime(iso: string) {
  try {
    return programmingTimeString(new Date(iso))
  } catch {
    return ''
  }
}

function formatDate(iso: string) {
  try {
    const d = programmingDateString(new Date(iso))
    return d.split('-').reverse().join('/')
  } catch {
    return ''
  }
}

function parseMin(str?: string, defaultMin = 0): number {
  if (!str) return defaultMin
  const [h, m] = str.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function formatMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function getDayWindow(
  date: string,
  workingHours?: WorkingHoursSettings,
): { windowStart: number; windowEnd: number; label: string } {
  const dt = new Date(`${date}T12:00:00Z`)
  const day = dt.getUTCDay()
  if (day === 5) {
    const start = parseMin(workingHours?.friday?.start, 8 * 60)
    const end = parseMin(workingHours?.friday?.end, 17 * 60)
    return {
      windowStart: start,
      windowEnd: end,
      label: `${workingHours?.friday?.start || '08:00'}–${workingHours?.friday?.end || '17:00'}`,
    }
  }
  if (day === 6) {
    const start = parseMin(workingHours?.work_saturday?.start, 8 * 60)
    const end = parseMin(workingHours?.work_saturday?.end, 18 * 60)
    return {
      windowStart: start,
      windowEnd: end,
      label: `${workingHours?.work_saturday?.start || '08:00'}–${workingHours?.work_saturday?.end || '18:00'}`,
    }
  }
  const start = parseMin(workingHours?.monday_thursday?.start, 8 * 60)
  const end = parseMin(workingHours?.monday_thursday?.end, 18 * 60)
  return {
    windowStart: start,
    windowEnd: end,
    label: `${workingHours?.monday_thursday?.start || '08:00'}–${workingHours?.monday_thursday?.end || '18:00'}`,
  }
}

function computeFreeSlots(
  date: string,
  appointments: AvailabilityEntry[],
  workingHours?: WorkingHoursSettings,
): FreeSlot[] {
  const { windowStart, windowEnd } = getDayWindow(date, workingHours)
  const booked = appointments
    .map((item) => ({ start: new Date(item.starts_at), end: new Date(item.ends_at) }))
    .filter(
      ({ start, end }) =>
        programmingDateString(start) === date &&
        programmingDateString(end) === date &&
        programmingMinutes(start) < windowEnd &&
        programmingMinutes(end) > windowStart,
    )
    .map(({ start, end }) => ({
      start: Math.max(windowStart, programmingMinutes(start)),
      end: Math.min(windowEnd, programmingMinutes(end)),
    }))
    .sort((a, b) => a.start - b.start)

  const slots: FreeSlot[] = []
  let cursor = windowStart
  for (const item of booked) {
    if (item.start > cursor) {
      slots.push({ startsAt: formatMinutes(cursor), endsAt: formatMinutes(item.start) })
    }
    cursor = Math.max(cursor, item.end)
  }
  if (cursor < windowEnd) {
    slots.push({ startsAt: formatMinutes(cursor), endsAt: formatMinutes(windowEnd) })
  }
  return slots
}

export default function ProgrammingCancellationModal({
  appointment,
  onClose,
  onCancelled,
}: Props) {
  const originalDate = useMemo(
    () => programmingDateString(new Date(appointment.starts_at)),
    [appointment.starts_at],
  )
  const originalStartTime = useMemo(
    () => programmingTimeString(new Date(appointment.starts_at)),
    [appointment.starts_at],
  )
  const originalEndTime = useMemo(
    () => programmingTimeString(new Date(appointment.ends_at)),
    [appointment.ends_at],
  )

  const [reasonType, setReasonType] = useState<CancellationReasonType | ''>('')
  const [reassignedToCollaboratorId, setReassignedToCollaboratorId] = useState<string>('')
  const [reasonNotes, setReasonNotes] = useState('')

  // Controles de reagendamento
  const [enableReschedule, setEnableReschedule] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState(originalDate)
  const [rescheduleStartTime, setRescheduleStartTime] = useState(originalStartTime)
  const [rescheduleEndTime, setRescheduleEndTime] = useState(originalEndTime)
  const [rescheduleCollaboratorId, setRescheduleCollaboratorId] = useState<string>(
    String(appointment.collaborator_id),
  )

  const [collaborators, setCollaborators] = useState<CollaboratorOption[]>([])
  const [loadingCollabs, setLoadingCollabs] = useState(false)
  const [calendarData, setCalendarData] = useState<{
    holidays: CalendarEntry[]
    workSaturdays: CalendarEntry[]
    workingHours: WorkingHoursSettings
  } | null>(null)
  const [availability, setAvailability] = useState<{
    loading: boolean
    appointments: AvailabilityEntry[]
    absences: AbsenceEntry[]
  }>({ loading: false, appointments: [], absences: [] })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isReschedulingActive = reasonType === 'reagendamento' || enableReschedule

  const activeTargetCollaboratorId = useMemo(() => {
    if (reasonType === 'remanejamento') {
      return reassignedToCollaboratorId
    }
    if (isReschedulingActive) {
      return rescheduleCollaboratorId || String(appointment.collaborator_id)
    }
    return String(appointment.collaborator_id)
  }, [reasonType, reassignedToCollaboratorId, isReschedulingActive, rescheduleCollaboratorId, appointment.collaborator_id])

  // Bloqueia rolagem do body enquanto o modal estiver aberto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Carrega lista de colaboradores e calendário de expediente/feriados/sábados
  useEffect(() => {
    let cancelled = false
    setLoadingCollabs(true)
    Promise.all([
      apiRequest<{ collaborators: CollaboratorOption[] }>('/api/programming/collaborators'),
      apiRequest<{
        holidays: CalendarEntry[]
        workSaturdays: CalendarEntry[]
        workingHours: WorkingHoursSettings
      }>('/api/calendar').catch(() => null),
    ])
      .then(([collabData, calData]) => {
        if (!cancelled) {
          setCollaborators(collabData.collaborators ?? [])
          if (calData) setCalendarData(calData)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Erro ao carregar dados para cancelamento/reagendamento:', err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCollabs(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Consulta disponibilidade do colaborador alvo na data de reagendamento (excluindo o próprio agendamento que será cancelado)
  useEffect(() => {
    if (!isReschedulingActive && reasonType !== 'remanejamento') return
    if (!activeTargetCollaboratorId || !rescheduleDate) return

    let cancelled = false
    setAvailability((prev) => ({ ...prev, loading: true }))

    const params = new URLSearchParams({
      collaboratorId: activeTargetCollaboratorId,
      startDate: rescheduleDate,
      endDate: rescheduleDate,
      excludeId: String(appointment.id),
    })

    apiRequest<{
      appointments: AvailabilityEntry[]
      absences?: AbsenceEntry[]
    }>(`/api/programming/availability?${params}`)
      .then((res) => {
        if (!cancelled) {
          setAvailability({
            loading: false,
            appointments: res.appointments ?? [],
            absences: res.absences ?? [],
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({ loading: false, appointments: [], absences: [] })
        }
      })

    return () => {
      cancelled = true
    }
  }, [isReschedulingActive, reasonType, activeTargetCollaboratorId, rescheduleDate, appointment.id])

  // Tecla Escape para fechar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const holidayMap = useMemo(
    () => new Map(calendarData?.holidays.map((h) => [h.date, h]) ?? []),
    [calendarData],
  )
  const workSaturdayMap = useMemo(
    () => new Map(calendarData?.workSaturdays.map((s) => [s.date, s]) ?? []),
    [calendarData],
  )

  // Validação do dia escolhido no calendário
  const calendarDayWarning = useMemo(() => {
    if (!rescheduleDate) return 'Selecione uma data válida.'
    const dt = new Date(`${rescheduleDate}T12:00:00Z`)
    if (Number.isNaN(dt.valueOf())) return 'Data inválida.'
    const dayOfWeek = dt.getUTCDay()
    const holiday = holidayMap.get(rescheduleDate)
    if (holiday) {
      return `A data ${rescheduleDate.split('-').reverse().join('/')} é feriado (${holiday.description}).`
    }
    if (dayOfWeek === 0) {
      return 'Domingos não possuem expediente da assistência técnica.'
    }
    if (dayOfWeek === 6 && !workSaturdayMap.has(rescheduleDate)) {
      return 'Sábado sem compensação cadastrada. Selecione um dia útil ou sábado de compensação.'
    }
    return null
  }, [rescheduleDate, holidayMap, workSaturdayMap])

  const workSaturdayInfo = useMemo(() => {
    if (!rescheduleDate) return null
    const dt = new Date(`${rescheduleDate}T12:00:00Z`)
    if (dt.getUTCDay() === 6 && workSaturdayMap.has(rescheduleDate)) {
      return workSaturdayMap.get(rescheduleDate) ?? null
    }
    return null
  }, [rescheduleDate, workSaturdayMap])

  // Horários ocupados no dia escolhido (outros agendamentos ativos do colaborador)
  const bookedIntervalsOnDate = useMemo(() => {
    return availability.appointments
      .filter((item) => !String(item.id).startsWith('absence-'))
      .map((item) => {
        const s = new Date(item.starts_at)
        const e = new Date(item.ends_at)
        return {
          id: item.id,
          startStr: programmingTimeString(s),
          endStr: programmingTimeString(e),
          startMin: programmingMinutes(s),
          endMin: programmingMinutes(e),
        }
      })
      .sort((a, b) => a.startMin - b.startMin)
  }, [availability.appointments])

  // Janelas livres sugeridas no dia escolhido
  const freeSlots = useMemo(() => {
    if (!rescheduleDate || calendarDayWarning) return []
    return computeFreeSlots(rescheduleDate, availability.appointments, calendarData?.workingHours)
  }, [rescheduleDate, calendarDayWarning, availability.appointments, calendarData?.workingHours])

  // Verifica se o novo horário escolhido conflita com agendamentos preexistentes ou expediente
  const rescheduleTimeConflict = useMemo(() => {
    if (!isReschedulingActive) return null
    if (calendarDayWarning) return calendarDayWarning
    if (!rescheduleStartTime || !rescheduleEndTime) return 'Informe o horário inicial e final.'
    const sMin = parseMin(rescheduleStartTime)
    const eMin = parseMin(rescheduleEndTime)
    if (eMin <= sMin) return 'O horário final deve ser posterior ao horário inicial.'

    const { windowStart, windowEnd, label } = getDayWindow(rescheduleDate, calendarData?.workingHours)
    if (sMin < windowStart || eMin > windowEnd) {
      return `Horário fora do expediente deste dia (${label}).`
    }

    if (
      String(activeTargetCollaboratorId) === String(appointment.collaborator_id) &&
      rescheduleDate === originalDate &&
      rescheduleStartTime === originalStartTime &&
      rescheduleEndTime === originalEndTime
    ) {
      return 'Escolha um novo horário ou uma nova data diferente do agendamento original.'
    }

    for (const booked of bookedIntervalsOnDate) {
      if (sMin < booked.endMin && eMin > booked.startMin) {
        return `Conflito com agendamento preexistente das ${booked.startStr} às ${booked.endStr}.`
      }
    }

    for (const abs of availability.absences) {
      if (abs.startTime && abs.endTime) {
        const absStart = parseMin(abs.startTime)
        const absEnd = parseMin(abs.endTime)
        if (sMin < absEnd && eMin > absStart) {
          return `Colaborador possui ${abs.type === 'atestado' ? 'atestado' : 'ausência'} das ${abs.startTime} às ${abs.endTime}.`
        }
      } else {
        return `Colaborador possui ${abs.type === 'atestado' ? 'atestado médico' : 'falta registrada'} neste dia.`
      }
    }

    return null
  }, [
    isReschedulingActive,
    calendarDayWarning,
    rescheduleStartTime,
    rescheduleEndTime,
    rescheduleDate,
    calendarData?.workingHours,
    activeTargetCollaboratorId,
    appointment.collaborator_id,
    originalDate,
    originalStartTime,
    originalEndTime,
    bookedIntervalsOnDate,
    availability.absences,
  ])

  // Colaboradores ativos (para remanejamento exclui o atual; para reagendamento permite manter o atual ou trocar)
  const availableCollaboratorsForReassign = collaborators.filter(
    (c) => String(c.id) !== String(appointment.collaborator_id) && !c.is_on_leave,
  )
  const allActiveCollaborators = collaborators.filter(
    (c) => !c.is_on_leave || String(c.id) === String(appointment.collaborator_id),
  )

  const baseReasonValid =
    reasonType === 'cliente' ||
    reasonType === 'reagendamento' ||
    (reasonType === 'remanejamento' && Boolean(reassignedToCollaboratorId)) ||
    (reasonType === 'ac_engenharia' && reasonNotes.trim().length >= 2)

  const isFormValid =
    baseReasonValid && (!isReschedulingActive || !rescheduleTimeConflict)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reasonType || !isFormValid || submitting) return

    setSubmitting(true)
    setError('')

    try {
      const reschedulePayload = isReschedulingActive
        ? {
            date: rescheduleDate,
            startsAt: programmingDateTimeToIso(rescheduleDate, rescheduleStartTime),
            endsAt: programmingDateTimeToIso(rescheduleDate, rescheduleEndTime),
            collaboratorId:
              reasonType === 'remanejamento'
                ? Number(reassignedToCollaboratorId)
                : Number(rescheduleCollaboratorId || appointment.collaborator_id),
          }
        : undefined

      await apiRequest(`/api/programming/${appointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reasonType,
          reassignedToCollaboratorId:
            reasonType === 'remanejamento' ? Number(reassignedToCollaboratorId) : undefined,
          reasonNotes: reasonNotes.trim() || undefined,
          reschedule: reschedulePayload,
        }),
      })

      onCancelled(isReschedulingActive ? rescheduleDate : undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar o cancelamento/reagendamento.')
    } finally {
      setSubmitting(false)
    }
  }

  function renderRescheduleFields(allowCollaboratorChange: boolean) {
    const targetCollabName =
      collaborators.find((c) => String(c.id) === String(activeTargetCollaboratorId))?.name ||
      appointment.collaborator_name

    return (
      <div className="drilldown-reschedule-box" onClick={(e) => e.stopPropagation()}>
        <div className="drilldown-reschedule-header">
          <CalendarClock size={15} />
          <strong>Dados da Nova Programação (Reagendamento)</strong>
        </div>
        <p className="drilldown-reschedule-hint">
          A programação original ({formatDate(appointment.starts_at)} · {originalStartTime}–{originalEndTime})
          ficará registrada como <strong>Cancelada</strong> no histórico, liberando a vaga, e uma nova
          programação com todas as especificações (descrição, local, kits e vínculos) será criada no
          novo horário.
        </p>

        {allowCollaboratorChange && (
          <label className="drilldown-field">
            <span>Profissional para o novo agendamento:</span>
            <select
              value={rescheduleCollaboratorId}
              onChange={(e) => setRescheduleCollaboratorId(e.target.value)}
              className="drilldown-select"
            >
              {allActiveCollaborators.map((collab) => (
                <option key={collab.id} value={collab.id}>
                  {collab.name} ({collab.role_label || collab.role})
                  {String(collab.id) === String(appointment.collaborator_id) ? ' — Profissional atual' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="drilldown-reschedule-grid">
          <label className="drilldown-field">
            <span>
              <CalendarDays size={12} /> Nova data <strong className="text-danger">*</strong>
            </span>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              required
            />
          </label>

          <label className="drilldown-field">
            <span>
              <Clock3 size={12} /> Novo início <strong className="text-danger">*</strong>
            </span>
            <input
              type="time"
              value={rescheduleStartTime}
              onChange={(e) => setRescheduleStartTime(e.target.value)}
              required
            />
          </label>

          <label className="drilldown-field">
            <span>
              <Clock3 size={12} /> Novo término <strong className="text-danger">*</strong>
            </span>
            <input
              type="time"
              value={rescheduleEndTime}
              onChange={(e) => setRescheduleEndTime(e.target.value)}
              required
            />
          </label>
        </div>

        {workSaturdayInfo && (
          <div className="drilldown-availability-banner is-success">
            <Check size={13} />
            <span>
              Sábado de compensação liberado: <strong>{workSaturdayInfo.description}</strong>
            </span>
          </div>
        )}

        {/* Painel de disponibilidade e prevenção de conflitos */}
        <div className="drilldown-availability-panel">
          <div className="drilldown-availability-top">
            <span>
              Disponibilidade de <strong>{targetCollabName}</strong> em{' '}
              <strong>{rescheduleDate ? rescheduleDate.split('-').reverse().join('/') : '—'}</strong>:
            </span>
            {availability.loading && (
              <span className="drilldown-avail-loading">
                <Loader2 size={12} className="animate-spin" /> Consultando agenda...
              </span>
            )}
          </div>

          {bookedIntervalsOnDate.length > 0 && (
            <div className="drilldown-booked-list">
              <span className="drilldown-booked-label">Horários já ocupados neste dia:</span>
              <div className="drilldown-booked-chips">
                {bookedIntervalsOnDate.map((b) => (
                  <span key={b.id} className="drilldown-booked-chip">
                    Ocupado: {b.startStr}–{b.endStr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!availability.loading && !calendarDayWarning && (
            <div className="drilldown-free-slots-wrap">
              <span className="drilldown-free-label">
                Janelas livres (clique para preencher o horário):
              </span>
              {freeSlots.length > 0 ? (
                <div className="drilldown-free-slots">
                  {freeSlots.map((slot) => {
                    const isActiveSlot =
                      rescheduleStartTime === slot.startsAt && rescheduleEndTime === slot.endsAt
                    return (
                      <button
                        key={`${slot.startsAt}-${slot.endsAt}`}
                        type="button"
                        className={`drilldown-slot-btn ${isActiveSlot ? 'is-active' : ''}`}
                        onClick={() => {
                          setRescheduleStartTime(slot.startsAt)
                          setRescheduleEndTime(slot.endsAt)
                        }}
                      >
                        {slot.startsAt}–{slot.endsAt}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <span className="drilldown-no-slots">
                  Nenhum horário livre disponível nesta data para este colaborador.
                </span>
              )}
            </div>
          )}

          {rescheduleTimeConflict ? (
            <div className="drilldown-conflict-alert" role="alert">
              <AlertTriangle size={14} />
              <span>{rescheduleTimeConflict}</span>
            </div>
          ) : (
            !availability.loading && (
              <div className="drilldown-conflict-ok">
                <Check size={14} />
                <span>
                  Horário {rescheduleStartTime}–{rescheduleEndTime} disponível e sem conflitos de
                  agenda.
                </span>
              </div>
            )
          )}
        </div>
      </div>
    )
  }

  const titleContext = appointment.protocol
    ? `Protocolo #${appointment.protocol}${appointment.subject ? ` · ${appointment.subject}` : ''}`
    : appointment.legal_process_number
      ? `Processo Jurídico ${appointment.legal_process_number}`
      : 'Atividade avulsa'

  const content = (
    <div
      className="programming-cancel-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="programming-cancel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
      >
        <header className="programming-cancel-header">
          <div className="programming-cancel-title-wrap">
            <span className="programming-cancel-eyebrow">CANCELAMENTO & REAGENDAMENTO</span>
            <h2 id="cancel-modal-title">Cancelar ou Reagendar Atividade</h2>
            <div className="programming-cancel-meta-info">
              <span className="cancel-meta-pill is-time">
                <Clock3 size={12} />
                {formatDate(appointment.starts_at)} das {formatTime(appointment.starts_at)} às{' '}
                {formatTime(appointment.ends_at)}
              </span>
              <span className="cancel-meta-pill is-person">
                Colaborador: <strong>{appointment.collaborator_name}</strong>
              </span>
            </div>
            <p className="programming-cancel-sub">{titleContext}</p>
          </div>
          <button
            type="button"
            className="programming-cancel-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="programming-cancel-body">
          <p className="programming-cancel-instruction">
            Selecione a ação ou motivo do cancelamento:
          </p>

          <div className="programming-drilldown-options">
            {/* Opção 1: Reagendamento de dia ou horário */}
            <div
              className={`programming-drilldown-card ${reasonType === 'reagendamento' ? 'is-selected is-reschedule-card' : ''}`}
              onClick={() => {
                setReasonType('reagendamento')
                setEnableReschedule(true)
                setError('')
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'reagendamento' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <CalendarClock size={16} className="drilldown-icon is-reschedule" />
                    <strong>Reagendar para outro dia ou outro horário do mesmo dia</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    Mantém a programação atual como cancelada para histórico (liberando o horário antigo)
                    e cria automaticamente a nova programação no dia e horário escolhidos com todas as
                    especificações da atividade.
                  </p>
                </div>
              </div>

              {reasonType === 'reagendamento' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  {renderRescheduleFields(true)}

                  <label className="drilldown-field">
                    <span>Motivo ou observações do reagendamento (opcional):</span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Ex: Reagendado para o turno da tarde a pedido do morador / ajuste de cronograma..."
                      rows={2}
                      maxLength={500}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Opção 2: Cancelamento por parte do cliente */}
            <div
              className={`programming-drilldown-card ${reasonType === 'cliente' ? 'is-selected' : ''}`}
              onClick={() => {
                if (reasonType !== 'cliente') {
                  setReasonType('cliente')
                  setEnableReschedule(false)
                  setError('')
                }
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'cliente' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <UserX size={16} className="drilldown-icon is-client" />
                    <strong>Cancelamento por parte do cliente</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    O cliente cancelou, desmarcou ou não teve disponibilidade na data e horário.
                  </p>
                </div>
              </div>

              {reasonType === 'cliente' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>Observações do cliente (opcional):</span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Ex: Cliente informou que precisará viajar nesta data..."
                      rows={2}
                      maxLength={500}
                    />
                  </label>

                  <label className="drilldown-reschedule-toggle">
                    <input
                      type="checkbox"
                      checked={enableReschedule}
                      onChange={(e) => setEnableReschedule(e.target.checked)}
                    />
                    <span>Já reagendar esta atividade para um novo dia ou horário</span>
                  </label>

                  {enableReschedule && renderRescheduleFields(true)}
                </div>
              )}
            </div>

            {/* Opção 3: Remanejamento para outro profissional */}
            <div
              className={`programming-drilldown-card ${reasonType === 'remanejamento' ? 'is-selected' : ''}`}
              onClick={() => {
                if (reasonType !== 'remanejamento') {
                  setReasonType('remanejamento')
                  setEnableReschedule(false)
                  setError('')
                }
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'remanejamento' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <ArrowRightLeft size={16} className="drilldown-icon is-reassign" />
                    <strong>Remanejamento da atividade para outro profissional</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    A atividade permanecerá no histórico como cancelada por remanejamento e uma nova
                    atividade será criada para o novo profissional selecionado.
                  </p>
                </div>
              </div>

              {reasonType === 'remanejamento' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>
                      Selecionar profissional que receberá a atividade{' '}
                      <strong className="text-danger">*</strong>:
                    </span>
                    {loadingCollabs ? (
                      <div className="drilldown-loading">
                        <Loader2 size={16} className="animate-spin" />
                        <span>Carregando profissionais disponíveis...</span>
                      </div>
                    ) : (
                      <select
                        value={reassignedToCollaboratorId}
                        onChange={(e) => setReassignedToCollaboratorId(e.target.value)}
                        required
                        className="drilldown-select"
                      >
                        <option value="">-- Selecione o novo profissional --</option>
                        {availableCollaboratorsForReassign.map((collab) => (
                          <option key={collab.id} value={collab.id}>
                            {collab.name} ({collab.role_label || collab.role})
                          </option>
                        ))}
                      </select>
                    )}
                  </label>

                  <label className="drilldown-field">
                    <span>Observações do remanejamento (opcional):</span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Ex: Transferido devido a redirecionamento de equipe para outro condomínio..."
                      rows={2}
                      maxLength={500}
                    />
                  </label>

                  <label className="drilldown-reschedule-toggle">
                    <input
                      type="checkbox"
                      checked={enableReschedule}
                      onChange={(e) => setEnableReschedule(e.target.checked)}
                    />
                    <span>Alterar também o dia ou horário para o novo profissional</span>
                  </label>

                  {enableReschedule ? (
                    renderRescheduleFields(false)
                  ) : (
                    <div className="drilldown-notice">
                      <AlertTriangle size={14} />
                      <span>
                        O sistema verificará se o novo profissional possui disponibilidade neste mesmo
                        horário ({formatDate(appointment.starts_at)} · {originalStartTime}–{originalEndTime}).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Opção 4: Cancelamento da AC Engenharia */}
            <div
              className={`programming-drilldown-card ${reasonType === 'ac_engenharia' ? 'is-selected' : ''}`}
              onClick={() => {
                if (reasonType !== 'ac_engenharia') {
                  setReasonType('ac_engenharia')
                  setEnableReschedule(false)
                  setError('')
                }
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'ac_engenharia' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <Building2 size={16} className="drilldown-icon is-ac" />
                    <strong>Cancelamento da AC Engenharia</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    Cancelamento por motivos internos da equipe técnica ou construtora (requer
                    especificação do motivo).
                  </p>
                </div>
              </div>

              {reasonType === 'ac_engenharia' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>
                      Motivo do cancelamento <strong className="text-danger">*</strong>:
                    </span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Descreva obrigatoriamente o motivo (ex: Chuva forte impedindo serviço na fachada, falta de insumo na obra, atraso no fornecedor...)"
                      rows={2}
                      maxLength={600}
                      required
                    />
                  </label>

                  <label className="drilldown-reschedule-toggle">
                    <input
                      type="checkbox"
                      checked={enableReschedule}
                      onChange={(e) => setEnableReschedule(e.target.checked)}
                    />
                    <span>Já reagendar esta atividade para um novo dia ou horário</span>
                  </label>

                  {enableReschedule && renderRescheduleFields(true)}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="programming-cancel-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <footer className="programming-cancel-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={submitting}
            >
              Voltar
            </button>
            <button
              type="submit"
              className={`danger-button programming-cancel-confirm-btn ${isReschedulingActive ? 'is-reschedule-submit' : ''}`}
              disabled={!isFormValid || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Processando...</span>
                </>
              ) : isReschedulingActive ? (
                <>
                  <CalendarClock size={15} />
                  <span>Confirmar Cancelamento e Reagendar</span>
                </>
              ) : (
                <>
                  <X size={15} />
                  <span>Confirmar Cancelamento</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body)
  }

  return content
}
