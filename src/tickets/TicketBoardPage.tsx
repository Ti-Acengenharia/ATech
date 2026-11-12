import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AtSign,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coins,
  Download,
  FileSignature,
  FileText,
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
import { useLiveSync } from '../api/liveSync'
import CompletionTermModal from './CompletionTermModal'
import { programmingDateTimeString, programmingTimeString } from './programming-time'
import TicketProgrammingForm from './TicketProgrammingForm'
import TicketDashboardPage from './TicketDashboardPage'
import SearchableMultiSelect from '../SearchableMultiSelect'
import { ATechLoading } from '../ATechLoading'
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
  uploaded_by?: number | null
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
export type TicketViewMode = 'kanban' | 'list'
export type TicketActiveView = 'kanban' | 'list' | 'dashboard'
type TicketSortField = 'id' | 'protocol' | 'status' | 'enterprise' | 'openedAt'
type TicketSortDirection = 'asc' | 'desc'

export function resolveInitialTicketView(savedViewMode: TicketViewMode): {
  activeView: TicketActiveView
  viewMode: TicketViewMode
  dashboardOpen: boolean
} {
  if (typeof window === 'undefined') {
    return { activeView: savedViewMode, viewMode: savedViewMode, dashboardOpen: false }
  }
  const params = new URLSearchParams(window.location.search)
  const viewParam = params.get('view')?.toLowerCase()
  const pageParam = params.get('page')?.toLowerCase()
  const pathname = window.location.pathname.toLowerCase()

  // 1. Checa indicação explícita de dashboard (via query view=dashboard, alias page=ticket-dashboard ou rota /ticket-dashboard)
  if (
    viewParam === 'dashboard' ||
    pageParam === 'ticket-dashboard' ||
    pathname.includes('/ticket-dashboard') ||
    pathname.includes('/tickets/dashboard')
  ) {
    return { activeView: 'dashboard', viewMode: savedViewMode, dashboardOpen: true }
  }

  // 2. Checa se é lista
  if (viewParam === 'list') {
    return { activeView: 'list', viewMode: 'list', dashboardOpen: false }
  }

  // 3. Checa se é quadro / kanban
  if (viewParam === 'kanban' || viewParam === 'board' || viewParam === 'quadro') {
    return { activeView: 'kanban', viewMode: 'kanban', dashboardOpen: false }
  }

  // 4. Se a URL não tiver parâmetro view, recuperar preferência salva no localStorage
  try {
    const savedActive = localStorage.getItem('atech.ticket-active-view')
    if (savedActive === 'dashboard') {
      return { activeView: 'dashboard', viewMode: savedViewMode, dashboardOpen: true }
    }
    if (savedActive === 'list') {
      return { activeView: 'list', viewMode: 'list', dashboardOpen: false }
    }
    if (savedActive === 'kanban') {
      return { activeView: 'kanban', viewMode: 'kanban', dashboardOpen: false }
    }
  } catch {
    // ignore
  }

  // 5. Fallback para o viewMode salvo no cookie
  return {
    activeView: savedViewMode,
    viewMode: savedViewMode,
    dashboardOpen: false,
  }
}

