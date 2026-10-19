import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AtSign,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coins,
  Download,
  FileSignature,
  LayoutGrid,
  List,
  MessageCircle,
  Pencil,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import { apiRequest } from '../api/client'
import CompletionTermModal from './CompletionTermModal'
import TicketProgrammingForm from './TicketProgrammingForm'
import type { CvTicketAttachment, CvTicketMessage, TeamMentionTarget, TicketProgramming, TicketSummary, TicketTag, TicketWorkflowStage } from './types'

interface SyncState {
  last_started_at: string | null
  last_finished_at: string | null
  last_success: boolean | null
  imported_count: number
  error_message: string | null
}

interface TicketComment {
  id: string
  body: string
  created_at: string
  updated_at: string
  parent_comment_id: string | null
  author_id: string
  author_name: string
  mentions: TeamMentionTarget[]
}

interface TicketHistoryEntry {
  id: string
  event_type: string
  summary: string
  created_at: string
  actor_name: string
}

interface TicketAttachment {
  id: string
  file_name: string
  content_type: string
  file_size: number
  created_at: string
  uploaded_by_name: string
}

interface CompletionTermFile {
  id: string
  ticket_id: string
  file_name: string
  file_size: number
  created_at: string
  uploaded_by_name: string
  uploaded_by: string | number | null
}

interface TicketSubtask {
  id: string
  title: string
  assigned_to: string | null
  assignee_name: string | null
  due_at: string | null
  is_done: boolean
}

type TicketCardField = 'customer' | 'description' | 'warranty' | 'age' | 'counts' | 'tags'
type TicketViewMode = 'kanban' | 'list'
type TicketSortField = 'id' | 'protocol' | 'status' | 'enterprise' | 'openedAt'
type TicketSortDirection = 'asc' | 'desc'

interface SavedTicketFilters {
  search: string
  enterprises: string[]
  block: string
  unit: string
  customer: string
  subject: string
  subsubject: string
  includeInactive: boolean
  viewMode: TicketViewMode
  cardFields: TicketCardField[]
  sortField: TicketSortField
  sortDirection: TicketSortDirection
}

const defaultCardFields: TicketCardField[] = ['customer', 'warranty', 'age', 'counts', 'tags']
const ticketSortFields: { value: TicketSortField; label: string }[] = [
  { value: 'id', label: 'ID' },
  { value: 'protocol', label: 'Protocolo' },
  { value: 'status', label: 'Situação' },
  { value: 'enterprise', label: 'Empreendimento' },
  { value: 'openedAt', label: 'Data de abertura' },
]
const kanbanPageSize = 5
const listPageSize = 50

function readTicketFilters(userId: number): SavedTicketFilters {
  const prefix = `atech-ticket-filters-${userId}`
  const readCookie = (name: string) => document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
  try {
    const chunkCount = Number(readCookie(`${prefix}-count`))
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 10) throw new Error('Invalid cookie')
    const encoded = Array.from({ length: chunkCount }, (_, index) => readCookie(`${prefix}-${index}`)).join('')
    if (!encoded) throw new Error('Empty cookie')
    const saved = JSON.parse(decodeURIComponent(encoded)) as Partial<SavedTicketFilters>
    return {
      search: typeof saved.search === 'string' ? saved.search.slice(0, 100) : '',
      enterprises: Array.isArray(saved.enterprises) ? saved.enterprises.filter((value): value is string => typeof value === 'string').slice(0, 50) : [],
      block: typeof saved.block === 'string' ? saved.block.slice(0, 120) : '',
      unit: typeof saved.unit === 'string' ? saved.unit.slice(0, 120) : '',
      customer: typeof saved.customer === 'string' ? saved.customer.slice(0, 160) : '',
      subject: typeof saved.subject === 'string' ? saved.subject.slice(0, 240) : '',
      subsubject: typeof saved.subsubject === 'string' ? saved.subsubject.slice(0, 240) : '',
      includeInactive: saved.includeInactive === true,
      viewMode: saved.viewMode === 'list' ? 'list' : 'kanban',
      cardFields: Array.isArray(saved.cardFields)
        ? [...new Set(saved.cardFields.filter((field): field is TicketCardField =>
          ['customer', 'description', 'warranty', 'age', 'counts', 'tags'].includes(String(field)),
        ))]
        : defaultCardFields,
      sortField: ticketSortFields.some(({ value }) => value === saved.sortField)
        ? saved.sortField as TicketSortField
        : 'openedAt',
      sortDirection: saved.sortDirection === 'desc' ? 'desc' : 'asc',
    }
  } catch {
    return { search: '', enterprises: [], block: '', unit: '', customer: '', subject: '', subsubject: '', includeInactive: false, viewMode: 'kanban', cardFields: defaultCardFields, sortField: 'openedAt', sortDirection: 'asc' }
  }
}

function saveTicketFilters(userId: number, filters: SavedTicketFilters) {
  const prefix = `atech-ticket-filters-${userId}`
  const readCookie = (name: string) => document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
  const previousCount = Number(readCookie(`${prefix}-count`)) || 0
  const value = encodeURIComponent(JSON.stringify(filters))
  const chunks = value.match(/.{1,3000}/g) ?? []
  if (chunks.length > 10) return false
  document.cookie = `${prefix}-count=${chunks.length}; Path=/; Max-Age=31536000; SameSite=Lax`
  chunks.forEach((chunk, index) => {
    document.cookie = `${prefix}-${index}=${chunk}; Path=/; Max-Age=31536000; SameSite=Lax`
  })
  const saved = Array.from({ length: chunks.length }, (_, index) => readCookie(`${prefix}-${index}`)).join('')
  if (Number(readCookie(`${prefix}-count`)) !== chunks.length || saved !== value) return false
  for (let index = chunks.length; index < previousCount; index += 1) {
    document.cookie = `${prefix}-${index}=; Path=/; Max-Age=0; SameSite=Lax`
  }
  return true
}

function safeColor(value: string | null, fallback: string) {
  return value && /^#[\da-f]{3,8}$/i.test(value) ? value : fallback
}

