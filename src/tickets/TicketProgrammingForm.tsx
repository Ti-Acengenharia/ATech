import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Check, ChevronDown, Clock3, Search, UsersRound, Wrench, X } from 'lucide-react'
import { apiRequest } from '../api/client'
import type { LegalProcessOption, TicketSummary } from './types'
import { getProgrammingRoleVisibility } from './programming-role-visibility'

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
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toMinutes(value: Date) {
  return value.getHours() * 60 + value.getMinutes()
}

function formatMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function getFreeSlots(date: string, appointments: AvailabilityEntry[]): FreeSlot[] {
  const windowStart = 8 * 60
  const windowEnd = 18 * 60
  const booked = appointments
    .map((appointment) => ({ start: new Date(appointment.starts_at), end: new Date(appointment.ends_at) }))
    .filter(({ start, end }) => localDateString(start) === date && localDateString(end) === date)
    .map(({ start, end }) => ({ start: toMinutes(start), end: toMinutes(end) }))
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
  const parseMin = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number)
    return hours * 60 + minutes
  }
  return slotGroups[0].flatMap((firstSlot) => {
    let start = parseMin(firstSlot.startsAt)
    let end = parseMin(firstSlot.endsAt)
    for (const slots of slotGroups.slice(1)) {
      const match = slots.find((slot) => parseMin(slot.startsAt) < end && parseMin(slot.endsAt) > start)
      if (!match) return []
      start = Math.max(start, parseMin(match.startsAt))
      end = Math.min(end, parseMin(match.endsAt))
    }
    return end > start ? [{ startsAt: formatMinutes(start), endsAt: formatMinutes(end) }] : []
  })
}

function toIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString()
}

function weekdayDatesBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate || startDate > endDate) return []
  const dates: string[] = []
  const date = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (date <= end) {
    if (date.getDay() !== 0 && date.getDay() !== 6) dates.push(localDateString(date))
    date.setDate(date.getDate() + 1)
  }
  return dates
}

function timeString(value: string) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
  onSaved: () => void
  onCancel?: () => void
}) {
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
    editingAppointment ? localDateString(new Date(editingAppointment.starts_at)) : initialDate ?? localDateString(new Date()),
  )
  const [endDate, setEndDate] = useState(() =>
    editingAppointment ? localDateString(new Date(editingAppointment.starts_at)) : initialDate ?? localDateString(new Date()),
  )
  const [startsAt, setStartsAt] = useState(() => editingAppointment ? timeString(editingAppointment.starts_at) : '09:00')
  const [endsAt, setEndsAt] = useState(() => editingAppointment ? timeString(editingAppointment.ends_at) : '10:00')
  const [description, setDescription] = useState(editingAppointment?.activity_description ?? '')
  const [enterprise, setEnterprise] = useState(editingAppointment?.enterprise ?? initialTicket?.enterprise ?? initialLegalProcess?.enterprise_name ?? '')
  const [block, setBlock] = useState(editingAppointment?.block ?? initialTicket?.block ?? '')
  const [unit, setUnit] = useState(editingAppointment?.unit ?? initialTicket?.unit ?? '')
  const [commonAreaLocation, setCommonAreaLocation] = useState(editingAppointment?.common_area_location ?? '')
  const [materials, setMaterials] = useState((editingAppointment?.materials ?? []).join('\n'))
  const [equipment, setEquipment] = useState((editingAppointment?.equipment ?? []).join('\n'))
  const [tools, setTools] = useState((editingAppointment?.tools ?? []).join('\n'))
  const [standaloneLocation, setStandaloneLocation] = useState(editingAppointment?.standalone_location ?? '')
  const [searchFilter, setSearchFilter] = useState('')
  const [ticketSearchFilter, setTicketSearchFilter] = useState('')
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false)
  const [legalProcessPickerOpen, setLegalProcessPickerOpen] = useState(false)
  const ticketPickerRef = useRef<HTMLDivElement>(null)
  const legalProcessPickerRef = useRef<HTMLDivElement>(null)
  const [appointmentsByCollaborator, setAppointmentsByCollaborator] = useState<Record<string, AvailabilityEntry[]>>({})
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedLegalProcess = legalProcesses.find((process) => process.id === legalProcessId) ??
    (initialLegalProcess?.id === legalProcessId ? initialLegalProcess : undefined)

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
      const result = await apiRequest<{ appointments: AvailabilityEntry[] }>(`/api/programming/availability?${params}`)
      return [collaboratorId, result.appointments] as const
    }))
      .then((results) => {
        if (!cancelled) setAppointmentsByCollaborator(Object.fromEntries(results))
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível consultar horários.')
      })
    return () => { cancelled = true }
  }, [collaboratorIds, startDate, endDate, editingAppointment])

  const scheduleDates = weekdayDatesBetween(startDate, endDate)
  const freeSlots = intersectSlots(scheduleDates.flatMap((date) =>
    collaboratorIds.map((collaboratorId) =>
      getFreeSlots(date, appointmentsByCollaborator[collaboratorId] ?? []),
    ),
  ))

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
    setSaving(true)
    setError('')
    try {
      if (startDate > endDate) throw new Error('A data final deve ser igual ou posterior à inicial.')
      const elapsedDays = (Date.parse(`${endDate}T00:00:00`) - Date.parse(`${startDate}T00:00:00`)) / 86_400_000
      if (elapsedDays >= 90) throw new Error('O intervalo da programação deve ter no máximo 90 dias corridos.')
      if (!scheduleDates.length) throw new Error('O intervalo não contém dias úteis para programar.')
      if (endsAt <= startsAt) throw new Error('O horário final deve ser posterior ao inicial.')

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
            startsAt: toIso(startDate, startsAt),
            endsAt: toIso(startDate, endsAt),
            activityDescription: description,
            enterprise: activityType === 'standalone' ? 'Atividade avulsa' : activityType === 'legal_process' ? selectedLegalProcess?.enterprise_name ?? enterprise : enterprise,
            block,
            unit,
            commonAreaLocation: activityType === 'standalone' ? standaloneLocation : commonAreaLocation,
            standaloneLocation: activityType === 'standalone' ? standaloneLocation : '',
            materials: listItems(materials),
            equipment: listItems(equipment),
            tools: listItems(tools),
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
              startsAt: toIso(date, startsAt),
              endsAt: toIso(date, endsAt),
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
          }),
        })
      }
      onSaved()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar a programação.')
    } finally {
      setSaving(false)
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

      <div className="availability-panel">
        <strong>Horários livres em comum ({collaboratorIds.length} colaboradores, {scheduleDates.length} dias úteis) · 08:00–18:00</strong>
        {!collaboratorIds.length ? (
          <span>Selecione um ou mais colaboradores para calcular a janela livre compartilhada.</span>
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
          <span>Sem horários em comum nesta janela para todos os colaboradores selecionados.</span>
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