interface SavedTicketFilters {
  search: string
  types: ('client' | 'condominium')[]
  enterprises: string[]
  block: string[]
  unit: string[]
  customer: string
  subject: string[]
  subsubject: string[]
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
    const values = (value: unknown, maxLength: number) => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, maxLength))
      .slice(0, 50)
    return {
      search: typeof saved.search === 'string' ? saved.search.slice(0, 100) : '',
      types: values(saved.types, 20).filter((type): type is 'client' | 'condominium' => type === 'client' || type === 'condominium'),
      enterprises: values(saved.enterprises, 240),
      block: values(saved.block, 120),
      unit: values(saved.unit, 120),
      customer: typeof saved.customer === 'string' ? saved.customer.slice(0, 160) : '',
      subject: values(saved.subject, 240),
      subsubject: values(saved.subsubject, 240),
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
    return { search: '', types: [], enterprises: [], block: [], unit: [], customer: '', subject: [], subsubject: [], includeInactive: false, viewMode: 'kanban', cardFields: defaultCardFields, sortField: 'openedAt', sortDirection: 'asc' }
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
  const [ticketTypes, setTicketTypes] = useState<('client' | 'condominium')[]>(savedFilters.types)
  const [enterpriseFilters, setEnterpriseFilters] = useState<string[]>(savedFilters.enterprises)
  const [blockFilter, setBlockFilter] = useState<string[]>(savedFilters.block)
  const [unitFilter, setUnitFilter] = useState<string[]>(savedFilters.unit)
  const [customerNameFilter, setCustomerNameFilter] = useState(savedFilters.customer)
  const [subjectFilter, setSubjectFilter] = useState<string[]>(savedFilters.subject)
  const [subsubjectFilter, setSubsubjectFilter] = useState<string[]>(savedFilters.subsubject)
  const [includeInactive, setIncludeInactive] = useState(savedFilters.includeInactive)
  const [initialViewState] = useState(() => resolveInitialTicketView(savedFilters.viewMode))
  const [viewMode, setViewMode] = useState<TicketViewMode>(initialViewState.viewMode)
  const [cardFields, setCardFields] = useState<TicketCardField[]>(savedFilters.cardFields)
  const [sortField, setSortField] = useState<TicketSortField>(savedFilters.sortField)
  const [sortDirection, setSortDirection] = useState<TicketSortDirection>(savedFilters.sortDirection)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3478a8')
  const [selected, setSelected] = useState<TicketSummary | null>(null)
  const [urlTicketId, setUrlTicketId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('ticketId')
  })
  const requestedTicketId = initialTicketId || urlTicketId

  useEffect(() => {
    const url = new URL(window.location.href)
    if (selected?.id) {
      url.searchParams.set('ticketId', selected.id)
    } else if (!requestedTicketId) {
      url.searchParams.delete('ticketId')
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [selected, requestedTicketId])
  const [dashboardOpen, setDashboardOpen] = useState(initialViewState.dashboardOpen)

  const applyViewChange = useCallback((nextView: TicketActiveView, historyAction: 'push' | 'replace' = 'push') => {
    if (typeof window === 'undefined') return

    if (nextView === 'dashboard') {
      setDashboardOpen(true)
      setSelected(null)
    } else {
      setDashboardOpen(false)
      setViewMode(nextView)
    }

    try {
      localStorage.setItem('atech.ticket-active-view', nextView)
    } catch {
      // ignore
    }

    const url = new URL(window.location.href)
    url.searchParams.set('page', 'tickets')
    url.searchParams.set('view', nextView)
    if (nextView === 'dashboard') {
      url.searchParams.delete('ticketId')
    }

    const target = `${url.pathname}${url.search}${url.hash}`
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (current !== target) {
      if (historyAction === 'replace') {
        window.history.replaceState({ page: 'tickets', view: nextView }, '', target)
      } else {
        window.history.pushState({ page: 'tickets', view: nextView }, '', target)
      }
    }

    window.dispatchEvent(new CustomEvent('atech:ticket-view-changed', { detail: { view: nextView } }))
  }, [])

  // Sincroniza a URL no primeiro carregamento para garantir que &view= esteja explícito
  useEffect(() => {
    const active: TicketActiveView = dashboardOpen ? 'dashboard' : viewMode
    const currentParam = new URLSearchParams(window.location.search).get('view')?.toLowerCase()
    if (currentParam !== active) {
      applyViewChange(active, 'replace')
    }
  }, [])

  // Ouvinte para histórico do navegador (Voltar/Avançar) e eventos externos
  useEffect(() => {
    function handlePopState() {
      const resolved = resolveInitialTicketView(savedFilters.viewMode)
      setDashboardOpen(resolved.dashboardOpen)
      setViewMode(resolved.viewMode)
      const currentUrlTicketId = new URLSearchParams(window.location.search).get('ticketId')
      setUrlTicketId(currentUrlTicketId)
      if (!currentUrlTicketId && selected) {
        setSelected(null)
      }
    }
    function handleNavigate(event: Event) {
      const detail = (event as CustomEvent<{ view?: TicketActiveView }>).detail
      if (detail?.view) {
        applyViewChange(detail.view, 'push')
      }
    }
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('atech:ticket-view-navigate', handleNavigate)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('atech:ticket-view-navigate', handleNavigate)
    }
  }, [savedFilters.viewMode, selected, applyViewChange])
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
  const blockUnitFilterKey = `${enterpriseFilterKey}|${JSON.stringify([...blockFilter].sort())}`
  const blockOptionsReady = blockUnitOptionsScope === blockUnitFilterKey
  const activeBlockFilter = useMemo(
    () => blockOptionsReady ? blockFilter.filter((value) => blockOptions.includes(value)) : [],
    [blockOptionsReady, blockFilter, blockOptions],
  )
  const activeUnitFilter = useMemo(
    () => blockOptionsReady ? unitFilter.filter((value) => unitOptions.includes(value)) : [],
    [blockOptionsReady, unitFilter, unitOptions],
  )

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

  useLiveSync(['tickets'], () => {
    setRefreshKey((k) => k + 1)
  })

  useEffect(() => {
    if (dashboardOpen) return
    let cancelled = false
    const params = new URLSearchParams()
    for (const enterprise of enterpriseFilters) params.append('enterprise', enterprise)
    for (const block of blockFilter) params.append('block', block)
    if (includeInactive) params.set('includeInactive', 'true')
    const query = params.toString()
    apiRequest<{ blocks: string[]; units: string[] }>(`/api/tickets/filter-options${query ? `?${query}` : ''}`)
      .then((options) => {
        if (cancelled) return
        setBlockOptions(options.blocks)
        setUnitOptions(options.units)
        setBlockUnitOptionsScope(blockUnitFilterKey)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar as opções de bloco e unidade.' })
      })
    return () => { cancelled = true }
  }, [enterpriseFilters, enterpriseFilterKey, blockFilter, blockUnitFilterKey, includeInactive, refreshKey, dashboardOpen])

  useEffect(() => {
    const saved = saveTicketFilters(currentUser.id, {
      search,
      types: ticketTypes,
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
  }, [currentUser.id, search, ticketTypes, enterpriseFilters, blockOptionsReady, activeBlockFilter, activeUnitFilter, blockFilter, unitFilter, customerNameFilter, subjectFilter, subsubjectFilter, includeInactive, viewMode, cardFields, sortField, sortDirection])

  useEffect(() => {
    if (dashboardOpen) return
    let cancelled = false
    apiRequest<{ terms: CompletionTermFile[] }>('/api/tickets/completion-terms')
      .then((result) => {
        if (!cancelled) setCompletionTerms(result.terms)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os termos salvos.' })
      })
    return () => { cancelled = true }
  }, [refreshKey, dashboardOpen])

  useEffect(() => {
    if (dashboardOpen) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      for (const type of ticketTypes) params.append('type', type)
      for (const enterprise of enterpriseFilters) params.append('enterprise', enterprise)
      for (const block of activeBlockFilter) params.append('block', block)
      for (const unit of activeUnitFilter) params.append('unit', unit)
      if (customerNameFilter.trim()) params.set('customerName', customerNameFilter.trim())
      for (const subject of subjectFilter) params.append('subject', subject)
      for (const subsubject of subsubjectFilter) params.append('subsubject', subsubject)
      if (includeInactive) params.set('includeInactive', 'true')
      const query = params.toString()
      const suffix = query ? `?${query}` : ''
      apiRequest<{ tickets: TicketSummary[] }>(`/api/tickets${suffix}`)
        .then(async (ticketResult) => {
          if (cancelled) return
          setTickets(ticketResult.tickets)
          if (requestedTicketId) {
            let target = ticketResult.tickets.find((ticket) => ticket.id === requestedTicketId)
            if (!target) {
              const targetResult = await apiRequest<{ tickets: TicketSummary[] }>(
                `/api/tickets?id=${encodeURIComponent(requestedTicketId)}${includeInactive ? '&includeInactive=true' : ''}`,
              )
              target = targetResult.tickets[0]
            }
            if (cancelled) return
            setUrlTicketId(null)
            if (target) {
              setSelected(target)
              onTicketOpened?.()
            } else {
              setNotice({ kind: 'error', text: 'O chamado solicitado não foi encontrado.' })
            }
          }
        }).catch((error: unknown) => {
          if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os chamados.' })
        }).finally(() => { if (!cancelled) setLoading(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [search, ticketTypes, enterpriseFilters, activeBlockFilter, activeUnitFilter, customerNameFilter, subjectFilter, subsubjectFilter, includeInactive, viewMode, requestedTicketId, onTicketOpened, refreshKey, dashboardOpen])

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
    search, ticketTypes, enterpriseFilters, activeBlockFilter, activeUnitFilter, customerNameFilter,
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

  const [mobileSelectedStageKey, setMobileSelectedStageKey] = useState<string | number>('')

  useEffect(() => {
    if (visibleStages.length === 0) return
    const stageExists = visibleStages.some((stage) => stage.id === mobileSelectedStageKey)
    const isUnassignedValid = mobileSelectedStageKey === 'unassigned' && unassignedTickets.length > 0
    if (!stageExists && !isUnassignedValid) {
      setMobileSelectedStageKey(visibleStages[0].id)
    }
  }, [visibleStages, unassignedTickets.length, mobileSelectedStageKey])

  function selectPrevMobileStage() {
    const allKeys = [...visibleStages.map((s) => s.id), ...(unassignedTickets.length ? ['unassigned'] : [])]
    const currentIndex = allKeys.indexOf(mobileSelectedStageKey as any)
    if (currentIndex > 0) {
      setMobileSelectedStageKey(allKeys[currentIndex - 1])
    }
  }

  function selectNextMobileStage() {
    const allKeys = [...visibleStages.map((s) => s.id), ...(unassignedTickets.length ? ['unassigned'] : [])]
    const currentIndex = allKeys.indexOf(mobileSelectedStageKey as any)
    if (currentIndex >= 0 && currentIndex < allKeys.length - 1) {
      setMobileSelectedStageKey(allKeys[currentIndex + 1])
    }
  }

  const mobileActiveStageName = useMemo(() => {
    if (mobileSelectedStageKey === 'unassigned') return 'Sem situação'
    const match = visibleStages.find((s) => s.id === mobileSelectedStageKey)
    return match ? match.name : ''
  }, [mobileSelectedStageKey, visibleStages])

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (showProtocolModal) {
        setShowProtocolModal(false)
        return
      }
      const openDetails = document.querySelectorAll<HTMLDetailsElement>('.ticket-tag-manager[open], .ticket-card-fields[open]')
      if (openDetails.length > 0) {
        openDetails.forEach((detail) => { detail.open = false })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showProtocolModal])

  if (dashboardOpen) {
    return (
      <TicketDashboardPage
        onBack={() => applyViewChange(viewMode, 'push')}
        onSelectView={(view) => applyViewChange(view, 'push')}
      />
    )
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
            <Plus size={15} /> <span>Novo chamado</span><span className="desktop-only-text"> por protocolo</span>
          </button>
          {canManageIntegration && onOpenValidation && (
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenValidation}
              title="Abrir tela de validação da API"
            >
              <Zap size={14} /> Validação da API
            </button>
          )}
          {canManageIntegration && (
            <span className={`cvcrm-connection ${configured ? 'is-connected' : 'is-unconfigured'}`}>
              <i />{configured ? 'CVCRM configurado' : 'CVCRM pendente'}
            </span>
          )}
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
      {currentUser.role === 'admin' && !configured && <div className="ticket-setup-note"><ShieldCheck size={17} /><div><strong>Integração CVCRM ainda não configurada</strong><span>Defina subdomínio, e-mail e token no `.env` do backend. As instruções estão no README.</span></div></div>}
      {syncState?.last_finished_at && <p className="ticket-sync-meta">Última sincronização: {formatDate(syncState.last_finished_at)} · {syncState.imported_count} ativos{syncState.last_success === false && syncState.error_message ? ` · ${syncState.error_message}` : ''}</p>}

      {(() => {
        const activeFiltersCount = [
          search,
          ...ticketTypes,
          ...enterpriseFilters,
          ...blockFilter,
          ...unitFilter,
          customerNameFilter,
          ...subjectFilter,
          ...subsubjectFilter,
          includeInactive && 'inativos',
        ].filter(Boolean).length

        function clearAllFilters() {
          setSearch('')
          setTicketTypes([])
          setEnterpriseFilters([])
          setBlockFilter([])
          setUnitFilter([])
          setCustomerNameFilter('')
          setSubjectFilter([])
          setSubsubjectFilter([])
          setIncludeInactive(false)
        }

        return (
          <>
            <div className="ticket-view-toggle-bar">
              <div className="ticket-view-toggle" role="group" aria-label="Modo de visualização">
                <button
                  type="button"
                  className={!dashboardOpen && viewMode === 'kanban' ? 'is-active' : ''}
                  onClick={() => applyViewChange('kanban', 'push')}
                >
                  <LayoutGrid size={14} /> Quadro
                </button>
                <button
                  type="button"
                  className={!dashboardOpen && viewMode === 'list' ? 'is-active' : ''}
                  onClick={() => applyViewChange('list', 'push')}
                >
                  <List size={14} /> Lista
                </button>
                <button
                  type="button"
                  className={dashboardOpen ? 'is-active' : ''}
                  onClick={() => applyViewChange('dashboard', 'push')}
                >
                  <BarChart3 size={14} /> Dashboard
                </button>
              </div>
            </div>

            <section className={`ticket-filter-panel ${filtersExpanded ? 'is-expanded' : 'is-collapsed'}`}>
              <div className="ticket-filter-panel-top">
                <div className="ticket-filter-panel-left">
                  <button
                    className={`ticket-filter-toggle ${activeFiltersCount > 0 ? 'has-active' : ''}`}
                    type="button"
                    aria-expanded={filtersExpanded}
                    onClick={() => setFiltersExpanded((expanded) => !expanded)}
                  >
                    <ChevronDown size={15} />
                    <span className="desktop-text">{filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}</span>
                    <span className="mobile-only-text">Filtros</span>
                    {activeFiltersCount > 0 && (
                      <span className="ticket-filter-badge">
                        <span className="desktop-text">{activeFiltersCount} filtro(s)</span>
                        <span className="mobile-only-text">{activeFiltersCount}</span>
                      </span>
                    )}
                  </button>

                  <span className="ticket-filter-count">
                    <Clock3 size={13} />
                    <span className="desktop-text">{filtered.length} chamado(s){includeInactive ? '' : ' ativo(s)'}</span>
                    <span className="mobile-only-text">{filtered.length} ativos</span>
                  </span>

                  {activeFiltersCount > 0 && (
                    <button
                      className="filter-clear-button ticket-quick-clear-btn"
                      type="button"
                      onClick={clearAllFilters}
                      title="Limpar todos os filtros"
                    >
                      <X size={13} /> <span className="desktop-text">Limpar</span>
                    </button>
                  )}
                </div>
              </div>

            <div className="ticket-board-toolbar ticket-board-options">
              <label className="ticket-include-inactive">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                />
                <span>Mostrar finalizados e cancelados</span>
              </label>
              <button
                className="filter-clear-button"
                type="button"
                disabled={!activeFiltersCount}
                onClick={clearAllFilters}
              >
                <X size={14} /> Limpar filtros
              </button>
              {currentUser.role === 'admin' && (
                <details className="ticket-tag-manager">
                  <summary><Tag size={14} /> Gerenciar tags</summary>
                  <div className="ticket-tag-manager-panel">
                    <header>
                      <strong>Gerenciar tags dos chamados</strong>
                      <button
                        type="button"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details');
                          if (details) details.open = false;
                        }}
                        aria-label="Fechar gerenciador de tags"
                      >
                        <X size={16} />
                      </button>
                    </header>
                    <form onSubmit={(event) => void createTag(event)}>
                      <input
                        value={newTagName}
                        onChange={(event) => setNewTagName(event.target.value)}
                        maxLength={60}
                        placeholder="Nome da tag"
                        required
                      />
                      <input
                        aria-label="Cor da tag"
                        type="color"
                        value={newTagColor}
                        onChange={(event) => setNewTagColor(event.target.value)}
                      />
                      <button className="primary-button" type="submit">Criar</button>
                    </form>
                    <div className="ticket-tag-manager-list">
                      {tagOptions.map((tag) => (
                        <span className="ticket-tag-manager-item" key={tag.id}>
                          <i style={{ backgroundColor: tag.color }} />
                          {tag.name}
                          <button
                            type="button"
                            onClick={() => void deleteTag(tag)}
                            aria-label={`Excluir tag ${tag.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              {viewMode === 'kanban' && (
                <details className="ticket-card-fields">
                  <summary>Campos do cartão</summary>
                  <div className="ticket-card-fields-panel">
                    <header>
                      <strong>Campos exibidos no cartão</strong>
                      <button
                        type="button"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details');
                          if (details) details.open = false;
                        }}
                        aria-label="Fechar campos do cartão"
                      >
                        <X size={16} />
                      </button>
                    </header>
                    {([
                      ['customer', 'Cliente'],
                      ['description', 'Descrição'],
                      ['warranty', 'Garantia'],
                      ['age', 'Tempo aberto'],
                      ['counts', 'Comentários / subtarefas / programações'],
                      ['tags', 'Tags'],
                    ] as [TicketCardField, string][]).map(([field, label]) => (
                      <label key={field}>
                        <input
                          type="checkbox"
                          checked={cardFields.includes(field)}
                          onChange={() =>
                            setCardFields((current) =>
                              current.includes(field) ? current.filter((item) => item !== field) : [...current, field]
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              <label className="ticket-sort-control">
                <span>Ordenar por</span>
                <select
                  value={sortField}
                  onChange={(event) => setSortField(event.target.value as TicketSortField)}
                >
                  {ticketSortFields.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <button
                className="ticket-sort-direction"
                type="button"
                onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
                aria-label={`Ordenação ${sortDirection === 'asc' ? 'crescente' : 'decrescente'}; clique para inverter`}
              >
                {sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                {sortDirection === 'asc' ? 'Crescente' : 'Decrescente'}
              </button>
            </div>

            {filtersExpanded && <div className="ticket-board-toolbar ticket-board-filters">
          <label className="ticket-filter-field ticket-filter-search">
            <span>Busca geral</span>
            <div className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, protocolo, assunto, empreendimento ou telefone" aria-label="Pesquisar chamados por ID, protocolo, assunto, empreendimento ou telefone" /></div>
          </label>
          <label className="ticket-filter-field customer-name-filter">
            <span>Nome do cliente</span>
            <input type="search" value={customerNameFilter} onChange={(event) => setCustomerNameFilter(event.target.value)} placeholder="Filtrar por nome do cliente" />
          </label>
          <SearchableMultiSelect label="Empreendimentos" options={enterpriseOptions} value={enterpriseFilters} onChange={(value) => {
            setEnterpriseFilters(value)
            setBlockFilter([])
            setUnitFilter([])
          }} />
          <SearchableMultiSelect label="Bloco" options={blockOptions} value={activeBlockFilter} disabled={!blockOptionsReady} onChange={(value) => {
            setBlockFilter(value)
            setUnitFilter([])
          }} />
          <SearchableMultiSelect label="Unidade" options={unitOptions} value={activeUnitFilter} disabled={!blockOptionsReady} onChange={setUnitFilter} />
          <SearchableMultiSelect label="Assunto" options={subjectOptions} value={subjectFilter} onChange={(value) => { setSubjectFilter(value); setSubsubjectFilter([]) }} />
          <SearchableMultiSelect label="Subassunto" options={subsubjectOptions} value={subsubjectFilter} onChange={setSubsubjectFilter} />
          <div className="ticket-filter-field ticket-type-filter" role="group" aria-label="Tipo de chamado">
            <span>Tipo de chamado</span>
            <div className="ticket-type-options">
              {(['client', 'condominium'] as const).map((type) => <label key={type}><input type="checkbox" checked={ticketTypes.includes(type)} onChange={(event) => setTicketTypes((current) => event.target.checked ? [...current, type] : current.filter((value) => value !== type))} /><span>{type === 'client' ? 'Cliente' : 'Condomínio'}</span></label>)}
            </div>
          </div>
        </div>}
          </section>
        </>
      )
      })()}
      {loading ? (
        <ATechLoading message="Carregando chamados..." subtitle="Sincronizando atendimentos e etapas..." />
      ) : viewMode === 'list' ? (
        <>
          <TicketList tickets={pagedTickets} stages={orderedStages} onOpen={setSelected} />
          <ListPagination total={filtered.length} page={currentTicketListPage} pageCount={ticketListPageCount} pageSize={listPageSize} onPageChange={(page) => setTicketListPageState({ key: ticketListKey, page })} />
        </>
      ) : orderedStages.length === 0 ? <div className="ticket-board-empty"><ClipboardListIcon /><strong>Workflow ainda não carregado</strong><span>Configure a API e sincronize os atendimentos para trazer as etapas do CVCRM.</span></div> : filtered.length === 0 ? <div className="ticket-board-empty"><ClipboardListIcon /><strong>Nenhum chamado corresponde aos filtros.</strong></div> : (
        <div className="kanban-board-container">
          <div className="kanban-board-controls" aria-label="Navegação das situações">
            <span className="desktop-kanban-hint">Deslize ou arraste para ver outras situações</span>
            <span className="mobile-kanban-stage-title">
              Fase: <strong>{mobileActiveStageName}</strong>
            </span>
            <div className="kanban-board-nav-buttons">
              <button
                type="button"
                aria-label="Mostrar situações anteriores"
                title="Mostrar situações anteriores"
                onClick={() => {
                  moveKanban(-1)
                  selectPrevMobileStage()
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                aria-label="Mostrar próximas situações"
                title="Mostrar próximas situações"
                onClick={() => {
                  moveKanban(1)
                  selectNextMobileStage()
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          {/* Seletor de Fases Mobile (Pílulas horizontais touch-friendly) */}
          <div className="mobile-stage-selector" role="tablist" aria-label="Fases do chamado">
            {visibleStages.map((stage) => {
              const stageTicketsCount = filtered.filter((ticket) => ticket.statusId === stage.id).length
              const isActive = mobileSelectedStageKey === stage.id
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`mobile-stage-pill ${isActive ? 'is-active' : ''}`}
                  onClick={() => setMobileSelectedStageKey(stage.id)}
                >
                  <span
                    className="mobile-stage-dot"
                    style={{ backgroundColor: safeColor(stage.background_color, '#2877b8') }}
                  />
                  <span className="mobile-stage-label">{stage.name}</span>
                  <span className="mobile-stage-badge">{stageTicketsCount}</span>
                </button>
              )
            })}
            {unassignedTickets.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={mobileSelectedStageKey === 'unassigned'}
                className={`mobile-stage-pill ${mobileSelectedStageKey === 'unassigned' ? 'is-active' : ''}`}
                onClick={() => setMobileSelectedStageKey('unassigned')}
              >
                <span className="mobile-stage-dot" style={{ backgroundColor: '#94a3b8' }} />
                <span className="mobile-stage-label">Sem situação</span>
                <span className="mobile-stage-badge">{unassignedTickets.length}</span>
              </button>
            )}
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
              const isMobileActive = mobileSelectedStageKey === stage.id
              return <section className={`kanban-column ${isMobileActive ? 'is-mobile-active' : ''}`} key={stage.id} data-stage-key={stage.id}>
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
              const isMobileActive = mobileSelectedStageKey === 'unassigned'
              return <section className={`kanban-column ${isMobileActive ? 'is-mobile-active' : ''}`} key={key} data-stage-key={key}><header className="kanban-column-header"><span className="kanban-stage-name">Sem situação</span><span className="kanban-stage-count">{unassignedTickets.length}</span></header><div className="kanban-column-body">{ticketsToShow.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} clock={clock} fields={cardFields} onOpen={() => setSelected(ticket)} />)}{ticketsToShow.length < unassignedTickets.length && <button className="kanban-load-more" type="button" onClick={() => loadMoreTickets(key, visibleCount)}>Carregar mais ({Math.min(kanbanPageSize, unassignedTickets.length - visibleCount)})</button>}</div></section>
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
  const [detailTab, setDetailTab] = useState<'data' | 'schedule' | 'comments' | 'terms'>('data')
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (document.querySelector('.completion-term-backdrop')) return
      if (mentionQuery !== null) {
        setMentionQuery(null)
        setMentionStart(null)
        return
      }
      if (editingComment) {
        setEditingComment(null)
        return
      }
      if (editingSchedule || showScheduleForm) {
        setEditingSchedule(null)
        setShowScheduleForm(false)
        return
      }
      if (showSubtaskForm) {
        setShowSubtaskForm(false)
        return
      }
      onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mentionQuery, editingComment, editingSchedule, showScheduleForm, showSubtaskForm, onBack])

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

  async function updateProgrammingTermDelivery(entry: TicketProgramming, delivered: boolean) {
    setUpdatingProgramming((current) => new Set(current).add(entry.id))
    setError('')
    try {
      await apiRequest(`/api/programming/${entry.id}/term-delivery`, {
        method: 'PATCH',
        body: JSON.stringify({ delivered }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar a entrega do termo.')
    } finally {
      setUpdatingProgramming((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }

async function optimizeImageForAttachment(file: File): Promise<{
  fileName: string
  contentType: string
  contentBase64: string
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const MAX_DIM = 1920
        let { width, height } = img
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width >= height) {
            height = Math.round((height * MAX_DIM) / width)
            width = MAX_DIM
          } else {
            width = Math.round((width * MAX_DIM) / height)
            height = MAX_DIM
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(objectUrl)
          reject(new Error('Canvas indisponível para processamento da imagem.'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        URL.revokeObjectURL(objectUrl)
        const base64 = dataUrl.split(',')[1] || ''
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'foto'
        resolve({
          fileName: `${baseName}.jpg`,
          contentType: 'image/jpeg',
          contentBase64: base64,
        })
      } catch (err) {
        URL.revokeObjectURL(objectUrl)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Não foi possível ler a imagem selecionada.'))
    }
    img.src = objectUrl
  })
}

  async function uploadAttachment(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      let fileName = file.name
      let contentType = file.type || 'application/octet-stream'
      let contentBase64 = ''

      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
      if (isImage) {
        try {
          const optimized = await optimizeImageForAttachment(file)
          fileName = optimized.fileName
          contentType = optimized.contentType
          contentBase64 = optimized.contentBase64
        } catch {
          // Fallback para leitura direta em base64 caso canvas falhe (ex: HEIC/HEIF em iOS ou limites de memória do navegador mobile)
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          }
          contentBase64 = btoa(binary)
        }
      } else {
        if (file.size > 5 * 1024 * 1024) {
          throw new Error('Cada anexo não-imagem pode ter no máximo 5 MiB.')
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        }
        contentBase64 = btoa(binary)
      }

      await apiRequest(`/api/tickets/${ticket.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          fileName,
          contentType,
          contentBase64,
        }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível anexar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  async function deleteAttachment(attachmentId: string, fileName: string) {
    if (!window.confirm(`Excluir permanentemente o anexo "${fileName}"?`)) return
    try {
      await apiRequest(`/api/tickets/${ticket.id}/attachments/${attachmentId}`, { method: 'DELETE' })
      setAttachments((current) => current.filter((att) => att.id !== attachmentId))
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir o anexo.')
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

      <div className="ticket-detail-tabs-bar" role="tablist" aria-label="Abas do chamado">
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'data'}
          className={`ticket-detail-tab-btn ${detailTab === 'data' ? 'is-active' : ''}`}
          onClick={() => setDetailTab('data')}
        >
          <FileText size={15} /> <span>Dados & Central CVCRM</span>
          {(cvMessages.length + cvAttachments.length) > 0 && (
            <span className="tab-pill">{cvMessages.length + cvAttachments.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'schedule'}
          className={`ticket-detail-tab-btn ${detailTab === 'schedule' ? 'is-active' : ''}`}
          onClick={() => setDetailTab('schedule')}
        >
          <CalendarDays size={15} /> <span>Programação & Tarefas</span>
          {(programming.length + subtasks.length) > 0 && (
            <span className="tab-pill">{programming.length + subtasks.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'comments'}
          className={`ticket-detail-tab-btn ${detailTab === 'comments' ? 'is-active' : ''}`}
          onClick={() => setDetailTab('comments')}
        >
          <MessageCircle size={15} /> <span>Comentários & Histórico</span>
          {comments.length > 0 && <span className="tab-pill">{comments.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'terms'}
          className={`ticket-detail-tab-btn ${detailTab === 'terms' ? 'is-active' : ''}`}
          onClick={() => setDetailTab('terms')}
        >
          <FileSignature size={15} /> <span>Documentos & Termos</span>
          {(completionTerms.length + attachments.length) > 0 && (
            <span className="tab-pill">{completionTerms.length + attachments.length}</span>
          )}
        </button>

      </div>

      <div className="ticket-tab-body">
        {/* ABA 1: DADOS & ATENDIMENTO */}
        {detailTab === 'data' && (
          <div className="ticket-detail-grid">
            <div className="ticket-detail-main">
              <section className="ticket-info-section">
                <div className="ticket-section-heading">
                  <div>
                    <h2>Dados do atendimento</h2>
                    <p>Informações de cliente, localização técnica e prazos no CVCRM.</p>
                  </div>
                </div>
                <div className="ticket-facts">
                  <div><span>Cliente</span><strong className="sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar">{ticket.customerName || 'Não informado'}</strong></div>
                  <div><span>Telefone</span><strong className="sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar">{ticket.customerPhone || 'Não informado'}</strong></div>
                  <div><span>Assunto</span><strong>{ticket.subject}</strong></div>
                  <div><span>Subassunto</span><strong>{ticket.subsubject || 'Não informado'}</strong></div>
                  <div><span>Aberto em</span><strong>{formatDate(ticket.openedAt)}</strong></div>
                  <div><span>Tempo aberto</span><strong>{formatAge(ticket.openSeconds)}</strong></div>
                </div>
                <div className="ticket-opening-description">
                  <span>Descrição informada na abertura</span>
                  <p>{ticket.description || 'O CVCRM não retornou uma descrição para este atendimento.'}</p>
                </div>
              </section>

              <section className="ticket-info-section ticket-detail-tags">
                <div className="ticket-section-heading">
                  <div>
                    <h2>Tags do chamado</h2>
                    <p>Classificação automática e etiquetas personalizadas.</p>
                  </div>
                </div>
                <TicketTagPills tags={ticketTags} />
                <details className="ticket-tag-assignment">
                  <summary>Editar tags personalizadas</summary>
                  <div>
                    {tagOptions.map((tag) => (
                      <label key={tag.id}>
                        <input
                          type="checkbox"
                          checked={selectedTagIds.includes(tag.id)}
                          onChange={(event) => void toggleTicketTag(tag.id, event.target.checked)}
                        />
                        <span style={{ color: tag.color }}>{tag.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </section>

              {/* Central CVCRM integrada diretamente na primeira tela */}
              <section className="ticket-info-section cv-conversation-section">
                <div className="ticket-section-heading">
                  <div>
                    <h2>Central de Comunicação & Arquivos CVCRM</h2>
                    <p>{cvMessages.length} mensagem(ns) e {cvAttachments.length} anexo(s) sincronizados do CVCRM.</p>
                  </div>
                </div>
                {cvMessages.length ? (
                  <ol>
                    {cvMessages.map((message) => (
                      <li key={message.id}>
                        <header><strong>{message.author || 'CVCRM'}</strong><time>{formatDate(message.createdAt || null)}</time></header>
                        {message.body && <p>{cvMessageText(message.body)}</p>}
                        {message.attachments.length > 0 && (
                          <ul>
                            {message.attachments.map((file, index) => (
                              <li key={file.id ?? `${message.id}-${index}`}>
                                <Paperclip size={13} />
                                <span>{file.name}</span>
                                {file.url && <a href={file.url} target="_blank" rel="noreferrer">Abrir</a>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : <p className="ticket-empty-inline">Nenhuma mensagem retornada pelo CVCRM na última sincronização.</p>}

                <div className="cv-attachment-list">
                  <h3>Anexos sincronizados do CVCRM ({cvAttachments.length})</h3>
                  {cvAttachments.length ? (
                    <ul>
                      {cvAttachments.map((file, index) => (
                        <li key={file.id ?? `${file.name}-${index}`}>
                          <Paperclip size={14} />
                          <span><strong>{file.name}</strong><small>{file.type || 'Arquivo'}{file.size ? ` · ${file.size}` : ''}{file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}</small></span>
                          {file.url ? <a href={file.url} target="_blank" rel="noreferrer">Abrir</a> : <small>Link indisponível</small>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="ticket-empty-inline">Nenhum anexo CVCRM retornado na última sincronização.</p>}
                </div>
              </section>
            </div>

            <aside className="ticket-detail-aside">
              <section className="ticket-info-section">
                <h2>Controle local</h2>
                <form className="ticket-management-form" onSubmit={(event) => void saveManagement(event)}>
                  <label className="ticket-form-field">
                    <span>Prazo previsto</span>
                    <input type="datetime-local" value={management.due} onChange={(event) => setManagement((current) => ({ ...current, due: event.target.value }))} />
                  </label>
                  <label className="ticket-form-field">
                    <span><Coins size={14} /> Custo previsto</span>
                    <input type="number" min="0" step="0.01" value={management.estimatedCost} onChange={(event) => setManagement((current) => ({ ...current, estimatedCost: event.target.value }))} />
                  </label>
                  <label className="ticket-form-field">
                    <span><Coins size={14} /> Custo realizado</span>
                    <input type="number" min="0" step="0.01" value={management.actualCost} onChange={(event) => setManagement((current) => ({ ...current, actualCost: event.target.value }))} />
                  </label>
                  <button className="secondary-button" type="submit" disabled={busy}>Salvar controle</button>
                </form>
                <div className="ticket-cost-summary">
                  <span>Previsto <strong>{money(ticket.estimatedCost)}</strong></span>
                  <span>Realizado <strong>{money(ticket.actualCost)}</strong></span>
                </div>
              </section>
              <div className="ticket-detail-source-note">
                <ShieldCheck size={15} />
                <span>Situação é consultada no CVCRM; comentários, subtarefas e programação são dados locais da ATech.</span>
              </div>
            </aside>
          </div>
        )}

        {/* ABA 2: PROGRAMAÇÃO & TAREFAS */}
        {detailTab === 'schedule' && (
          <div className="ticket-tab-pane">
            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Programação de atividades em campo</h2>
                  <p>Colaboradores alocados, horário e descritivo do serviço.</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => { setEditingSchedule(null); setShowScheduleForm((value) => !value) }}>
                  <Plus size={15} /> Programar
                </button>
              </div>
              {(showScheduleForm || editingSchedule) && (
                <TicketProgrammingForm
                  key={editingSchedule ? `${editingSchedule.id}-${editingSchedule.programming_type}` : 'new-ticket-programming'}
                  tickets={tickets}
                  initialTicketId={ticket.id}
                  allowMixedCollaborators
                  editingAppointment={editingSchedule ?? undefined}
                  onCancel={() => { setShowScheduleForm(false); setEditingSchedule(null) }}
                  onSaved={() => {
                    setShowScheduleForm(false)
                    setEditingSchedule(null)
                    setRefresh((value) => value + 1)
                    onNotice({ kind: 'success', text: 'Programação salva.' })
                  }}
                />
              )}
              {programming.length ? (
                <div className="ticket-programming-list">
                  {programming.map((entry) => (
                    <article className={`ticket-programming-item ${entry.is_finalization ? 'is-finalization' : ''}`} key={entry.id}>
                      {entry.is_finalization && (
                        <div className="ticket-programming-finalization-alert">
                          <div className="ticket-programming-finalization-alert-top">
                            <div className="ticket-programming-alert-tag">
                              <FileSignature size={12} />
                              <span>FINALIZAÇÃO DO CHAMADO</span>
                            </div>
                            <span className={`ticket-programming-delivery-badge ${entry.completion_term_delivered ? 'is-delivered' : 'is-pending'}`}>
                              {entry.completion_term_delivered ? (
                                <><Check size={11} /> Termo entregue ao colaborador</>
                              ) : (
                                <><Clock3 size={11} /> Termo pendente de entrega</>
                              )}
                            </span>
                          </div>
                          <p className="ticket-programming-alert-msg">
                            Solicitar a assinatura do termo de finalização ao cliente após a realização do serviço.
                          </p>
                        </div>
                      )}
                      <div className="ticket-programming-meta">
                        <span className="programming-time">{programmingDateTimeString(entry.starts_at)}–{programmingTimeString(new Date(entry.ends_at))}</span>
                        <strong>{entry.collaborator_name}{entry.collaborator_nickname ? ` · ${entry.collaborator_nickname}` : ''}</strong>
                      </div>
                      <p className="ticket-programming-desc">{entry.activity_description}</p>
                      <div className="ticket-programming-footer">
                        <div className="ticket-programming-checks">
                          <label className={`programming-pill-check ${entry.completed ? 'is-checked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={entry.completed}
                              disabled={updatingProgramming.has(entry.id)}
                              onChange={(event) => void updateProgrammingCompletion(entry, event.target.checked)}
                            />
                            <span>{entry.completed ? 'Realizada' : 'Marcar como realizada'}</span>
                          </label>
                          {entry.is_finalization && (
                            <label className={`programming-pill-check is-term ${entry.completion_term_delivered ? 'is-checked' : ''}`}>
                              <input
                                type="checkbox"
                                checked={Boolean(entry.completion_term_delivered)}
                                disabled={updatingProgramming.has(entry.id)}
                                onChange={(event) => void updateProgrammingTermDelivery(entry, event.target.checked)}
                              />
                              <span>{entry.completion_term_delivered ? 'Termo entregue' : 'Termo de finalização entregue'}</span>
                            </label>
                          )}
                        </div>
                        <div className="ticket-programming-buttons">
                          <button type="button" className="text-action-btn" onClick={() => { setShowScheduleForm(false); setEditingSchedule(entry) }}>
                            <Pencil size={12} /> Editar
                          </button>
                          <button type="button" className="text-action-btn danger-action" onClick={() => void deleteProgramming(entry)}>
                            <Trash2 size={12} /> Excluir
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : !showScheduleForm && !editingSchedule && (
                <p className="ticket-empty-inline">Nenhuma atividade programada para este chamado.</p>
              )}
            </section>

            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Subtarefas & Checklist</h2>
                  <p>{subtasks.filter((item) => item.is_done).length} de {subtasks.length} concluídas</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => setShowSubtaskForm((value) => !value)}>
                  <Plus size={15} /> Nova subtarefa
                </button>
              </div>
              {showSubtaskForm && (
                <form className="ticket-subtask-form" onSubmit={(event) => void createSubtask(event)}>
                  <input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Descreva a subtarefa" maxLength={300} required />
                  <button className="primary-button" type="submit" disabled={busy}>Adicionar</button>
                </form>
              )}
              {subtasks.length ? (
                <ul className="ticket-subtask-list">
                  {subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <label>
                        <input type="checkbox" checked={subtask.is_done} onChange={() => void toggleSubtask(subtask)} />
                        <span className={subtask.is_done ? 'is-complete' : ''}>{subtask.title}</span>
                      </label>
                      {subtask.assignee_name && <small>{subtask.assignee_name}</small>}
                      {subtask.due_at && <small>{formatDate(subtask.due_at)}</small>}
                    </li>
                  ))}
                </ul>
              ) : !showSubtaskForm && (
                <p className="ticket-empty-inline">Nenhuma subtarefa registrada.</p>
              )}
            </section>
          </div>
        )}

        {/* ABA 3: COMENTÁRIOS & HISTÓRICO */}
        {detailTab === 'comments' && (
          <div className="ticket-tab-pane">
            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Comentários e alinhamento interno</h2>
                  <p>Digite @ para mencionar membros da equipe. Respostas notificam os participantes.</p>
                </div>
                <MessageCircle size={17} />
              </div>
              {loading ? (
                <p className="ticket-empty-inline">Carregando conversa...</p>
              ) : (
                <div className="ticket-comments">
                  {comments.filter((entry) => !entry.parent_comment_id).map((entry) => {
                    const replies = comments.filter((reply) => reply.parent_comment_id === entry.id)
                    const canManageComment = currentUser.role === 'admin' || Number(entry.author_id) === currentUser.id
                    return (
                      <article className="ticket-comment-thread" key={entry.id}>
                        <article className="ticket-comment">
                          <div className="comment-avatar">{entry.author_name.slice(0, 1).toUpperCase()}</div>
                          <div className="ticket-comment-content">
                            <header>
                              <strong>{entry.author_name}</strong>
                              <time>{formatDate(entry.created_at)}{entry.updated_at !== entry.created_at ? ' · editado' : ''}</time>
                            </header>
                            {editingComment?.id === entry.id ? (
                              <form className="comment-edit-form" onSubmit={(event) => { event.preventDefault(); void editComment(entry, editingComment.body) }}>
                                <textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required />
                                <button className="primary-button" type="submit" disabled={busy}>Salvar</button>
                                <button className="secondary-button" type="button" onClick={() => setEditingComment(null)}>Cancelar</button>
                              </form>
                            ) : (
                              <p>{entry.body}</p>
                            )}
                            {entry.mentions.length > 0 && <small>Mencionados: {entry.mentions.map((person) => person.displayName).join(', ')}</small>}
                            <div className="comment-actions">
                              <button className="text-action-btn" type="button" onClick={() => { setReplyingTo(entry.id); setComment('') }}>
                                <MessageCircle size={13} /> Responder
                              </button>
                              {canManageComment && (
                                <>
                                  <button className="text-action-btn" type="button" onClick={() => setEditingComment(entry)}>
                                    <Pencil size={13} /> Editar
                                  </button>
                                  <button className="text-action-btn danger-action" type="button" onClick={() => void deleteComment(entry)}>
                                    <Trash2 size={13} /> Excluir
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </article>
                        {replies.map((reply) => {
                          const canManageReply = currentUser.role === 'admin' || Number(reply.author_id) === currentUser.id
                          return (
                            <article className="ticket-comment ticket-comment-reply" key={reply.id}>
                              <div className="comment-avatar">{reply.author_name.slice(0, 1).toUpperCase()}</div>
                              <div className="ticket-comment-content">
                                <header>
                                  <strong>{reply.author_name}</strong>
                                  <time>{formatDate(reply.created_at)}{reply.updated_at !== reply.created_at ? ' · editado' : ''}</time>
                                </header>
                                {editingComment?.id === reply.id ? (
                                  <form className="comment-edit-form" onSubmit={(event) => { event.preventDefault(); void editComment(reply, editingComment.body) }}>
                                    <textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required />
                                    <button className="primary-button" type="submit" disabled={busy}>Salvar</button>
                                    <button className="secondary-button" type="button" onClick={() => setEditingComment(null)}>Cancelar</button>
                                  </form>
                                ) : (
                                  <p>{reply.body}</p>
                                )}
                                <small>Resposta</small>
                                {canManageReply && (
                                  <div className="comment-actions">
                                    <button className="text-action-btn" type="button" onClick={() => setEditingComment(reply)}>
                                      <Pencil size={13} /> Editar
                                    </button>
                                    <button className="text-action-btn danger-action" type="button" onClick={() => void deleteComment(reply)}>
                                      <Trash2 size={13} /> Excluir
                                    </button>
                                  </div>
                                )}
                              </div>
                            </article>
                          )
                        })}
                      </article>
                    )
                  })}
                  {comments.length === 0 && <p className="ticket-empty-inline">Ainda não há comentários.</p>}
                </div>
              )}
              {replyingTo && (
                <div className="replying-banner">
                  Respondendo a {comments.find((entry) => entry.id === replyingTo)?.author_name ?? 'comentário'}
                  <button type="button" className="text-action-btn" onClick={() => setReplyingTo(null)}>Cancelar</button>
                </div>
              )}
              <form className="ticket-comment-form" onSubmit={(event) => void postComment(event)}>
                <div className="mention-composer">
                  <textarea
                    value={comment}
                    onChange={(event) => updateCommentText(event.target.value, event.currentTarget.selectionStart)}
                    rows={3}
                    maxLength={6000}
                    placeholder={replyingTo ? 'Escreva uma resposta...' : 'Escreva um comentário... Use @ para mencionar'}
                    required
                  />
                  {mentionQuery !== null && (
                    <div className="mention-suggestions" role="listbox">
                      {people
                        .filter((person) => person.displayName.toLocaleLowerCase('pt-BR').includes(mentionQuery))
                        .slice(0, 6)
                        .map((person) => (
                          <button key={person.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(person)}>
                            <AtSign size={13} />{person.displayName}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="comment-form-footer">
                  {mentions.length > 0 && <small>{mentions.length} pessoa(s) mencionada(s)</small>}
                  <button className="primary-button" type="submit" disabled={busy || !comment.trim()}>
                    {busy ? 'Enviando...' : replyingTo ? 'Responder' : 'Comentar'}
                  </button>
                </div>
              </form>
            </section>

            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Histórico de alterações</h2>
                  <p>{history.length} evento(s) recente(s)</p>
                </div>
                <button className="secondary-button" type="button" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
                  {showHistory ? 'Mostrar menos' : 'Mostrar mais'}
                </button>
              </div>
              {showHistory && (
                <ol className="ticket-history-list">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <span className="ticket-history-dot" />
                      <div>
                        <strong>{entry.summary}</strong>
                        <p>{entry.actor_name} · {formatDate(entry.created_at)}</p>
                      </div>
                    </li>
                  ))}
                  {history.length === 0 && <p className="ticket-empty-inline">Ainda não há alterações registradas.</p>}
                </ol>
              )}
            </section>
          </div>
        )}

        {/* ABA 4: DOCUMENTOS & TERMOS */}
        {detailTab === 'terms' && (
          <div className="ticket-tab-pane">
            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Termo de finalização</h2>
                  <p>Gere o documento oficial e acesse os termos assinados deste protocolo.</p>
                </div>
              </div>
              <div className="ticket-detail-terms">
                <button type="button" className="secondary-button" onClick={onGenerateTerm}>
                  <FileSignature size={15} /> Gerar termo de finalização
                </button>
                {completionTerms.length ? completionTerms.map((term) => (
                  <div className="ticket-card-saved-term" key={term.id}>
                    <button type="button" className="ticket-card-saved-term-open" onClick={() => onDownloadTerm(term)} title={`Baixar ${term.file_name}`}>
                      <Download size={14} /><span>{term.file_name}</span>
                    </button>
                    <small>{Math.ceil(term.file_size / 1024)} KB · {term.uploaded_by_name} · {formatDate(term.created_at)}</small>
                    {(currentUser.role === 'admin' || String(term.uploaded_by) === String(currentUser.id)) && (
                      <button type="button" className="ticket-card-saved-term-delete" onClick={() => onDeleteTerm(term)} aria-label={`Excluir ${term.file_name}`} title="Excluir termo">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )) : <p className="ticket-empty-inline">Nenhum termo assinado salvo neste protocolo.</p>}
              </div>
            </section>

            <section className="ticket-info-section">
              <div className="ticket-section-heading">
                <div>
                  <h2>Anexos internos da ATech</h2>
                  <p>Arquivos internos vinculados a este chamado (até 5 MiB cada).</p>
                </div>
                <label className={`secondary-button attachment-upload-button ${uploading ? 'is-disabled' : ''}`}>
                  <Paperclip size={15} />{uploading ? 'Enviando...' : 'Anexar arquivo'}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                    disabled={uploading}
                    onChange={(event) => { void uploadAttachment(event.target.files?.[0]); event.currentTarget.value = '' }}
                  />
                </label>
              </div>
              {attachments.length ? (
                <ul className="ticket-attachment-list">
                  {attachments.map((entry) => (
                    <li key={entry.id}>
                      <Paperclip size={15} />
                      <span><strong>{entry.file_name}</strong><small>{Math.ceil(entry.file_size / 1024)} KB · {entry.uploaded_by_name}</small></span>
                      <button className="icon-button" type="button" title={`Baixar ${entry.file_name}`} aria-label={`Baixar ${entry.file_name}`} onClick={() => void downloadAttachment(entry)}>
                        <Download size={15} />
                      </button>
                      {(currentUser.role === 'admin' || !entry.uploaded_by || String(entry.uploaded_by) === String(currentUser.id)) && (
                        <button
                          className="icon-button icon-button-danger"
                          type="button"
                          title={`Excluir ${entry.file_name}`}
                          aria-label={`Excluir ${entry.file_name}`}
                          onClick={() => void deleteAttachment(entry.id, entry.file_name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="ticket-empty-inline">Nenhum anexo interno enviado.</p>}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