function cvMessageText(value: string) {
  const formatted = value
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const parsed = new DOMParser().parseFromString(formatted, 'text/html')
  return (parsed.body.textContent ?? '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

const ticketSortCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function compareTickets(left: TicketSummary, right: TicketSummary, field: TicketSortField, direction: TicketSortDirection) {
  let result: number
  if (field === 'id') {
    result = Number(left.id) - Number(right.id)
  } else if (field === 'openedAt') {
    const leftDate = left.openedAt ? Date.parse(left.openedAt) : Number.NaN
    const rightDate = right.openedAt ? Date.parse(right.openedAt) : Number.NaN
    if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
      if (Number.isNaN(leftDate) !== Number.isNaN(rightDate)) return Number.isNaN(leftDate) ? 1 : -1
      result = 0
    } else {
      result = leftDate - rightDate
    }
  } else {
    const leftValue = field === 'protocol' ? left.protocol : field === 'status' ? left.status : left.enterprise
    const rightValue = field === 'protocol' ? right.protocol : field === 'status' ? right.status : right.enterprise
    result = ticketSortCollator.compare(leftValue, rightValue)
  }
  if (result === 0) result = Number(left.id) - Number(right.id)
  return direction === 'asc' ? result : -result
}

function formatAge(seconds: number | null) {
  if (seconds === null) return 'Abertura indisponível'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h aberto`
  if (hours) return `${hours}h ${minutes}min aberto`
  return `${Math.max(1, minutes)}min aberto`
}

function formatDate(value: string | null) {
  if (!value) return 'Sem prazo'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatWarrantyDate(value: string | null) {
  if (!value) return 'Não informada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
}

function warrantyLabel(status: NonNullable<TicketSummary['warranty']>['status']) {
  if (status === 'within') return 'Dentro da garantia'
  if (status === 'outside') return 'Fora da garantia'
  return 'Garantia indeterminada'
}

function money(value: string | null) {
  if (value === null) return 'Não informado'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

function localInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function TicketBoardPage({
  canManageIntegration,
  onOpenValidation,
  currentUser,
  initialTicketId,
  onTicketOpened,
}: {
  canManageIntegration: boolean
  onOpenValidation?: () => void
  currentUser: { id: number; role: 'admin' | 'member'; displayName: string }
  initialTicketId?: string | null
  onTicketOpened?: () => void
}) {
  const [savedFilters] = useState(() => readTicketFilters(currentUser.id))
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [ticketPagination, setTicketPagination] = useState<{ key: string; counts: Record<string, number> }>({ key: '', counts: {} })
  const [completionTerms, setCompletionTerms] = useState<CompletionTermFile[]>([])
  const [enterpriseOptions, setEnterpriseOptions] = useState<string[]>([])
  const [blockOptions, setBlockOptions] = useState<string[]>([])
  const [unitOptions, setUnitOptions] = useState<string[]>([])
  const [blockUnitOptionsScope, setBlockUnitOptionsScope] = useState<string | null>(null)
  const [subjectOptions, setSubjectOptions] = useState<string[]>([])
  const [subsubjectOptions, setSubsubjectOptions] = useState<string[]>([])
  const [tagOptions, setTagOptions] = useState<TicketTag[]>([])
  const [stages, setStages] = useState<TicketWorkflowStage[]>([])
  const [syncState, setSyncState] = useState<SyncState | null>(null)
  const [configured, setConfigured] = useState(false)
  const [search, setSearch] = useState(savedFilters.search)
  const [enterpriseFilters, setEnterpriseFilters] = useState<string[]>(savedFilters.enterprises)
  const [blockFilter, setBlockFilter] = useState(savedFilters.block)
  const [unitFilter, setUnitFilter] = useState(savedFilters.unit)
  const [customerNameFilter, setCustomerNameFilter] = useState(savedFilters.customer)
  const [subjectFilter, setSubjectFilter] = useState(savedFilters.subject)
  const [subsubjectFilter, setSubsubjectFilter] = useState(savedFilters.subsubject)
  const [includeInactive, setIncludeInactive] = useState(savedFilters.includeInactive)
  const [viewMode, setViewMode] = useState<TicketViewMode>(savedFilters.viewMode)
  const [cardFields, setCardFields] = useState<TicketCardField[]>(savedFilters.cardFields)
  const [sortField, setSortField] = useState<TicketSortField>(savedFilters.sortField)
  const [sortDirection, setSortDirection] = useState<TicketSortDirection>(savedFilters.sortDirection)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3478a8')
  const [selected, setSelected] = useState<TicketSummary | null>(null)
  const [termTicket, setTermTicket] = useState<TicketSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [refreshKey, setRefreshKey] = useState(0)
  const kanbanBoardRef = useRef<HTMLDivElement>(null)
  const kanbanDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null)
  const suppressKanbanClickRef = useRef(false)

  // Modal para criar chamado por protocolo
  const [showProtocolModal, setShowProtocolModal] = useState(false)
  const [protocolInput, setProtocolInput] = useState('')
  const [lookingUpProtocol, setLookingUpProtocol] = useState(false)
  const [protocolError, setProtocolError] = useState('')
  const enterpriseFilterKey = JSON.stringify([...enterpriseFilters].sort((left, right) => left.localeCompare(right)))
  const blockOptionsReady = blockUnitOptionsScope === enterpriseFilterKey
  const activeBlockFilter = blockOptionsReady && blockOptions.includes(blockFilter) ? blockFilter : ''
  const activeUnitFilter = blockOptionsReady && unitOptions.includes(unitFilter) ? unitFilter : ''

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiRequest<{ stages: TicketWorkflowStage[] }>('/api/tickets/workflow'),
      apiRequest<{ configured: boolean; state: SyncState | null }>('/api/tickets/integration'),
      apiRequest<{ enterprises: string[]; blocks: string[]; units: string[]; subjects: string[]; subsubjects: string[] }>(`/api/tickets/filter-options${includeInactive ? '?includeInactive=true' : ''}`),
      apiRequest<{ tags: TicketTag[] }>('/api/tickets/tags'),
    ]).then(([stageResult, integration, filterOptions, tags]) => {
      if (cancelled) return
      setStages(stageResult.stages)
      setConfigured(integration.configured)
      setSyncState(integration.state)
      setEnterpriseOptions(filterOptions.enterprises)
      setSubjectOptions(filterOptions.subjects)
      setSubsubjectOptions(filterOptions.subsubjects)
      setTagOptions(tags.tags)
    }).catch((error: unknown) => {
      if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os chamados.' })
    })
    return () => { cancelled = true }
  }, [refreshKey, includeInactive])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    for (const enterprise of enterpriseFilters) params.append('enterprise', enterprise)
    if (includeInactive) params.set('includeInactive', 'true')
    const query = params.toString()
    apiRequest<{ blocks: string[]; units: string[] }>(`/api/tickets/filter-options${query ? `?${query}` : ''}`)
      .then((options) => {
        if (cancelled) return
        setBlockOptions(options.blocks)
        setUnitOptions(options.units)
        setBlockUnitOptionsScope(enterpriseFilterKey)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar as opções de bloco e unidade.' })
      })
    return () => { cancelled = true }
  }, [enterpriseFilters, enterpriseFilterKey, includeInactive, refreshKey])

  useEffect(() => {
    const saved = saveTicketFilters(currentUser.id, {
      search,
      enterprises: enterpriseFilters,
      block: blockOptionsReady ? activeBlockFilter : blockFilter,
      unit: blockOptionsReady ? activeUnitFilter : unitFilter,
      customer: customerNameFilter,
      subject: subjectFilter,
      subsubject: subsubjectFilter,
      includeInactive,
      viewMode,
      cardFields,
      sortField,
      sortDirection,
    })
    if (!saved) {
      console.error(new Error('Não foi possível salvar os filtros neste navegador. Reduza a quantidade de empreendimentos selecionados e verifique as permissões de cookies.'))
    }
  }, [currentUser.id, search, enterpriseFilters, blockOptionsReady, activeBlockFilter, activeUnitFilter, blockFilter, unitFilter, customerNameFilter, subjectFilter, subsubjectFilter, includeInactive, viewMode, cardFields, sortField, sortDirection])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ terms: CompletionTermFile[] }>('/api/tickets/completion-terms')
      .then((result) => {
        if (!cancelled) setCompletionTerms(result.terms)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os termos salvos.' })
      })
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      for (const enterprise of enterpriseFilters) params.append('enterprise', enterprise)
      if (activeBlockFilter) params.set('block', activeBlockFilter)
      if (activeUnitFilter) params.set('unit', activeUnitFilter)
      if (customerNameFilter.trim()) params.set('customerName', customerNameFilter.trim())
      if (subjectFilter) params.set('subject', subjectFilter)
      if (subsubjectFilter) params.set('subsubject', subsubjectFilter)
      if (includeInactive) params.set('includeInactive', 'true')
      const query = params.toString()
      const suffix = query ? `?${query}` : ''
      apiRequest<{ tickets: TicketSummary[] }>(`/api/tickets${suffix}`)
        .then(async (ticketResult) => {
          if (cancelled) return
          setTickets(ticketResult.tickets)
        if (initialTicketId) {
          let target = ticketResult.tickets.find((ticket) => ticket.id === initialTicketId)
          if (!target) {
            const targetResult = await apiRequest<{ tickets: TicketSummary[] }>(
              `/api/tickets?id=${encodeURIComponent(initialTicketId)}${includeInactive ? '&includeInactive=true' : ''}`,
            )
            target = targetResult.tickets[0]
          }
          if (cancelled) return
          if (target) {
            setSelected(target)
            onTicketOpened?.()
          } else {
            setNotice({ kind: 'error', text: 'O chamado desta notificação não foi encontrado.' })
          }
        }
        }).catch((error: unknown) => {
          if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os chamados.' })
        }).finally(() => { if (!cancelled) setLoading(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [search, enterpriseFilters, activeBlockFilter, activeUnitFilter, customerNameFilter, subjectFilter, subsubjectFilter, includeInactive, viewMode, initialTicketId, onTicketOpened, refreshKey])

  async function syncNow() {
    setSyncing(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ importedCount: number }>('/api/tickets/sync', { method: 'POST' })
      setNotice({ kind: 'success', text: `Sincronização concluída. ${result.importedCount} chamado(s) ativo(s) importado(s).` })
      setRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível sincronizar com o CVCRM.' })
    } finally {
      setSyncing(false)
    }
  }

  async function handleCreateByProtocol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!protocolInput.trim()) return
    setLookingUpProtocol(true)
    setProtocolError('')
    try {
      const result = await apiRequest<{ ticket: TicketSummary }>('/api/tickets/by-protocol', {
        method: 'POST',
        body: JSON.stringify({ protocol: protocolInput.trim() }),
      })
      setShowProtocolModal(false)
      setProtocolInput('')
      setNotice({ kind: 'success', text: `Chamado com protocolo #${result.ticket.protocol} criado e carregado do CVCRM com sucesso!` })
      setRefreshKey((current) => current + 1)
      if (result.ticket) {
        try {
          const loaded = await apiRequest<{ tickets: TicketSummary[] }>(`/api/tickets?id=${encodeURIComponent(result.ticket.id)}`)
          if (loaded.tickets[0]) setSelected(loaded.tickets[0])
        } catch (error) {
          setNotice({ kind: 'error', text: `Chamado importado, mas não foi possível carregar os dados completos: ${error instanceof Error ? error.message : 'falha na consulta local'}` })
        }
      }
    } catch (err) {
      setProtocolError(err instanceof Error ? err.message : 'Não foi possível buscar o protocolo no CVCRM.')
    } finally {
      setLookingUpProtocol(false)
    }
  }

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await apiRequest('/api/tickets/tags', {
        method: 'POST',
        body: JSON.stringify({ name: newTagName, color: newTagColor }),
      })
      setNewTagName('')
      setRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar a tag.' })
    }
  }

  async function deleteTag(tag: TicketTag) {
    if (!window.confirm(`Excluir a tag "${tag.name}" de todos os chamados?`)) return
    try {
      await apiRequest(`/api/tickets/tags/${tag.id}`, { method: 'DELETE' })
      setRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir a tag.' })
    }
  }

  async function saveTicketTags(ticketId: string, tagIds: string[]) {
    await apiRequest(`/api/tickets/${ticketId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds: tagIds.map(Number) }),
    })
    const currentTicket = tickets.find((ticket) => ticket.id === ticketId)
    if (!currentTicket) return
    const systemTags = (currentTicket?.tags ?? []).filter((tag) => tag.id.startsWith('system-'))
    const updatedTicket = {
      ...currentTicket,
      tags: [...systemTags, ...tagOptions.filter((tag) => tagIds.includes(tag.id))],
    }
    setTickets((current) => current.map((ticket) => ticket.id === ticketId ? updatedTicket : ticket))
    setSelected((current) => current?.id === ticketId ? updatedTicket : current)
  }

  async function saveSignedTerm(ticket: TicketSummary, bytes: Uint8Array) {
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    await apiRequest(`/api/tickets/${ticket.id}/completion-terms`, {
      method: 'POST',
      body: JSON.stringify({ contentBase64: btoa(binary) }),
    })
    setNotice({ kind: 'success', text: `Termo assinado do protocolo #${ticket.protocol} salvo no cartão.` })
    setRefreshKey((current) => current + 1)
  }

  async function downloadCompletionTerm(ticketId: string, term: CompletionTermFile) {
    try {
      const response = await fetch(`/api/tickets/${ticketId}/attachments/${term.id}`, { credentials: 'include' })
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(result?.error || 'Não foi possível abrir o termo salvo.')
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = term.file_name
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir o termo salvo.' })
    }
  }

  async function deleteCompletionTerm(ticket: TicketSummary, term: CompletionTermFile) {
    if (!window.confirm(`Excluir o termo assinado "${term.file_name}" do protocolo #${ticket.protocol}?`)) return
    try {
      await apiRequest(`/api/tickets/${ticket.id}/completion-terms/${term.id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: `Termo excluído do protocolo #${ticket.protocol}.` })
      setRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o termo.' })
    }
  }

  const filtered = useMemo(
    () => [...tickets].sort((left, right) => compareTickets(left, right, sortField, sortDirection)),
    [tickets, sortField, sortDirection],
  )
  const ticketPaginationKey = JSON.stringify([
    search, enterpriseFilters, activeBlockFilter, activeUnitFilter, customerNameFilter,
    subjectFilter, subsubjectFilter, includeInactive, sortField, sortDirection, refreshKey,
  ])
  const ticketListKey = JSON.stringify([ticketPaginationKey, filtered.map((ticket) => ticket.id)])
  const [ticketListPageState, setTicketListPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 })
  const ticketListPage = ticketListPageState.key === ticketListKey ? ticketListPageState.page : 1
  const ticketListPageCount = Math.max(1, Math.ceil(filtered.length / listPageSize))
  const currentTicketListPage = Math.min(ticketListPage, ticketListPageCount)
  const pagedTickets = filtered.slice((currentTicketListPage - 1) * listPageSize, currentTicketListPage * listPageSize)
  const visibleTicketCounts = ticketPagination.key === ticketPaginationKey ? ticketPagination.counts : {}
  function loadMoreTickets(columnKey: string, visibleCount: number) {
    setTicketPagination((current) => ({
      key: ticketPaginationKey,
      counts: { ...(current.key === ticketPaginationKey ? current.counts : {}), [columnKey]: visibleCount + kanbanPageSize },
    }))
  }
  const orderedStages = stages
    .filter((stage) => stage.name.trim().length > 0)
    .sort((left, right) => left.position - right.position || ticketSortCollator.compare(left.name, right.name))
  const filteredStatusIds = new Set(filtered.map((ticket) => ticket.statusId).filter((statusId): statusId is number => statusId !== null))
  const visibleStages = orderedStages.filter((stage) => filteredStatusIds.has(stage.id))
  const unassignedTickets = filtered.filter((ticket) => !ticket.statusId || !orderedStages.some((stage) => stage.id === ticket.statusId))

  function moveKanban(direction: -1 | 1) {
    const board = kanbanBoardRef.current
    if (!board) return
    const column = board.querySelector<HTMLElement>('.kanban-column')
    const distance = column ? column.offsetWidth + 12 : Math.max(board.clientWidth * 0.8, 260)
    board.scrollBy({ left: direction * distance, behavior: 'smooth' })
  }

  function startKanbanDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    kanbanDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    }
  }

  function moveKanbanDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = kanbanDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !(event.buttons & 1)) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 5) {
      if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId)
      drag.moved = true
      event.currentTarget.classList.add('is-dragging')
    }
    if (drag.moved) event.currentTarget.scrollLeft = drag.scrollLeft - delta
  }

  function endKanbanDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = kanbanDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressKanbanClickRef.current = true
      window.setTimeout(() => { suppressKanbanClickRef.current = false }, 100)
    }
    kanbanDragRef.current = null
    event.currentTarget.classList.remove('is-dragging')
  }

  if (selected) {
    return <>
      <TicketDetailPage
        ticket={selected}
        tickets={tickets}
        currentUser={currentUser}
        completionTerms={completionTerms.filter((term) => term.ticket_id === selected.id)}
        onGenerateTerm={() => setTermTicket(selected)}
        onDownloadTerm={(term) => void downloadCompletionTerm(selected.id, term)}
        onDeleteTerm={(term) => void deleteCompletionTerm(selected, term)}
        onTagsChanged={(tagIds) => saveTicketTags(selected.id, tagIds)}
        onBack={() => { setSelected(null); setRefreshKey((current) => current + 1) }}
        onNotice={(value) => setNotice(value)}
      />
      {termTicket && <CompletionTermModal ticket={termTicket} currentUserName={currentUser.displayName} onClose={() => setTermTicket(null)} onSaveSignedPdf={(bytes) => saveSignedTerm(termTicket, bytes)} />}
    </>
  }

  return (
    <section className={`ticket-board-page${!selected && viewMode === 'kanban' ? ' ticket-board-kanban' : ''}`}>
      <div className="ticket-board-heading">
        <div><span className="eyebrow">ATENDIMENTOS CVCRM</span><h1>Chamados</h1><p>Quadro por situação do workflow do Construtor de Vendas.</p></div>
        <div className="ticket-board-actions">
          <button
            type="button"
            className="primary-button highlight-action-btn"
            onClick={() => { setShowProtocolModal(true); setProtocolError('') }}
          >
            <Plus size={15} /> Novo chamado por protocolo
          </button>
          {onOpenValidation && (
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenValidation}
              title="Abrir tela de validação da API"
            >
              <Zap size={14} /> Validação da API
            </button>
          )}
          <span className={`cvcrm-connection ${configured ? 'is-connected' : 'is-unconfigured'}`}>
            <i />{configured ? 'CVCRM configurado' : 'CVCRM pendente'}
          </span>
          {canManageIntegration && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing || !configured}
            >
              <RefreshCw size={15} className={syncing ? 'spin-icon' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
          )}
        </div>
      </div>

      {/* Modal para Adicionar Chamado por Protocolo */}
      {showProtocolModal && (
        <div className="protocol-lookup-modal-backdrop" onClick={() => setShowProtocolModal(false)}>
          <div className="protocol-lookup-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <span className="eyebrow">CADASTRO DIRETO VIA API</span>
                <h2>Buscar protocolo no CVCRM</h2>
                <p>O sistema consultará o CVCRM via API e importará os dados deste chamado.</p>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setShowProtocolModal(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={(e) => void handleCreateByProtocol(e)}>
              <label className="ticket-form-field">
                <span><Search size={14} /> Número do Protocolo</span>
                <input
                  type="text"
                  value={protocolInput}
                  onChange={(e) => setProtocolInput(e.target.value)}
                  placeholder="Ex: 2024-00123 ou 12345"
                  autoFocus
                  required
                />
              </label>

              {protocolError && <p className="form-error" role="alert">{protocolError}</p>}

              <footer className="dialog-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowProtocolModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={lookingUpProtocol || !protocolInput.trim()}
                >
                  {lookingUpProtocol ? 'Consultando CVCRM...' : 'Buscar e Importar Chamado'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
      {!configured && <div className="ticket-setup-note"><ShieldCheck size={17} /><div><strong>Integração CVCRM ainda não configurada</strong><span>Defina subdomínio, e-mail e token no `.env` do backend. As instruções estão no README.</span></div></div>}
      {syncState?.last_finished_at && <p className="ticket-sync-meta">Última sincronização: {formatDate(syncState.last_finished_at)} · {syncState.imported_count} ativos{syncState.last_success === false && syncState.error_message ? ` · ${syncState.error_message}` : ''}</p>}

      <section className="ticket-filter-panel">
        <button className="ticket-filter-toggle" type="button" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((expanded) => !expanded)}>
          <ChevronDown size={15} />
          {filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
          {!filtersExpanded && <span>{[search, ...enterpriseFilters, blockFilter, unitFilter, customerNameFilter, subjectFilter, subsubjectFilter, includeInactive && 'inativos'].filter(Boolean).length} filtro(s)</span>}
        </button>
        {filtersExpanded && <div className="ticket-board-toolbar ticket-board-filters">
        <label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Protocolo, assunto ou empreendimento" aria-label="Pesquisar chamados" /></label>
        <details className="enterprise-multiselect">
          <summary><span>Empreendimentos</span><strong>{enterpriseFilters.length ? `${enterpriseFilters.length} selecionado${enterpriseFilters.length === 1 ? '' : 's'}` : 'Todos'}</strong><ChevronDown size={15} /></summary>
          <div className="enterprise-multiselect-popover">
            <header><strong>Filtrar empreendimentos</strong><button type="button" onClick={() => setEnterpriseFilters([])} disabled={!enterpriseFilters.length}>Limpar</button></header>
            <div className="enterprise-multiselect-options">
              {enterpriseOptions.length ? enterpriseOptions.map((value) => (
                <label key={value}><input type="checkbox" checked={enterpriseFilters.includes(value)} onChange={() => setEnterpriseFilters((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} /><span>{value}</span></label>
              )) : <span className="filter-options-empty">Nenhum empreendimento disponível.</span>}
            </div>
          </div>
        </details>
        <label className="filter-control"><span>Bloco</span><select value={activeBlockFilter} disabled={!blockOptionsReady} onChange={(event) => setBlockFilter(event.target.value)}><option value="">Todos</option>{blockOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Unidade</span><select value={activeUnitFilter} disabled={!blockOptionsReady} onChange={(event) => setUnitFilter(event.target.value)}><option value="">Todas</option>{unitOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Assunto</span><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="">Todos</option>{subjectOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control"><span>Subassunto</span><select value={subsubjectFilter} onChange={(event) => setSubsubjectFilter(event.target.value)}><option value="">Todos</option>{subsubjectOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="filter-control customer-name-filter"><span>Nome do cliente</span><input type="search" value={customerNameFilter} onChange={(event) => setCustomerNameFilter(event.target.value)} placeholder="Filtrar cliente" /></label>
        <button className="filter-clear-button" type="button" disabled={!search && !enterpriseFilters.length && !blockFilter && !unitFilter && !customerNameFilter && !subjectFilter && !subsubjectFilter && !includeInactive} onClick={() => {
          setSearch('')
          setEnterpriseFilters([])
          setBlockFilter('')
          setUnitFilter('')
          setCustomerNameFilter('')
          setSubjectFilter('')
          setSubsubjectFilter('')
          setIncludeInactive(false)
        }}><X size={14} /> Limpar filtros</button>
        <label className="ticket-include-inactive"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /><span>Mostrar finalizados e cancelados</span></label>
        <span className="ticket-filter-count"><Clock3 size={14} /> {filtered.length} chamado(s){includeInactive ? '' : ' ativo(s)'}</span>
        </div>}
        <div className="ticket-board-toolbar ticket-board-options">
        {currentUser.role === 'admin' && <details className="ticket-tag-manager">
          <summary><Tag size={14} /> Gerenciar tags</summary>
          <form onSubmit={(event) => void createTag(event)}><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={60} placeholder="Nome da tag" required /><input aria-label="Cor da tag" type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} /><button className="primary-button" type="submit">Criar</button></form>
          <div>{tagOptions.map((tag) => <span className="ticket-tag-manager-item" key={tag.id}><i style={{ backgroundColor: tag.color }} />{tag.name}<button type="button" onClick={() => void deleteTag(tag)} aria-label={`Excluir tag ${tag.name}`}>×</button></span>)}</div>
        </details>}
        <div className="ticket-view-toggle" role="group" aria-label="Modo de visualização">
          <button type="button" className={viewMode === 'kanban' ? 'is-active' : ''} onClick={() => setViewMode('kanban')}><LayoutGrid size={14} /> Quadro</button>
          <button type="button" className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')}><List size={14} /> Lista</button>
        </div>
        {viewMode === 'kanban' && <details className="ticket-card-fields">
          <summary>Campos do cartão</summary>
          <div>{([
            ['customer', 'Cliente'], ['description', 'Descrição'], ['warranty', 'Garantia'],
            ['age', 'Tempo aberto'], ['counts', 'Comentários / subtarefas / programações'], ['tags', 'Tags'],
          ] as [TicketCardField, string][]).map(([field, label]) => (
            <label key={field}><input type="checkbox" checked={cardFields.includes(field)} onChange={() => setCardFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} /><span>{label}</span></label>
          ))}</div>
        </details>}
        <label className="ticket-sort-control"><span>Ordenar por</span><select value={sortField} onChange={(event) => setSortField(event.target.value as TicketSortField)}>{ticketSortFields.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="ticket-sort-direction" type="button" onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')} aria-label={`Ordenação ${sortDirection === 'asc' ? 'crescente' : 'decrescente'}; clique para inverter`}>
          {sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          {sortDirection === 'asc' ? 'Crescente' : 'Decrescente'}
        </button>
        </div>
      </section>
      {loading ? <div className="ticket-loading">Carregando chamados...</div> : viewMode === 'list' ? (
        <>
          <TicketList tickets={pagedTickets} stages={orderedStages} onOpen={setSelected} />
          <ListPagination total={filtered.length} page={currentTicketListPage} pageCount={ticketListPageCount} pageSize={listPageSize} onPageChange={(page) => setTicketListPageState({ key: ticketListKey, page })} />
        </>
      ) : orderedStages.length === 0 ? <div className="ticket-board-empty"><ClipboardListIcon /><strong>Workflow ainda não carregado</strong><span>Configure a API e sincronize os atendimentos para trazer as etapas do CVCRM.</span></div> : filtered.length === 0 ? <div className="ticket-board-empty"><ClipboardListIcon /><strong>Nenhum chamado corresponde aos filtros.</strong></div> : (
        <div className="kanban-board-container">
          <div className="kanban-board-controls" aria-label="Navegação das situações">
            <span>Deslize ou arraste para ver outras situações</span>
            <button type="button" aria-label="Mostrar situações anteriores" title="Mostrar situações anteriores" onClick={() => moveKanban(-1)}><ChevronLeft size={17} /></button>
            <button type="button" aria-label="Mostrar próximas situações" title="Mostrar próximas situações" onClick={() => moveKanban(1)}><ChevronRight size={17} /></button>
          </div>
          <div
            className="kanban-board"
            aria-label="Quadro Kanban de chamados"
            ref={kanbanBoardRef}
            onPointerDown={startKanbanDrag}
            onPointerMove={moveKanbanDrag}
            onPointerUp={endKanbanDrag}
            onPointerCancel={endKanbanDrag}
            onClickCapture={(event) => {
              if (suppressKanbanClickRef.current) {
                event.preventDefault()
                event.stopPropagation()
                suppressKanbanClickRef.current = false
              }
            }}
          >
            {visibleStages.map((stage) => {
              const stageTickets = filtered.filter((ticket) => ticket.statusId === stage.id)
              const visibleCount = visibleTicketCounts[String(stage.id)] ?? kanbanPageSize
              const ticketsToShow = stageTickets.slice(0, visibleCount)
              return <section className="kanban-column" key={stage.id}>
                <header className="kanban-column-header" style={{ borderTopColor: safeColor(stage.background_color, '#2877b8') }}><span className="kanban-stage-name" style={{ color: '#18344d' }}>{stage.name}</span><span className="kanban-stage-count">{stageTickets.length}</span></header>
                <div className="kanban-column-body">
                  {ticketsToShow.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} clock={clock} fields={cardFields} onOpen={() => setSelected(ticket)} />)}
                  {ticketsToShow.length < stageTickets.length && <button className="kanban-load-more" type="button" onClick={() => loadMoreTickets(String(stage.id), visibleCount)}>Carregar mais ({Math.min(kanbanPageSize, stageTickets.length - visibleCount)})</button>}
                </div>
              </section>
            })}
            {unassignedTickets.length > 0 && (() => {
              const key = 'unassigned'
              const visibleCount = visibleTicketCounts[key] ?? kanbanPageSize
              const ticketsToShow = unassignedTickets.slice(0, visibleCount)
              return <section className="kanban-column" key={key}><header className="kanban-column-header"><span className="kanban-stage-name">Sem situação</span><span className="kanban-stage-count">{unassignedTickets.length}</span></header><div className="kanban-column-body">{ticketsToShow.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} clock={clock} fields={cardFields} onOpen={() => setSelected(ticket)} />)}{ticketsToShow.length < unassignedTickets.length && <button className="kanban-load-more" type="button" onClick={() => loadMoreTickets(key, visibleCount)}>Carregar mais ({Math.min(kanbanPageSize, unassignedTickets.length - visibleCount)})</button>}</div></section>
            })()}
          </div>
        </div>
      )}
    </section>
  )
}

function ListPagination({ total, page, pageCount, pageSize, onPageChange }: {
  total: number
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return <nav className="list-pagination" aria-label="Paginação da lista">
    <span>{first}–{last} de {total}</span>
    <div>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span>Página {page} de {pageCount}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Próxima</button>
    </div>
  </nav>
}

function ClipboardListIcon() {
  return <UsersRound size={24} />
}

function TicketTagPills({ tags }: { tags: TicketTag[] }) {
  if (!tags.length) return null
  return <span className="ticket-tag-pills">{tags.map((tag) => <span key={tag.id} style={{ borderColor: tag.color, color: tag.color }}>{tag.name}</span>)}</span>
}

function TicketCard({ ticket, clock, fields, onOpen }: {
  ticket: TicketSummary
  clock: number
  fields: TicketCardField[]
  onOpen: () => void
}) {
  const openSeconds = ticket.openedAt
    ? Math.max(0, Math.floor((clock - new Date(ticket.openedAt).getTime()) / 1000))
    : null
  return (
    <article className="ticket-card">
      <button className="ticket-card-open" type="button" onClick={onOpen} aria-label={`Abrir chamado ${ticket.id}, protocolo ${ticket.protocol}`}>
        <span className="ticket-card-top"><span><strong>ID {ticket.id}</strong><small>Protocolo #{ticket.protocol}</small></span>{!ticket.sourceActive ? <span className="ticket-archived-badge">Inativo</span> : ticket.priority && <span className="ticket-priority">{ticket.priority}</span>}</span>
        <span className="ticket-card-enterprise">{ticket.enterprise || 'Empreendimento não informado'}{ticket.block ? ` · Bloco ${ticket.block}` : ''}{ticket.unit ? ` · Unidade ${ticket.unit}` : ''}</span>
        <span className="ticket-card-subject">{ticket.subject || 'Sem assunto'}{ticket.subsubject ? <small>{ticket.subsubject}</small> : null}</span>
        {fields.includes('tags') && <TicketTagPills tags={ticket.tags ?? []} />}
        {fields.includes('warranty') && ticket.warranty && <span className={`ticket-warranty-badge warranty-${ticket.warranty.status}`} title={ticket.warranty.reason}><ShieldCheck size={12} />{warrantyLabel(ticket.warranty.status)}</span>}
        {fields.includes('customer') && <span className="ticket-card-customer sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar os dados do cliente"><UserRound size={13} />{ticket.customerName || 'Cliente não informado'}</span>}
        {fields.includes('customer') && ticket.customerPhone && <span className="ticket-card-phone sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar o telefone">{ticket.customerPhone}</span>}
        {fields.includes('description') && <span className="ticket-card-description">{ticket.description || 'Sem descrição registrada.'}</span>}
        {fields.includes('age') && <span className="ticket-card-age"><Clock3 size={13} />{formatAge(openSeconds)}</span>}
        {fields.includes('counts') && <span className="ticket-card-meta"><span><MessageCircle size={13} /> {ticket.commentCount}</span><span><Check size={13} /> {ticket.completedSubtaskCount}/{ticket.subtaskCount}</span><span><CalendarClock size={13} /> {ticket.programmingCount}</span></span>}
      </button>
      <div className="ticket-card-footer">
        <span>{ticket.localDueAt ? `Prazo ${formatDate(ticket.localDueAt)}` : 'Sem prazo local'}</span>
      </div>
    </article>
  )
}

function TicketList({ tickets, stages, onOpen }: {
  tickets: TicketSummary[]
  stages: TicketWorkflowStage[]
  onOpen: (ticket: TicketSummary) => void
}) {
  const statusById = new Map(stages.map((stage) => [stage.id, stage.name]))
  if (!tickets.length) return <div className="ticket-board-empty"><ClipboardListIcon /><strong>Nenhum chamado corresponde aos filtros.</strong></div>
  return <div className="ticket-list-wrap"><table className="ticket-list">
    <thead><tr><th>ID / Protocolo</th><th>Situação</th><th>Empreendimento</th><th>Assunto / Subassunto</th><th>Tags</th><th>Abertura</th><th><span className="sr-only">Abrir chamado</span></th></tr></thead>
    <tbody>{tickets.map((ticket) => <tr key={ticket.id}>
      <td><strong>ID {ticket.id}</strong><small>#{ticket.protocol}</small></td>
      <td>{ticket.statusId ? statusById.get(ticket.statusId) ?? ticket.status : ticket.status}{!ticket.sourceActive && <small className="ticket-list-archived">Inativo</small>}</td>
      <td>{ticket.enterprise || '—'}{ticket.block && ` · Bloco ${ticket.block}`}{ticket.unit && ` · Unidade ${ticket.unit}`}</td>
      <td><strong>{ticket.subject || 'Sem assunto'}</strong><small>{ticket.subsubject || 'Sem subassunto'}</small></td>
      <td><TicketTagPills tags={ticket.tags ?? []} /></td>
      <td>{ticket.openedAt ? new Date(ticket.openedAt).toLocaleDateString('pt-BR') : '—'}</td>
      <td><button className="text-action-btn" type="button" onClick={() => onOpen(ticket)}>Abrir</button></td>
    </tr>)}</tbody>
  </table></div>
}

function TicketDetailPage({ ticket, tickets, currentUser, completionTerms, onGenerateTerm, onDownloadTerm, onDeleteTerm, onTagsChanged, onBack, onNotice }: {
  ticket: TicketSummary
  tickets: TicketSummary[]
  currentUser: { id: number; role: 'admin' | 'member'; displayName: string }
  completionTerms: CompletionTermFile[]
  onGenerateTerm: () => void
  onDownloadTerm: (term: CompletionTermFile) => void
  onDeleteTerm: (term: CompletionTermFile) => void
  onTagsChanged: (tagIds: string[]) => Promise<void>
  onBack: () => void
  onNotice: (notice: { kind: 'success' | 'error'; text: string } | null) => void
}) {
  const [comments, setComments] = useState<TicketComment[]>([])
  const [subtasks, setSubtasks] = useState<TicketSubtask[]>([])
  const [programming, setProgramming] = useState<TicketProgramming[]>([])
  const [people, setPeople] = useState<TeamMentionTarget[]>([])
  const [history, setHistory] = useState<TicketHistoryEntry[]>([])
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [cvMessages, setCvMessages] = useState<CvTicketMessage[]>([])
  const [cvAttachments, setCvAttachments] = useState<CvTicketAttachment[]>([])
  const [ticketTags, setTicketTags] = useState<TicketTag[]>(ticket.tags ?? [])
  const [tagOptions, setTagOptions] = useState<TicketTag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() =>
    (ticket.tags ?? []).filter((tag) => !tag.id.startsWith('system-')).map((tag) => tag.id),
  )
  const [showHistory, setShowHistory] = useState(false)
  const [comment, setComment] = useState('')
  const [mentions, setMentions] = useState<number[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionCursor, setMentionCursor] = useState<number | null>(null)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [editingComment, setEditingComment] = useState<TicketComment | null>(null)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [management, setManagement] = useState({ due: localInput(ticket.localDueAt), estimatedCost: ticket.estimatedCost ?? '', actualCost: ticket.actualCost ?? '' })
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<TicketProgramming | null>(null)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [updatingProgramming, setUpdatingProgramming] = useState<Set<string>>(() => new Set())
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiRequest<{ comments: TicketComment[] }>(`/api/tickets/${ticket.id}/comments`),
      apiRequest<{ subtasks: TicketSubtask[] }>(`/api/tickets/${ticket.id}/subtasks`),
      apiRequest<{ programming: TicketProgramming[] }>(`/api/programming/ticket/${ticket.id}`),
      apiRequest<{ people: TeamMentionTarget[] }>('/api/team/mentions'),
      apiRequest<{ history: TicketHistoryEntry[] }>(`/api/tickets/${ticket.id}/history`),
      apiRequest<{ attachments: TicketAttachment[] }>(`/api/tickets/${ticket.id}/attachments`),
      apiRequest<{ messages: CvTicketMessage[]; attachments: CvTicketAttachment[] }>(`/api/tickets/${ticket.id}/cv-conversation`),
      apiRequest<{ tags: TicketTag[] }>('/api/tickets/tags'),
    ]).then(([commentsResult, subtasksResult, programmingResult, peopleResult, historyResult, attachmentResult, conversation, tags]) => {
      if (cancelled) return
      setComments(commentsResult.comments)
      setSubtasks(subtasksResult.subtasks)
      setProgramming(programmingResult.programming)
      setPeople(peopleResult.people)
      setHistory(historyResult.history)
      setAttachments(attachmentResult.attachments)
      setCvMessages(conversation.messages)
      setCvAttachments(conversation.attachments)
      setTicketTags(ticket.tags ?? [])
      setTagOptions(tags.tags)
      setSelectedTagIds((ticket.tags ?? []).filter((tag) => !tag.id.startsWith('system-')).map((tag) => tag.id))
    }).catch((requestError: unknown) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os detalhes do chamado.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticket.id, ticket.tags, refresh])

  async function toggleTicketTag(tagId: string, enabled: boolean) {
    const nextIds = enabled
      ? [...new Set([...selectedTagIds, tagId])]
      : selectedTagIds.filter((id) => id !== tagId)
    setSelectedTagIds(nextIds)
    setError('')
    try {
      await onTagsChanged(nextIds)
      setTicketTags((current) => [
        ...current.filter((tag) => tag.id.startsWith('system-')),
        ...tagOptions.filter((tag) => nextIds.includes(tag.id)),
      ])
    } catch (requestError) {
      setSelectedTagIds(selectedTagIds)
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar as tags do chamado.')
    }
  }

  async function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: comment,
          mentionIds: mentions.filter((id) => {
            const person = people.find((entry) => Number(entry.id) === id)
            return person && comment.includes(`@${person.displayName}`)
          }),
          parentCommentId: replyingTo ? Number(replyingTo) : null,
        }),
      })
      setComment('')
      setMentions([])
      setReplyingTo(null)
      setMentionQuery(null)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível adicionar o comentário.')
    } finally { setBusy(false) }
  }

  function updateCommentText(value: string, cursor: number) {
    setComment(value)
    setMentionCursor(cursor)
    setMentions((current) => current.filter((id) => {
      const person = people.find((entry) => Number(entry.id) === id)
      return person && value.includes(`@${person.displayName}`)
    }))
    const atIndex = value.lastIndexOf('@', cursor - 1)
    if (atIndex >= 0 && !/\s/.test(value.slice(atIndex + 1, cursor))) {
      setMentionStart(atIndex)
      setMentionQuery(value.slice(atIndex + 1, cursor).toLocaleLowerCase('pt-BR'))
    } else {
      setMentionStart(null)
      setMentionQuery(null)
    }
  }

  function insertMention(person: TeamMentionTarget) {
    if (mentionStart === null || mentionCursor === null) return
    const before = comment.slice(0, mentionStart)
    const after = comment.slice(mentionCursor)
    const token = `@${person.displayName} `
    setComment(`${before}${token}${after}`)
    setMentions((current) => [...new Set([...current, Number(person.id)])])
    setMentionStart(null)
    setMentionQuery(null)
    setMentionCursor(null)
  }

  async function editComment(entry: TicketComment, body: string) {
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/tickets/${ticket.id}/comments/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      })
      setEditingComment(null)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível editar o comentário.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteComment(entry: TicketComment) {
    if (!window.confirm('Excluir este comentário? A ação ficará registrada no histórico do chamado.')) return
    try {
      await apiRequest(`/api/tickets/${ticket.id}/comments/${entry.id}`, { method: 'DELETE' })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir o comentário.')
    }
  }

  async function deleteProgramming(entry: TicketProgramming) {
    if (!window.confirm(`Excluir a programação de ${entry.collaborator_name}?`)) return
    try {
      await apiRequest(`/api/programming/${entry.id}`, { method: 'DELETE' })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir a programação.')
    }
  }

  async function updateProgrammingCompletion(entry: TicketProgramming, completed: boolean) {
    setUpdatingProgramming((current) => new Set(current).add(entry.id))
    setError('')
    try {
      await apiRequest(`/api/programming/${entry.id}/completion`, {
        method: 'PATCH',
        body: JSON.stringify({ completed }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar a realização da programação.')
    } finally {
      setUpdatingProgramming((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }

  async function uploadAttachment(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Cada anexo pode ter no máximo 5 MiB.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      await apiRequest(`/api/tickets/${ticket.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBase64: btoa(binary),
        }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível anexar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  async function downloadAttachment(entry: TicketAttachment) {
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/attachments/${entry.id}`, { credentials: 'include' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? 'Não foi possível baixar o anexo.')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = entry.file_name
      link.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível baixar o anexo.')
    }
  }

  async function createSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/tickets/${ticket.id}/subtasks`, { method: 'POST', body: JSON.stringify({ title: subtaskTitle }) })
      setSubtaskTitle('')
      setShowSubtaskForm(false)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível adicionar a subtarefa.')
    } finally { setBusy(false) }
  }

  async function toggleSubtask(subtask: TicketSubtask) {
    try {
      await apiRequest(`/api/tickets/${ticket.id}/subtasks/${subtask.id}`, { method: 'PATCH', body: JSON.stringify({ isDone: !subtask.is_done }) })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar a subtarefa.')
    }
  }

  async function saveManagement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/tickets/${ticket.id}/management`, {
        method: 'PATCH',
        body: JSON.stringify({
          localDueAt: management.due ? new Date(management.due).toISOString() : null,
          estimatedCost: management.estimatedCost === '' ? null : Number(management.estimatedCost),
          actualCost: management.actualCost === '' ? null : Number(management.actualCost),
        }),
      })
      onNotice({ kind: 'success', text: 'Prazo e custos atualizados.' })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar prazo e custos.')
    } finally { setBusy(false) }
  }

  return (
    <section className="ticket-detail-page">
      <header className="ticket-detail-heading"><button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={15} /> Voltar ao Kanban</button><span className="eyebrow">CHAMADO · CVCRM</span><h1>Protocolo {ticket.protocol}</h1><p>{ticket.enterprise} {ticket.block ? `· Bloco ${ticket.block}` : ''} {ticket.unit ? `· Unidade ${ticket.unit}` : ''}</p>{!ticket.sourceActive && <span className="ticket-archived-notice">Chamado finalizado ou cancelado — histórico preservado</span>}</header>
      <div className="ticket-detail-status"><span>{ticket.status}</span></div>
      {ticket.warranty && <section className={`ticket-warranty-detail warranty-${ticket.warranty.status}`} aria-label="Situação da garantia">
        <ShieldCheck size={18} />
        <div><strong>{warrantyLabel(ticket.warranty.status)}</strong><p>{ticket.warranty.reason}</p>
          {ticket.warranty.deliveryDate && <small>Entrega: {formatWarrantyDate(ticket.warranty.deliveryDate)}{ticket.warranty.warrantyYears !== null ? ` · Prazo: ${ticket.warranty.warrantyYears} ${ticket.warranty.warrantyYears === 1 ? 'ano' : 'anos'}` : ''}{ticket.warranty.expiresAt ? ` · Vencimento: ${formatWarrantyDate(ticket.warranty.expiresAt)}` : ''}</small>}
        </div>
      </section>}
      {error && <div className="notice notice-error" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="ticket-detail-grid">
        <div className="ticket-detail-main">
          <section className="ticket-info-section ticket-detail-tags"><div className="ticket-section-heading"><div><h2>Tags do chamado</h2><p>Classificação automática e etiquetas personalizadas.</p></div></div>
            <TicketTagPills tags={ticketTags} />
            <details className="ticket-tag-assignment"><summary>Editar tags personalizadas</summary><div>{tagOptions.map((tag) => <label key={tag.id}><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={(event) => void toggleTicketTag(tag.id, event.target.checked)} /><span style={{ color: tag.color }}>{tag.name}</span></label>)}</div></details>
          </section>
          <section className="ticket-info-section"><h2>Dados do atendimento</h2><div className="ticket-facts"><div><span>Cliente</span><strong className="sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar">{ticket.customerName || 'Não informado'}</strong></div><div><span>Telefone</span><strong className="sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar">{ticket.customerPhone || 'Não informado'}</strong></div><div><span>Assunto</span><strong>{ticket.subject}</strong></div><div><span>Subassunto</span><strong>{ticket.subsubject || 'Não informado'}</strong></div><div><span>Aberto em</span><strong>{formatDate(ticket.openedAt)}</strong></div><div><span>Tempo aberto</span><strong>{formatAge(ticket.openSeconds)}</strong></div></div><div className="ticket-opening-description"><span>Descrição informada na abertura</span><p>{ticket.description || 'O CVCRM não retornou uma descrição para este atendimento.'}</p></div></section>

          <section className="ticket-info-section cv-conversation-section"><div className="ticket-section-heading"><div><h2>Mensagens do CVCRM</h2><p>{cvMessages.length} resposta(s) sincronizada(s) do chamado.</p></div></div>
            {cvMessages.length ? <ol>{cvMessages.map((message) => <li key={message.id}><header><strong>{message.author || 'CVCRM'}</strong><time>{formatDate(message.createdAt || null)}</time></header>{message.body && <p>{cvMessageText(message.body)}</p>}{message.attachments.length > 0 && <ul>{message.attachments.map((file, index) => <li key={file.id ?? `${message.id}-${index}`}><Paperclip size={13} /><span>{file.name}</span>{file.url && <a href={file.url} target="_blank" rel="noreferrer">Abrir</a>}</li>)}</ul>}</li>)}</ol> : <p className="ticket-empty-inline">Nenhuma mensagem retornada pelo CVCRM na última sincronização.</p>}
            <div className="cv-attachment-list"><h3>Anexos do CVCRM ({cvAttachments.length})</h3>{cvAttachments.length ? <ul>{cvAttachments.map((file, index) => <li key={file.id ?? `${file.name}-${index}`}><Paperclip size={14} /><span><strong>{file.name}</strong><small>{file.type || 'Arquivo'}{file.size ? ` · ${file.size}` : ''}{file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}</small></span>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">Abrir</a> : <small>Link indisponível</small>}</li>)}</ul> : <p className="ticket-empty-inline">Nenhum anexo CVCRM retornado na última sincronização.</p>}</div>
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Histórico de alterações</h2><p>{history.length} evento(s) recente(s)</p></div><button className="secondary-button" type="button" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Mostrar menos' : 'Mostrar mais'}</button></div>
            {showHistory && <ol className="ticket-history-list">{history.map((entry) => <li key={entry.id}><span className="ticket-history-dot" /><div><strong>{entry.summary}</strong><p>{entry.actor_name} · {formatDate(entry.created_at)}</p></div></li>)}{history.length === 0 && <p className="ticket-empty-inline">Ainda não há alterações registradas.</p>}</ol>}
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Termo de finalização</h2><p>Gere o documento e acesse os termos assinados deste protocolo.</p></div></div>
            <div className="ticket-detail-terms">
              <button type="button" className="secondary-button" onClick={onGenerateTerm}><FileSignature size={15} /> Gerar termo de finalização</button>
              {completionTerms.length ? completionTerms.map((term) => <div className="ticket-card-saved-term" key={term.id}>
                <button type="button" className="ticket-card-saved-term-open" onClick={() => onDownloadTerm(term)} title={`Baixar ${term.file_name}`}><Download size={14} /><span>{term.file_name}</span></button>
                <small>{Math.ceil(term.file_size / 1024)} KB · {term.uploaded_by_name} · {formatDate(term.created_at)}</small>
                {(currentUser.role === 'admin' || String(term.uploaded_by) === String(currentUser.id)) && <button type="button" className="ticket-card-saved-term-delete" onClick={() => onDeleteTerm(term)} aria-label={`Excluir ${term.file_name}`} title="Excluir termo"><Trash2 size={14} /></button>}
              </div>) : <p className="ticket-empty-inline">Nenhum termo assinado salvo neste protocolo.</p>}
            </div>
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Anexos</h2><p>Arquivos internos vinculados a este chamado (até 5 MiB cada).</p></div><label className={`secondary-button attachment-upload-button ${uploading ? 'is-disabled' : ''}`}><Paperclip size={15} />{uploading ? 'Enviando...' : 'Anexar arquivo'}<input className="sr-only" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.webp,.zip" disabled={uploading} onChange={(event) => { void uploadAttachment(event.target.files?.[0]); event.currentTarget.value = '' }} /></label></div>
            {attachments.length ? <ul className="ticket-attachment-list">{attachments.map((entry) => <li key={entry.id}><Paperclip size={15} /><span><strong>{entry.file_name}</strong><small>{Math.ceil(entry.file_size / 1024)} KB · {entry.uploaded_by_name}</small></span><button className="icon-button" type="button" title={`Baixar ${entry.file_name}`} aria-label={`Baixar ${entry.file_name}`} onClick={() => void downloadAttachment(entry)}><Download size={15} /></button></li>)}</ul> : <p className="ticket-empty-inline">Nenhum anexo enviado.</p>}
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Programação de atividades</h2><p>Colaboradores, horário e descritivo do serviço.</p></div><button className="secondary-button" type="button" onClick={() => { setEditingSchedule(null); setShowScheduleForm((value) => !value) }}><Plus size={15} /> Programar</button></div>
            {(showScheduleForm || editingSchedule) && <TicketProgrammingForm tickets={tickets} initialTicketId={ticket.id} editingAppointment={editingSchedule ?? undefined} onCancel={() => { setShowScheduleForm(false); setEditingSchedule(null) }} onSaved={() => { setShowScheduleForm(false); setEditingSchedule(null); setRefresh((value) => value + 1); onNotice({ kind: 'success', text: 'Programação salva.' }) }} />}
            {programming.length ? <div className="ticket-programming-list">{programming.map((entry) => <article className="ticket-programming-item" key={entry.id}><span className="programming-time">{formatDate(entry.starts_at)}–{new Date(entry.ends_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><strong>{entry.collaborator_name}{entry.collaborator_nickname ? ` · ${entry.collaborator_nickname}` : ''}</strong><p>{entry.activity_description}</p><div className="schedule-appointment-actions"><label className={`schedule-completion-check ${entry.completed ? 'is-complete' : ''}`}><input type="checkbox" checked={entry.completed} disabled={updatingProgramming.has(entry.id)} onChange={(event) => void updateProgrammingCompletion(entry, event.target.checked)} /><span>{entry.completed ? 'Realizada' : 'Marcar como realizada'}</span></label><button type="button" className="text-action-btn" onClick={() => { setShowScheduleForm(false); setEditingSchedule(entry) }}><Pencil size={13} /> Editar</button><button type="button" className="text-action-btn danger-action" onClick={() => void deleteProgramming(entry)}><Trash2 size={13} /> Excluir</button></div></article>)}</div> : !showScheduleForm && !editingSchedule && <p className="ticket-empty-inline">Nenhuma atividade programada.</p>}
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Subtarefas</h2><p>{subtasks.filter((item) => item.is_done).length} de {subtasks.length} concluídas</p></div><button className="secondary-button" type="button" onClick={() => setShowSubtaskForm((value) => !value)}><Plus size={15} /> Nova subtarefa</button></div>
            {showSubtaskForm && <form className="ticket-subtask-form" onSubmit={(event) => void createSubtask(event)}><input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Descreva a subtarefa" maxLength={300} required /><button className="primary-button" type="submit" disabled={busy}>Adicionar</button></form>}
            {subtasks.length ? <ul className="ticket-subtask-list">{subtasks.map((subtask) => <li key={subtask.id}><label><input type="checkbox" checked={subtask.is_done} onChange={() => void toggleSubtask(subtask)} /><span className={subtask.is_done ? 'is-complete' : ''}>{subtask.title}</span></label>{subtask.assignee_name && <small>{subtask.assignee_name}</small>}{subtask.due_at && <small>{formatDate(subtask.due_at)}</small>}</li>)}</ul> : !showSubtaskForm && <p className="ticket-empty-inline">Nenhuma subtarefa.</p>}
          </section>

          <section className="ticket-info-section"><div className="ticket-section-heading"><div><h2>Comentários</h2><p>Digite @ para mencionar uma pessoa; respostas notificam quem participou da menção.</p></div><MessageCircle size={17} /></div>
            {loading ? <p className="ticket-empty-inline">Carregando conversa...</p> : <div className="ticket-comments">{comments.filter((entry) => !entry.parent_comment_id).map((entry) => {
              const replies = comments.filter((reply) => reply.parent_comment_id === entry.id)
              const canManageComment = currentUser.role === 'admin' || Number(entry.author_id) === currentUser.id
              return <article className="ticket-comment-thread" key={entry.id}><article className="ticket-comment"><div className="comment-avatar">{entry.author_name.slice(0, 1).toUpperCase()}</div><div className="ticket-comment-content"><header><strong>{entry.author_name}</strong><time>{formatDate(entry.created_at)}{entry.updated_at !== entry.created_at ? ' · editado' : ''}</time></header>{editingComment?.id === entry.id ? <form className="comment-edit-form" onSubmit={(event) => { event.preventDefault(); void editComment(entry, editingComment.body) }}><textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required /><button className="primary-button" type="submit" disabled={busy}>Salvar</button><button className="secondary-button" type="button" onClick={() => setEditingComment(null)}>Cancelar</button></form> : <p>{entry.body}</p>}{entry.mentions.length > 0 && <small>Mencionados: {entry.mentions.map((person) => person.displayName).join(', ')}</small>}<div className="comment-actions"><button className="text-action-btn" type="button" onClick={() => { setReplyingTo(entry.id); setComment('') }}><MessageCircle size={13} /> Responder</button>{canManageComment && <><button className="text-action-btn" type="button" onClick={() => setEditingComment(entry)}><Pencil size={13} /> Editar</button><button className="text-action-btn danger-action" type="button" onClick={() => void deleteComment(entry)}><Trash2 size={13} /> Excluir</button></>}</div></div></article>
                {replies.map((reply) => {
                  const canManageReply = currentUser.role === 'admin' || Number(reply.author_id) === currentUser.id
                  return <article className="ticket-comment ticket-comment-reply" key={reply.id}><div className="comment-avatar">{reply.author_name.slice(0, 1).toUpperCase()}</div><div className="ticket-comment-content"><header><strong>{reply.author_name}</strong><time>{formatDate(reply.created_at)}{reply.updated_at !== reply.created_at ? ' · editado' : ''}</time></header>{editingComment?.id === reply.id ? <form className="comment-edit-form" onSubmit={(event) => { event.preventDefault(); void editComment(reply, editingComment.body) }}><textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required /><button className="primary-button" type="submit" disabled={busy}>Salvar</button><button className="secondary-button" type="button" onClick={() => setEditingComment(null)}>Cancelar</button></form> : <p>{reply.body}</p>}<small>Resposta</small>{canManageReply && <div className="comment-actions"><button className="text-action-btn" type="button" onClick={() => setEditingComment(reply)}><Pencil size={13} /> Editar</button><button className="text-action-btn danger-action" type="button" onClick={() => void deleteComment(reply)}><Trash2 size={13} /> Excluir</button></div>}</div></article>
                })}
              </article>
            })}{comments.length === 0 && <p className="ticket-empty-inline">Ainda não há comentários.</p>}</div>}
            {replyingTo && <div className="replying-banner">Respondendo a {comments.find((entry) => entry.id === replyingTo)?.author_name ?? 'comentário'}<button type="button" className="text-action-btn" onClick={() => setReplyingTo(null)}>Cancelar</button></div>}
            <form className="ticket-comment-form" onSubmit={(event) => void postComment(event)}><div className="mention-composer"><textarea value={comment} onChange={(event) => updateCommentText(event.target.value, event.currentTarget.selectionStart)} rows={3} maxLength={6000} placeholder={replyingTo ? 'Escreva uma resposta...' : 'Escreva um comentário... Use @ para mencionar'} required />{mentionQuery !== null && <div className="mention-suggestions" role="listbox">{people.filter((person) => person.displayName.toLocaleLowerCase('pt-BR').includes(mentionQuery)).slice(0, 6).map((person) => <button key={person.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(person)}><AtSign size={13} />{person.displayName}</button>)}</div>}</div><div className="comment-form-footer">{mentions.length > 0 && <small>{mentions.length} pessoa(s) mencionada(s)</small>}<button className="primary-button" type="submit" disabled={busy || !comment.trim()}>{busy ? 'Enviando...' : replyingTo ? 'Responder' : 'Comentar'}</button></div></form>
          </section>
        </div>

        <aside className="ticket-detail-aside"><section className="ticket-info-section"><h2>Controle local</h2><form className="ticket-management-form" onSubmit={(event) => void saveManagement(event)}><label className="ticket-form-field"><span>Prazo previsto</span><input type="datetime-local" value={management.due} onChange={(event) => setManagement((current) => ({ ...current, due: event.target.value }))} /></label><label className="ticket-form-field"><span><Coins size={14} /> Custo previsto</span><input type="number" min="0" step="0.01" value={management.estimatedCost} onChange={(event) => setManagement((current) => ({ ...current, estimatedCost: event.target.value }))} /></label><label className="ticket-form-field"><span><Coins size={14} /> Custo realizado</span><input type="number" min="0" step="0.01" value={management.actualCost} onChange={(event) => setManagement((current) => ({ ...current, actualCost: event.target.value }))} /></label><button className="secondary-button" type="submit" disabled={busy}>Salvar controle</button></form><div className="ticket-cost-summary"><span>Previsto <strong>{money(ticket.estimatedCost)}</strong></span><span>Realizado <strong>{money(ticket.actualCost)}</strong></span></div></section><div className="ticket-detail-source-note"><ShieldCheck size={15} /><span>Situação é consultada no CVCRM; comentários, subtarefas e programação são dados locais da ATech.</span></div></aside>
      </div>
    </section>
  )
}
