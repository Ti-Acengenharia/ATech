import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CalendarDays, Check, ChevronDown, Clock3, FileSignature, Search, UsersRound, Wrench, X } from 'lucide-react'
import { apiRequest } from '../api/client'
import { useLiveSync } from '../api/liveSync'
import type { LegalProcessOption, TicketSummary } from './types'
import { getProgrammingRoleVisibility } from './programming-role-visibility'
import {
  programmingDateString,
  programmingDateTimeToIso,
  programmingMinutes,
  programmingTimeString,
} from './programming-time'

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

interface CollaboratorOption {
  id: string
  name: string
  nickname: string
  role: string
  role_label: string
  is_active: boolean
  is_on_leave: boolean
}

interface AvailabilityEntry {
  id: string
  ticket_id: string
  starts_at: string
  ends_at: string
}

interface FreeSlot {
  startsAt: string
  endsAt: string
}

interface EditingAppointment {
  id: string
  ticket_id: string | null
  legal_process_id?: string | null
  programming_type?: 'general' | 'foreman'
  collaborator_id: string
  activity_description: string
  standalone_location?: string
  enterprise: string
  block: string
  unit: string
  common_area_location: string
  materials: string[]
  equipment: string[]
  tools: string[]
  starts_at: string
  ends_at: string
  is_finalization?: boolean
  completion_term_delivered?: boolean
}

const EMPTY_APPOINTMENTS: Record<string, AvailabilityEntry[]> = {}

function formatMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function parseMin(str?: string, defaultMin: number = 0): number {
  if (!str) return defaultMin
  const [h, m] = str.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function getDayWindow(date: string, workingHours?: WorkingHoursSettings): { windowStart: number; windowEnd: number; label: string } {
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

function getFreeSlots(date: string, appointments: AvailabilityEntry[], workingHours?: WorkingHoursSettings): FreeSlot[] {
  const { windowStart, windowEnd } = getDayWindow(date, workingHours)
  const booked = appointments
    .map((appointment) => ({ start: new Date(appointment.starts_at), end: new Date(appointment.ends_at) }))
    .filter(({ start, end }) =>
      programmingDateString(start) === date &&
      programmingDateString(end) === date &&
      programmingMinutes(start) < windowEnd &&
      programmingMinutes(end) > windowStart,
    )
    .map(({ start, end }) => ({
      start: Math.max(windowStart, programmingMinutes(start)),
      end: Math.min(windowEnd, programmingMinutes(end)),
    }))
    .sort((left, right) => left.start - right.start)

  const slots: FreeSlot[] = []
  let cursor = windowStart
  for (const appointment of booked) {
    const start = Math.max(windowStart, appointment.start)
    const end = Math.min(windowEnd, appointment.end)
    if (start > cursor) {
      slots.push({ startsAt: formatMinutes(cursor), endsAt: formatMinutes(start) })
    }
    cursor = Math.max(cursor, end)
  }
  if (cursor < windowEnd) slots.push({ startsAt: formatMinutes(cursor), endsAt: formatMinutes(windowEnd) })
  return slots
}

function intersectSlots(slotGroups: FreeSlot[][]) {
  if (!slotGroups.length || slotGroups.some((slots) => slots.length === 0)) return []
  let intersections = slotGroups[0]
  for (const slots of slotGroups.slice(1)) {
    const nextIntersections: FreeSlot[] = []
    for (const intersection of intersections) {
      for (const slot of slots) {
        const start = Math.max(parseMin(intersection.startsAt), parseMin(slot.startsAt))
        const end = Math.min(parseMin(intersection.endsAt), parseMin(slot.endsAt))
        if (end > start) {
          nextIntersections.push({ startsAt: formatMinutes(start), endsAt: formatMinutes(end) })
        }
      }
    }
    intersections = nextIntersections
    if (!intersections.length) break
  }
  return intersections
}

function availableWorkDatesBetween(
  startDate: string,
  endDate: string,
  holidays: Set<string>,
  workSaturdays: Set<string>,
) {
  if (!startDate || !endDate || startDate > endDate) return []
  const dates: string[] = []
  const date = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (date <= end) {
    const iso = date.toISOString().slice(0, 10)
    const dayOfWeek = date.getUTCDay()
    if (dayOfWeek !== 0) {
      if (!holidays.has(iso)) {
        if (dayOfWeek === 6) {
          if (workSaturdays.has(iso)) {
            dates.push(iso)
          }
        } else {
          dates.push(iso)
        }
      }
    }
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return dates
}

function roleLabel(role: string, label?: string) {
  return label ?? role.replaceAll('_', ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

export default function TicketProgrammingForm({
  tickets,
  initialTicketId,
  initialLegalProcessId,
  initialLegalProcess,
  initialDate,
  programmingType = 'general',
  allowMixedCollaborators = false,
  editingAppointment,
  onSaved,
  onCancel,
}: {
  tickets: TicketSummary[]
  initialTicketId?: string
  initialLegalProcessId?: string
  initialLegalProcess?: LegalProcessOption
  initialDate?: string
  programmingType?: 'general' | 'foreman'
  allowMixedCollaborators?: boolean
  editingAppointment?: EditingAppointment
  onSaved: (savedDate?: string) => void
  onCancel?: () => void
}) {
  const isSubmittingRef = useRef(false)
  const selectedProgrammingType = editingAppointment?.programming_type ?? programmingType
  const [collaborators, setCollaborators] = useState<CollaboratorOption[]>([])
  const [hiddenRoleKeys, setHiddenRoleKeys] = useState<Set<string>>(() => new Set())
  const [roleVisibilityLoaded, setRoleVisibilityLoaded] = useState(allowMixedCollaborators)
  const [activityType, setActivityType] = useState<'ticket' | 'standalone' | 'legal_process'>(() =>
    editingAppointment?.legal_process_id || initialLegalProcessId
      ? 'legal_process'
      : editingAppointment?.ticket_id === null ? 'standalone' : 'ticket',
  )
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(() =>
    editingAppointment ? [editingAppointment.collaborator_id] : [],
  )
  const [ticketId, setTicketId] = useState(editingAppointment?.ticket_id ?? initialTicketId ?? '')
  const [ticketSearchResults, setTicketSearchResults] = useState<TicketSummary[]>([])
  const [legalProcessId, setLegalProcessId] = useState(editingAppointment?.legal_process_id ?? initialLegalProcessId ?? '')
  const [legalProcesses, setLegalProcesses] = useState<LegalProcessOption[]>(initialLegalProcess ? [initialLegalProcess] : [])
  const [legalProcessesLoading, setLegalProcessesLoading] = useState(() => Boolean(initialLegalProcessId || editingAppointment?.legal_process_id))
  const [legalProcessSearch, setLegalProcessSearch] = useState('')
  const ticketOptions = [...new Map([...tickets, ...ticketSearchResults].map((ticket) => [ticket.id, ticket])).values()]
  const initialTicket = ticketOptions.find((ticket) => ticket.id === (editingAppointment?.ticket_id ?? initialTicketId))
  const [startDate, setStartDate] = useState(() =>
    editingAppointment ? programmingDateString(new Date(editingAppointment.starts_at)) : initialDate ?? programmingDateString(new Date()),
  )
  const [endDate, setEndDate] = useState(() =>
    editingAppointment ? programmingDateString(new Date(editingAppointment.starts_at)) : initialDate ?? programmingDateString(new Date()),
  )
  const [startsAt, setStartsAt] = useState(() => editingAppointment ? programmingTimeString(new Date(editingAppointment.starts_at)) : '09:00')
  const [endsAt, setEndsAt] = useState(() => editingAppointment ? programmingTimeString(new Date(editingAppointment.ends_at)) : '10:00')
  const [description, setDescription] = useState(editingAppointment?.activity_description ?? '')
  const [enterprise, setEnterprise] = useState(editingAppointment?.enterprise ?? initialTicket?.enterprise ?? initialLegalProcess?.enterprise_name ?? '')
  const [block, setBlock] = useState(editingAppointment?.block ?? initialTicket?.block ?? '')
  const [unit, setUnit] = useState(editingAppointment?.unit ?? initialTicket?.unit ?? '')
  const [commonAreaLocation, setCommonAreaLocation] = useState(editingAppointment?.common_area_location ?? '')
  const [materials, setMaterials] = useState((editingAppointment?.materials ?? []).join('\n'))
  const [equipment, setEquipment] = useState((editingAppointment?.equipment ?? []).join('\n'))
  const [tools, setTools] = useState((editingAppointment?.tools ?? []).join('\n'))
  const [standaloneLocation, setStandaloneLocation] = useState(editingAppointment?.standalone_location ?? '')
  const [isFinalization, setIsFinalization] = useState(editingAppointment?.is_finalization ?? false)
  const [completionTermDelivered, setCompletionTermDelivered] = useState(editingAppointment?.completion_term_delivered ?? false)
  const [searchFilter, setSearchFilter] = useState('')
  const [ticketSearchFilter, setTicketSearchFilter] = useState('')
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false)
  const [legalProcessPickerOpen, setLegalProcessPickerOpen] = useState(false)
  const ticketPickerRef = useRef<HTMLDivElement>(null)
  const legalProcessPickerRef = useRef<HTMLDivElement>(null)
  const [availabilityState, setAvailabilityState] = useState<{
    requestKey: string
    appointments: Record<string, AvailabilityEntry[]>
    absences: Record<string, Array<{ id: string; type: string; startDate: string; endDate: string; cid: string | null }>>
    error: string | null
  }>({ requestKey: '', appointments: {}, absences: {}, error: null })
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedLegalProcess = legalProcesses.find((process) => process.id === legalProcessId) ??
    (initialLegalProcess?.id === legalProcessId ? initialLegalProcess : undefined)
  const availabilityRequestKey = JSON.stringify([
    collaboratorIds,
    startDate,
    endDate,
    editingAppointment?.id ?? '',
  ])
  const [calendarData, setCalendarData] = useState<{
    holidays: CalendarEntry[]
    workSaturdays: CalendarEntry[]
    workingHours: WorkingHoursSettings
  } | null>(null)

  const loadCalendar = useCallback(() => {
    apiRequest<{
      holidays: CalendarEntry[]
      workSaturdays: CalendarEntry[]
      workingHours: WorkingHoursSettings
    }>('/api/calendar')
      .then((data) => setCalendarData(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  useLiveSync(['settings'], () => {
    loadCalendar()
  })

  const holidayMap = useMemo(() => new Map(calendarData?.holidays.map((h) => [h.date, h]) ?? []), [calendarData])
  const workSaturdayMap = useMemo(() => new Map(calendarData?.workSaturdays.map((s) => [s.date, s]) ?? []), [calendarData])
  const holidaySet = useMemo(() => new Set(calendarData?.holidays.map((h) => h.date) ?? []), [calendarData])
  const workSaturdaySet = useMemo(() => new Set(calendarData?.workSaturdays.map((s) => s.date) ?? []), [calendarData])

  const holidaysInRange = useMemo(() => {
    if (!startDate || !endDate || startDate >= endDate) return []
    const list: CalendarEntry[] = []
    const dt = new Date(`${startDate}T00:00:00Z`)
    const end = new Date(`${endDate}T00:00:00Z`)
    while (dt <= end) {
      const iso = dt.toISOString().slice(0, 10)
      const h = holidayMap.get(iso)
      if (h) list.push(h)
      dt.setUTCDate(dt.getUTCDate() + 1)
    }
    return list
  }, [startDate, endDate, holidayMap])

  const workSatsInRange = useMemo(() => {
    if (!startDate || !endDate || startDate >= endDate) return []
    const list: CalendarEntry[] = []
    const dt = new Date(`${startDate}T00:00:00Z`)
    const end = new Date(`${endDate}T00:00:00Z`)
    while (dt <= end) {
      const iso = dt.toISOString().slice(0, 10)
      const s = workSaturdayMap.get(iso)
      if (s) list.push(s)
      dt.setUTCDate(dt.getUTCDate() + 1)
    }
    return list
  }, [startDate, endDate, workSaturdayMap])

  const hasValidAvailabilityRange = Boolean(
    collaboratorIds.length && startDate && endDate && startDate <= endDate,
  )
  const currentAvailability = availabilityState.requestKey === availabilityRequestKey
    ? availabilityState
    : null
  const appointmentsByCollaborator = currentAvailability?.appointments ?? EMPTY_APPOINTMENTS
  const availabilityLoading = hasValidAvailabilityRange && !currentAvailability

  useEffect(() => {
    if (allowMixedCollaborators) return
    let cancelled = false
    const loadVisibility = () => getProgrammingRoleVisibility()
      .then((result) => {
        if (cancelled) return
        const hiddenRoles = new Set(result.hiddenRoleKeys)
        setHiddenRoleKeys(hiddenRoles)
        setRoleVisibilityLoaded(true)
        if (!editingAppointment && !allowMixedCollaborators) {
          setCollaboratorIds((current) => current.filter((id) => {
            const collaborator = collaborators.find((person) => person.id === id)
            return collaborator && (selectedProgrammingType === 'foreman'
              ? collaborator.role === 'encarregado'
              : collaborator.role !== 'encarregado' && !hiddenRoles.has(collaborator.role))
          }))
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a configuração compartilhada das funções.')
      })
    if (selectedProgrammingType === 'foreman') {
      return () => { cancelled = true }
    }
    void loadVisibility()
    const interval = window.setInterval(() => { void loadVisibility() }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [allowMixedCollaborators, collaborators, editingAppointment, selectedProgrammingType])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ collaborators: CollaboratorOption[] }>('/api/programming/collaborators')
      .then((result) => {
        if (cancelled) return
        const active = result.collaborators.filter((person) => person.is_active && !person.is_on_leave)
        setCollaborators(active)
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar colaboradores.')
      })
      .finally(() => { if (!cancelled) setLoadingPeople(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (activityType !== 'legal_process') return
    let cancelled = false
    apiRequest<{ processes: LegalProcessOption[] }>('/api/programming/legal-processes')
      .then((result) => {
        if (!cancelled) {
          setLegalProcesses(initialLegalProcess
            ? [initialLegalProcess, ...result.processes.filter((process) => process.id !== initialLegalProcess.id)]
            : result.processes)
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os processos jurídicos.')
      })
      .finally(() => { if (!cancelled) setLegalProcessesLoading(false) })
    return () => { cancelled = true }
  }, [activityType, initialLegalProcess])

  useEffect(() => {
    const requestedTicketId = editingAppointment?.ticket_id ?? initialTicketId
    if (!requestedTicketId || tickets.some((ticket) => ticket.id === requestedTicketId)) return
    let cancelled = false
    apiRequest<{ tickets: TicketSummary[] }>(`/api/tickets?id=${encodeURIComponent(requestedTicketId)}&includeInactive=true`)
      .then((result) => {
        if (cancelled) return
        setTicketSearchResults((current) => [...new Map([...current, ...result.tickets].map((ticket) => [ticket.id, ticket])).values()])
        const ticket = result.tickets[0]
        if (ticket) {
          setEnterprise((current) => current || ticket.enterprise)
          setBlock((current) => current || ticket.block)
          setUnit((current) => current || ticket.unit)
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o chamado selecionado.')
      })
    return () => { cancelled = true }
  }, [editingAppointment?.ticket_id, initialTicketId, tickets])

  useEffect(() => {
    const term = ticketSearchFilter.trim()
    if (!ticketPickerOpen || !term) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search: term })
      if (/^\d+$/.test(term)) params.set('searchMode', 'id')
      apiRequest<{ tickets: TicketSummary[] }>(`/api/tickets?${params}`)
        .then((result) => {
          if (!cancelled) setTicketSearchResults((current) => [...new Map([...current.filter((ticket) => tickets.some((loaded) => loaded.id === ticket.id)), ...result.tickets].map((ticket) => [ticket.id, ticket])).values()])
        })
        .catch((requestError: unknown) => {
          if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível pesquisar chamados.')
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ticketPickerOpen, ticketSearchFilter, tickets])

  useEffect(() => {
    function closePicker(event: PointerEvent) {
      if (event.target instanceof Node && !ticketPickerRef.current?.contains(event.target)) {
        setTicketPickerOpen(false)
        setTicketSearchFilter('')
      }
      if (event.target instanceof Node && !legalProcessPickerRef.current?.contains(event.target)) {
        setLegalProcessPickerOpen(false)
        setLegalProcessSearch('')
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTicketPickerOpen(false)
        setLegalProcessPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', closePicker)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', closePicker)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!collaboratorIds.length || !startDate || !endDate || startDate > endDate) {
      return
    }
    let cancelled = false
    Promise.all(collaboratorIds.map(async (collaboratorId) => {
      const params = new URLSearchParams({ collaboratorId, startDate, endDate })
      if (editingAppointment) params.set('excludeId', editingAppointment.id)
      const result = await apiRequest<{
        appointments: AvailabilityEntry[]
        absences?: Array<{ id: string; type: string; startDate: string; endDate: string; cid: string | null }>
      }>(`/api/programming/availability?${params}`)
      return [collaboratorId, result.appointments, result.absences || []] as const
    }))
      .then((results) => {
        if (!cancelled) {
          setAvailabilityState({
            requestKey: availabilityRequestKey,
            appointments: Object.fromEntries(results.map(([id, appts]) => [id, appts])),
            absences: Object.fromEntries(results.map(([id, , abs]) => [id, abs])),
            error: null,
          })
        }
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        const message = requestError instanceof Error ? requestError.message : 'Não foi possível consultar horários.'
        setAvailabilityState({ requestKey: availabilityRequestKey, appointments: {}, absences: {}, error: message })
        setError(message)
      })
    return () => { cancelled = true }
  }, [availabilityRequestKey, collaboratorIds, startDate, endDate, editingAppointment])

  const scheduleDates = useMemo(
    () => availableWorkDatesBetween(startDate, endDate, holidaySet, workSaturdaySet),
    [startDate, endDate, holidaySet, workSaturdaySet],
  )
  const freeSlots = useMemo(
    () => intersectSlots(scheduleDates.flatMap((date) =>
      collaboratorIds.map((collaboratorId) =>
        getFreeSlots(date, appointmentsByCollaborator[collaboratorId] ?? [], calendarData?.workingHours),
      ),
    )),
    [scheduleDates, collaboratorIds, appointmentsByCollaborator, calendarData?.workingHours],
  )

  const filteredCollaborators = collaborators.filter((person) => {
    if (!allowMixedCollaborators && selectedProgrammingType === 'foreman' ? person.role !== 'encarregado' : !allowMixedCollaborators && person.role === 'encarregado') return false
    if (person.role !== 'encarregado' && hiddenRoleKeys.has(person.role)) return false
    const term = searchFilter.toLowerCase()
    return person.name.toLowerCase().includes(term) ||
      (person.nickname && person.nickname.toLowerCase().includes(term)) ||
      roleLabel(person.role, person.role_label).toLowerCase().includes(term)
  })
  const filteredTickets = ticketOptions.filter((ticket) => {
    if (!ticket.sourceActive) return false
    const term = ticketSearchFilter.trim().toLocaleLowerCase('pt-BR')
    return !term || [
      ticket.protocol,
      ticket.id,
      ticket.subject,
      ticket.enterprise,
      ticket.block,
      ticket.unit,
    ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term))
  })
  const filteredLegalProcesses = legalProcesses.filter((process) => {
    const term = legalProcessSearch.trim().toLocaleLowerCase('pt-BR')
    return process.id === legalProcessId || !term || [
      process.title,
      ...process.child_process_numbers,
      process.enterprise_name,
      process.claimant,
    ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term))
  })

  function toggleCollaborator(id: string) {
    setCollaboratorIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function selectAllFiltered() {
    const newIds = new Set([...collaboratorIds, ...filteredCollaborators.map((c) => c.id)])
    setCollaboratorIds([...newIds])
  }

  function clearAll() {
    setCollaboratorIds([])
  }

  function listItems(value: string) {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmittingRef.current || saving) return
    if (!collaboratorIds.length) {
      setError('Selecione pelo menos um colaborador para a atividade.')
      return
    }
    if (activityType === 'ticket' && !ticketId) {
      setError('Selecione um chamado ativo para a atividade.')
      return
    }
    if (activityType === 'legal_process' && !legalProcessId) {
      setError('Selecione um processo jurídico para a atividade.')
      return
    }
    isSubmittingRef.current = true
    setSaving(true)
    setError('')
    try {
      if (startDate > endDate) throw new Error('A data final deve ser igual ou posterior à inicial.')
      const elapsedDays = (Date.parse(`${endDate}T00:00:00`) - Date.parse(`${startDate}T00:00:00`)) / 86_400_000
      if (elapsedDays >= 90) throw new Error('O intervalo da programação deve ter no máximo 90 dias corridos.')
      if (!scheduleDates.length) throw new Error('O intervalo não contém dias úteis para programar.')
      if (endsAt <= startsAt) throw new Error('O horário final deve ser posterior ao inicial.')

      for (const curDate of scheduleDates) {
        const { windowStart, windowEnd, label } = getDayWindow(curDate, calendarData?.workingHours)
        const [sh, sm] = startsAt.split(':').map(Number)
        const [eh, em] = endsAt.split(':').map(Number)
        const sMin = (sh || 0) * 60 + (sm || 0)
        const eMin = (eh || 0) * 60 + (em || 0)
        if (sMin < windowStart || eMin > windowEnd) {
          throw new Error(`O horário ${startsAt}–${endsAt} está fora do expediente de ${curDate.split('-').reverse().join('/')} (${label}).`)
        }
      }

      if (editingAppointment) {
        await apiRequest(`/api/programming/${editingAppointment.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            programmingType: allowMixedCollaborators
              ? collaborators.find((person) => person.id === collaboratorIds[0])?.role === 'encarregado' ? 'foreman' : 'general'
              : selectedProgrammingType,
            activityType,
            ticketId: activityType === 'ticket' ? Number(ticketId) : null,
            legalProcessId: activityType === 'legal_process' ? Number(legalProcessId) : null,
            collaboratorId: Number(collaboratorIds[0]),
            date: startDate,
            startsAt: programmingDateTimeToIso(startDate, startsAt),
            endsAt: programmingDateTimeToIso(startDate, endsAt),
            activityDescription: description,
            enterprise: activityType === 'standalone' ? 'Atividade avulsa' : activityType === 'legal_process' ? selectedLegalProcess?.enterprise_name ?? enterprise : enterprise,
            block,
            unit,
            commonAreaLocation: activityType === 'standalone' ? standaloneLocation : commonAreaLocation,
            standaloneLocation: activityType === 'standalone' ? standaloneLocation : '',
            materials: listItems(materials),
            equipment: listItems(equipment),
            tools: listItems(tools),
            isFinalization: activityType === 'ticket' ? isFinalization : false,
            completionTermDelivered: activityType === 'ticket' ? completionTermDelivered : false,
          }),
        })
      } else {
        await apiRequest('/api/programming', {
          method: 'POST',
          body: JSON.stringify({
            programmingType: allowMixedCollaborators ? 'general' : selectedProgrammingType,
            activityType,
            ticketId: activityType === 'ticket' ? Number(ticketId) : null,
            legalProcessId: activityType === 'legal_process' ? Number(legalProcessId) : null,
            collaboratorIds: collaboratorIds.map(Number),
            startDate,
            endDate,
            occurrences: scheduleDates.map((date) => ({
              date,
              startsAt: programmingDateTimeToIso(date, startsAt),
              endsAt: programmingDateTimeToIso(date, endsAt),
            })),
            activityDescription: description,
            enterprise: activityType === 'standalone' ? 'Atividade avulsa' : activityType === 'legal_process' ? selectedLegalProcess?.enterprise_name ?? enterprise : enterprise,
            block,
            unit,
            commonAreaLocation: activityType === 'standalone' ? standaloneLocation : commonAreaLocation,
            standaloneLocation: activityType === 'standalone' ? standaloneLocation : '',
            materials: listItems(materials),
            equipment: listItems(equipment),
            tools: listItems(tools),
            isFinalization: activityType === 'ticket' ? isFinalization : false,
            completionTermDelivered: activityType === 'ticket' ? completionTermDelivered : false,
          }),
        })
      }
      onSaved(startDate)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar a programação.')
    } finally {
      setSaving(false)
      isSubmittingRef.current = false
    }
  }

  const selectedObjects = collaborators.filter((person) => collaboratorIds.includes(person.id))

  return (
    <form className="ticket-programming-form" onSubmit={(event) => void submit(event)}>
      {!initialTicketId && !initialLegalProcessId && !editingAppointment && (
        <label className="ticket-form-field programming-type-field">
          <span>Tipo de programação</span>
          <select value={activityType} onChange={(event) => {
            const nextType = event.target.value as 'ticket' | 'standalone' | 'legal_process'
            setActivityType(nextType)
            setLegalProcessesLoading(nextType === 'legal_process')
            setTicketId('')
            setLegalProcessId('')
            setLegalProcessPickerOpen(false)
            setLegalProcessSearch('')
            setStandaloneLocation('')
            setEnterprise('')
            setBlock('')
            setUnit('')
            setCommonAreaLocation('')
          }}>
            <option value="ticket">Programação vinculada a chamado</option>
            <option value="standalone">Atividade avulsa</option>
            <option value="legal_process">Atividade jurídica</option>
          </select>
          <small className="programming-type-help">{activityType === 'standalone'
            ? 'Use para serviços internos ou atividades sem protocolo CVCRM.'
            : activityType === 'legal_process'
              ? 'Vincule a atividade a um processo jurídico cadastrado.'
              : 'Vincule a atividade a um chamado ativo do CVCRM.'}</small>
        </label>
      )}

      {activityType === 'legal_process' && !initialLegalProcessId && (
        <div className="ticket-form-field programming-legal-picker">
          <span>Processo jurídico</span>
          <div className="programming-ticket-picker" ref={legalProcessPickerRef}>
            <button type="button" className="programming-ticket-trigger" aria-haspopup="listbox" aria-expanded={legalProcessPickerOpen} aria-label="Selecionar processo jurídico" onClick={() => setLegalProcessPickerOpen((open) => !open)}>
              <span>{selectedLegalProcess
                ? `${selectedLegalProcess.title}${selectedLegalProcess.enterprise_name ? ` · ${selectedLegalProcess.enterprise_name}` : ''}`
                : 'Selecione um processo jurídico'}</span>
              <ChevronDown size={15} />
            </button>
            {legalProcessPickerOpen && <div className="programming-ticket-popover">
              <label className="programming-ticket-search"><Search size={15} /><input type="search" value={legalProcessSearch} onChange={(event) => setLegalProcessSearch(event.target.value)} placeholder="Número, condomínio ou requerente" autoFocus /></label>
              <div className="programming-ticket-options" role="listbox" aria-label="Processos jurídicos">
                {legalProcessesLoading
                  ? <span className="programming-ticket-empty">Carregando processos jurídicos...</span>
                  : filteredLegalProcesses.length ? filteredLegalProcesses.map((process) => (
                    <button type="button" key={process.id} role="option" aria-selected={process.id === legalProcessId} className={process.id === legalProcessId ? 'selected' : ''} onClick={() => {
                      setLegalProcessId(process.id)
                      setLegalProcessPickerOpen(false)
                      setLegalProcessSearch('')
                      setEnterprise(process.enterprise_name)
                      setBlock('')
                      setUnit('')
                      setCommonAreaLocation('')
                    }}>
                      <strong>{process.title}</strong>
                      <span>{process.enterprise_name || 'Condomínio não informado'}{process.claimant ? ` · ${process.claimant}` : ''}</span>
                      {process.child_process_numbers.length > 0 && <small>Processos relacionados: {process.child_process_numbers.join(', ')}</small>}
                    </button>
                  )) : <span className="programming-ticket-empty">Nenhum processo corresponde à busca.</span>}
              </div>
            </div>}
          </div>
          {selectedLegalProcess && selectedLegalProcess.child_process_numbers.length > 0 && <small>Processos relacionados: {selectedLegalProcess.child_process_numbers.join(', ')}</small>}
        </div>
      )}

      {activityType === 'ticket' && (!initialTicketId || editingAppointment) && (
        <div className="ticket-form-field">
          <span>Chamado</span>
          <div className="programming-ticket-picker" ref={ticketPickerRef}>
            <button type="button" className="programming-ticket-trigger" aria-haspopup="listbox" aria-expanded={ticketPickerOpen} onClick={() => setTicketPickerOpen((open) => !open)}>
              <span>{ticketOptions.find((ticket) => ticket.id === ticketId)?.protocol
                ? `ID ${ticketId} · ${ticketOptions.find((ticket) => ticket.id === ticketId)?.protocol} · ${ticketOptions.find((ticket) => ticket.id === ticketId)?.subject || ticketOptions.find((ticket) => ticket.id === ticketId)?.enterprise}`
                : 'Selecione um protocolo'}</span>
              <ChevronDown size={15} />
            </button>
            {ticketPickerOpen && <div className="programming-ticket-popover">
              <label className="programming-ticket-search"><Search size={15} /><input type="search" value={ticketSearchFilter} onChange={(event) => setTicketSearchFilter(event.target.value)} placeholder="ID, protocolo, assunto, condomínio..." autoFocus /></label>
              <div className="programming-ticket-options" role="listbox" aria-label="Chamados ativos">
                {filteredTickets.length ? filteredTickets.map((ticket) => (
                  <button type="button" key={ticket.id} role="option" aria-selected={ticket.id === ticketId} className={ticket.id === ticketId ? 'selected' : ''} onClick={() => {
                    const nextTicketId = ticket.id
                    setTicketId(nextTicketId)
                    setTicketPickerOpen(false)
                    setTicketSearchFilter('')
                    setEnterprise(ticket.enterprise)
                    setBlock(ticket.block)
                    setUnit(ticket.unit)
                    setCommonAreaLocation('')
                  }}>
                    <strong>ID {ticket.id} · {ticket.protocol}</strong><span>{ticket.subject || ticket.enterprise}</span><small>{ticket.enterprise}{ticket.block ? ` · Bloco ${ticket.block}` : ''}{ticket.unit ? ` · Unidade ${ticket.unit}` : ''}</small>
                  </button>
                )) : <span className="programming-ticket-empty">Nenhum chamado ativo corresponde à pesquisa.</span>}
              </div>
            </div>}
          </div>
        </div>
      )}

      {!editingAppointment && <div className="ticket-form-field multi-collab-section">
        <div className="multi-collab-header">
          <span>
            <UsersRound size={15} />
            <strong>Colaboradores da atividade</strong>
            <span className="collab-count-tag">
              {collaboratorIds.length} {collaboratorIds.length === 1 ? 'selecionado' : 'selecionados'}
            </span>
          </span>
          <div className="multi-collab-actions">
            {collaboratorIds.length > 0 && (
              <button type="button" className="text-action-btn" onClick={clearAll}>
                Limpar
              </button>
            )}
            {filteredCollaborators.length > 0 && collaboratorIds.length < filteredCollaborators.length && (
              <button type="button" className="text-action-btn highlight" onClick={selectAllFiltered}>
                Selecionar todos ({filteredCollaborators.length})
              </button>
            )}
          </div>
        </div>

        {/* Chips dos selecionados */}
        {selectedObjects.length > 0 && (
          <div className="selected-collab-chips" aria-label="Colaboradores selecionados">
            {selectedObjects.map((person) => (
              <span key={person.id} className="collab-chip">
                <span className="chip-avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                <span className="chip-name">{person.nickname || person.name.split(' ')[0]}</span>
                <button
                  type="button"
                  aria-label={`Remover ${person.name}`}
                  onClick={() => toggleCollaborator(person.id)}
                  className="chip-remove"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Campo de busca de colaborador */}
        <div className="collab-search-wrap">
          <Search size={14} />
          <input
            type="search"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filtrar colaborador por nome, apelido ou função..."
            aria-label="Filtrar colaboradores"
          />
          {searchFilter && <button type="button" className="collab-search-clear" aria-label="Limpar busca de colaboradores" onClick={() => setSearchFilter('')}><X size={13} /></button>}
        </div>

        {/* Lista interativa de colaboradores com checkbox */}
        <div className="collab-checklist" role="group" aria-label="Lista de colaboradores disponíveis">
          {loadingPeople || (selectedProgrammingType === 'general' && !roleVisibilityLoaded) ? (
            <div className="collab-checklist-empty">Carregando colaboradores...</div>
          ) : collaborators.length === 0 ? (
            <div className="collab-checklist-empty">Nenhum colaborador ativo cadastrado.</div>
          ) : filteredCollaborators.length === 0 ? (
            <div className="collab-checklist-empty">{searchFilter
              ? `Nenhum colaborador visível encontrado com "${searchFilter}".`
              : 'As funções dos colaboradores estão ocultas na programação. Reative-as na agenda para selecioná-los.'}</div>
          ) : (
            filteredCollaborators.map((person) => {
              const isSelected = collaboratorIds.includes(person.id)
              return (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => toggleCollaborator(person.id)}
                  className={`collab-checklist-item ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                >
                  <span className={`collab-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && <Check size={12} />}
                  </span>
                  <span className="collab-avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                  <span className="collab-details">
                    <strong>
                      {person.name}
                      {person.nickname ? <small> ({person.nickname})</small> : ''}
                    </strong>
                    <span className="collab-role-tag">{roleLabel(person.role, person.role_label)}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>}
      {editingAppointment && (
        <label className="ticket-form-field">
          <span><UsersRound size={15} /> Colaborador da atividade</span>
          <select value={collaboratorIds[0] ?? ''} onChange={(event) => setCollaboratorIds([event.target.value])} required>
            {collaborators.filter((person) =>
              (selectedProgrammingType === 'foreman' ? person.role === 'encarregado' : person.role !== 'encarregado' && !hiddenRoleKeys.has(person.role)),
            ).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            {collaborators.some((person) => person.id === collaboratorIds[0] &&
              (selectedProgrammingType === 'foreman' ? person.role === 'encarregado' : hiddenRoleKeys.has(person.role)),
            ) && (
              <option value={collaboratorIds[0]}>Colaborador atual (função oculta)</option>
            )}
          </select>
        </label>
      )}

      <label className="ticket-form-field">
        <span><CalendarDays size={14} /> {editingAppointment ? 'Data da atividade' : 'Data de início'}</span>
        <input
          type="date"
          value={startDate}
          onChange={(event) => {
            setStartDate(event.target.value)
            if (event.target.value > endDate) setEndDate(event.target.value)
          }}
          required
        />
      </label>
      {!editingAppointment && (
        <label className="ticket-form-field">
          <span><CalendarDays size={14} /> Data final (até 90 dias)</span>
          <input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required />
        </label>
      )}

      <div className="ticket-time-row">
        <label className="ticket-form-field">
          <span><Clock3 size={14} /> Início</span>
          <input type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label className="ticket-form-field">
          <span>Fim</span>
          <input type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
      </div>

      {startDate === endDate ? (
        holidayMap.has(startDate) ? (
          <div className="notice notice-error" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
            <AlertTriangle size={15} />
            <span>A data selecionada ({startDate.split('-').reverse().join('/')}) é feriado: <strong>{holidayMap.get(startDate)?.description}</strong>. Não é permitido criar programações neste dia.</span>
          </div>
        ) : new Date(`${startDate}T12:00:00Z`).getUTCDay() === 6 && workSaturdayMap.has(startDate) ? (
          <div className="notice notice-success" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
            <Check size={15} />
            <span>Sábado com expediente liberado para compensação: <strong>{workSaturdayMap.get(startDate)?.description}</strong>.</span>
          </div>
        ) : new Date(`${startDate}T12:00:00Z`).getUTCDay() === 6 ? (
          <div className="notice notice-error" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
            <AlertTriangle size={15} />
            <span>Aos sábados não há expediente padrão. Apenas sábados cadastrados como compensação na administração são permitidos.</span>
          </div>
        ) : new Date(`${startDate}T12:00:00Z`).getUTCDay() === 0 ? (
          <div className="notice notice-error" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
            <AlertTriangle size={15} />
            <span>Aos domingos não há expediente da assistência técnica.</span>
          </div>
        ) : new Date(`${startDate}T12:00:00Z`).getUTCDay() === 5 ? (
          <div className="notice notice-info" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
            <Clock3 size={15} />
            <span>Expediente de sexta-feira: <strong>{calendarData?.workingHours.friday.start ?? '08:00'} às {calendarData?.workingHours.friday.end ?? '17:00'}</strong>.</span>
          </div>
        ) : null
      ) : (
        <>
          {holidaysInRange.length > 0 && (
            <div className="notice notice-info" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
              <CalendarDays size={15} />
              <span>Feriados no intervalo desconsiderados: <strong>{holidaysInRange.map((h) => `${h.date.split('-').reverse().join('/')} (${h.description})`).join(', ')}</strong>.</span>
            </div>
          )}
          {workSatsInRange.length > 0 && (
            <div className="notice notice-success" style={{ gridColumn: '1 / -1', margin: '4px 0 8px' }}>
              <Check size={15} />
              <span>Sábados de compensação incluídos no intervalo: <strong>{workSatsInRange.map((s) => `${s.date.split('-').reverse().join('/')} (${s.description})`).join(', ')}</strong>.</span>
            </div>
          )}
        </>
      )}

      <label className="ticket-form-field" style={{ gridColumn: '1 / -1' }}>
        <span><Wrench size={14} /> Atividade prevista</span>
        <textarea
          rows={3}
          maxLength={3000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descreva o serviço que será realizado pelos colaboradores selecionados"
          required
        />
      </label>

      {activityType === 'standalone' ? (
        <label className="ticket-form-field standalone-location-field" style={{ gridColumn: '1 / -1' }}>
          <span><Wrench size={14} /> Local onde a atividade será realizada</span>
          <textarea
            rows={2}
            maxLength={500}
            value={standaloneLocation}
            onChange={(event) => setStandaloneLocation(event.target.value)}
            placeholder="Ex.: Sede administrativa, garagem do bloco B, área externa próxima à portaria..."
            required
          />
          <small>Informe um ponto de referência claro para a equipe de campo.</small>
        </label>
      ) : <div className="programming-location-fields">
        <label className="ticket-form-field"><span>Empreendimento {activityType === 'ticket' ? '*' : ''}</span><input value={enterprise} onChange={(event) => setEnterprise(event.target.value)} maxLength={240} required={activityType === 'ticket'} /></label>
        <label className="ticket-form-field"><span>Bloco</span><input value={block} onChange={(event) => setBlock(event.target.value)} maxLength={120} disabled={Boolean(commonAreaLocation.trim())} required={activityType === 'ticket' && !commonAreaLocation.trim()} /></label>
        <label className="ticket-form-field"><span>Unidade</span><input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={120} disabled={Boolean(commonAreaLocation.trim())} required={activityType === 'ticket' && !commonAreaLocation.trim()} /></label>
        <label className="ticket-form-field"><span>Local da área comum (alternativa a bloco/unidade)</span><input value={commonAreaLocation} onChange={(event) => { const value = event.target.value; setCommonAreaLocation(value); if (value.trim()) { setBlock(''); setUnit('') } }} maxLength={240} /></label>
      </div>}

      <div className="programming-kit-fields">
        <label className="ticket-form-field"><span><Wrench size={14} /> Materiais (um por linha)</span><textarea rows={3} maxLength={3000} value={materials} onChange={(event) => setMaterials(event.target.value)} placeholder="Ex.: argamassa" /></label>
        <label className="ticket-form-field"><span>Equipamentos (um por linha)</span><textarea rows={3} maxLength={3000} value={equipment} onChange={(event) => setEquipment(event.target.value)} placeholder="Ex.: betoneira" /></label>
        <label className="ticket-form-field"><span>Ferramentas (um por linha)</span><textarea rows={3} maxLength={3000} value={tools} onChange={(event) => setTools(event.target.value)} placeholder="Ex.: colher de pedreiro" /></label>
      </div>

      {activityType === 'ticket' && (
        <div className={`programming-finalization-card ${isFinalization ? 'is-active' : ''}`} style={{ gridColumn: '1 / -1' }}>
          <div className="programming-finalization-header">
            <label className="programming-finalization-checkbox-label">
              <input
                type="checkbox"
                checked={isFinalization}
                onChange={(event) => {
                  const nextChecked = event.target.checked
                  setIsFinalization(nextChecked)
                  if (!nextChecked) setCompletionTermDelivered(false)
                }}
              />
              <span className="programming-finalization-title">
                <FileSignature size={14} className="programming-finalization-icon" />
                Programação de finalização do chamado
              </span>
            </label>
            {isFinalization && (
              <span className="programming-finalization-badge">
                Solicitar assinatura do termo ao cliente
              </span>
            )}
          </div>
          <p className="programming-finalization-desc">
            Identifica esta atividade como a visita final da assistência técnica, gerando alertas na agenda e no relatório PDF para coleta da assinatura do cliente no termo de finalização.
          </p>

          {isFinalization && (
            <div className="programming-finalization-subrow">
              <label className="programming-term-delivered-toggle">
                <input
                  type="checkbox"
                  checked={completionTermDelivered}
                  onChange={(event) => setCompletionTermDelivered(event.target.checked)}
                />
                <span>Termo de finalização entregue ao colaborador</span>
              </label>
              <small className={`programming-term-delivered-hint ${completionTermDelivered ? 'is-delivered' : ''}`}>
                {completionTermDelivered
                  ? '✓ Via física já repassada ao colaborador para coleta da assinatura em campo.'
                  : 'Lembrete: certifique-se de imprimir o termo de finalização e entregá-lo ao colaborador antes da visita.'}
              </small>
            </div>
          )}
        </div>
      )}

      <div className="availability-panel">
        <strong>
          Horários livres em comum ({collaboratorIds.length} {collaboratorIds.length === 1 ? 'colaborador' : 'colaboradores'}, {scheduleDates.length} {scheduleDates.length === 1 ? 'dia útil' : 'dias úteis'})
          {calendarData?.workingHours && (
            <span style={{ fontWeight: 400, marginLeft: 6, color: '#64748b' }}>
              · Seg-Qui {calendarData.workingHours.monday_thursday.start}–{calendarData.workingHours.monday_thursday.end}, Sex {calendarData.workingHours.friday.start}–{calendarData.workingHours.friday.end}
            </span>
          )}
        </strong>
        {currentAvailability?.absences && Object.entries(currentAvailability.absences).some(([, absList]) => absList.length > 0) && (
          <div className="collaborator-conflict-warning" style={{ margin: '8px 0', borderLeft: '4px solid #dc2626' }}>
            <div className="collaborator-conflict-warning-title" style={{ color: '#b91c1c' }}>
              <AlertTriangle size={15} />
              <span>Colaborador com afastamento/bloqueio no período!</span>
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '11px', color: '#991b1b' }}>
              {Object.entries(currentAvailability.absences).flatMap(([collabId, absList]) => {
                const person = collaborators.find((c) => c.id === collabId)
                return absList.map((abs) => (
                  <li key={abs.id}>
                    <strong>{person?.name || 'Colaborador'}:</strong> {abs.type === 'atestado' ? 'Atestado médico' : 'Falta injustificada'}{abs.cid ? ` (CID ${abs.cid})` : ''} · {abs.startDate.split('-').reverse().join('/')} a {abs.endDate.split('-').reverse().join('/')} (Agenda bloqueada)
                  </li>
                ))
              })}
            </ul>
          </div>
        )}
        {!collaboratorIds.length ? (
          <span>Selecione um ou mais colaboradores para calcular a janela livre compartilhada.</span>
        ) : !scheduleDates.length ? (
          <span>O período selecionado não contém dias úteis para calcular a disponibilidade.</span>
        ) : availabilityLoading ? (
          <span>Consultando a disponibilidade dos colaboradores...</span>
        ) : currentAvailability?.error ? (
          <span role="alert">Não foi possível consultar a disponibilidade: {currentAvailability.error}</span>
        ) : freeSlots.length ? (
          <div className="availability-slots">
            {freeSlots.map((slot) => (
              <button
                key={`${slot.startsAt}-${slot.endsAt}`}
                type="button"
                onClick={() => { setStartsAt(slot.startsAt); setEndsAt(slot.endsAt) }}
                title="Aplicar este horário"
              >
                {slot.startsAt}–{slot.endsAt}
              </button>
            ))}
          </div>
        ) : (
          <span role="status">Não há horários disponíveis em comum para os colaboradores selecionados nos dias úteis desse período.</span>
        )}
        <small>O horário escolhido precisa estar livre para todos os colaboradores em todos os dias úteis do intervalo.</small>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <footer className="dialog-footer">
        {onCancel && (
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={saving || loadingPeople || !collaboratorIds.length}
        >
          {saving ? 'Salvando...' : editingAppointment ? 'Salvar alterações' : `Confirmar programação (${collaboratorIds.length || 0} colaboradores · ${scheduleDates.length} dias úteis)`}
        </button>
      </footer>
    </form>
  )
}
