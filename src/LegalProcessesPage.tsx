import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  AtSign,
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Clock,
  Coins,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  GripVertical,
  Layers,
  List,
  MessageCircle,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  UploadCloud,
  User,
  X,
} from 'lucide-react'
import Papa from 'papaparse'
import { apiRequest } from './api/client'
import SearchableMultiSelect from './SearchableMultiSelect'
import TicketProgrammingForm from './tickets/TicketProgrammingForm'
import { ATechLoading } from './ATechLoading'
import type { LegalProcessOption } from './tickets/types'
import './LegalProcessesPage.css'

interface LegalStatus { id: number; name: string; position: number; color: string }
interface LegalTag { id: number; name: string; color: string }
interface EnterpriseOption { enterprise_key: string; enterprise_name: string }
interface Assignee { id: number; display_name?: string; displayName?: string; email?: string }
interface ChildProcess { id?: number; processNumber: string; description: string; statusId: number; movementDate: string | null; isDone: boolean }
interface ProcessItem { id?: number; title: string; isDone: boolean }
interface CsvLegalTask {
  id: string
  name: string
  status: string
  assignee: string
  priority: string
  dueDate: string
  taskContent: string
  latestComment: string
  commentCount: string
}
interface CsvImportResult {
  importedCount: number
  skippedCount: number
  statusesCreated: number
}
interface LegalComment {
  id: number
  body: string
  parentCommentId: number | null
  authorId: number
  authorName: string
  createdAt: string
  updatedAt: string
  mentions: { id: number; displayName: string }[]
}

function LegalListPagination({ total, page, pageCount, pageSize, onPageChange }: {
  total: number
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return <nav className="list-pagination" aria-label="Paginação da lista de processos">
    <span>{first}–{last} de {total}</span>
    <div>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span>Página {page} de {pageCount}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Próxima</button>
    </div>
  </nav>
}

interface PaymentAttachment { id: number; fileName: string; fileSize: number; contentType: string }
interface LegalPayment {
  id: number
  description: string
  amount: string
  dueDate: string | null
  isPaid: boolean
  attachments: PaymentAttachment[]
}
interface LegalProcess {
  id: number
  title: string
  process_number: string
  child_process_numbers?: string[]
  status_id: number
  status_name: string
  status_color: string
  enterprise_key: string | null
  enterprise_name: string
  start_date: string | null
  end_date: string | null
  description: string
  case_value: string | null
  claimant: string
  drive_url: string
  notebook_url: string
  distribution_date: string | null
  is_demo: boolean
  assignees: Assignee[]
  children_count: number
  completed_children_count: number
  items_count?: number
  completed_items_count?: number
  paid_total: string
  pending_payment_total?: string
  payment_count: number
  tags: LegalTag[]
  conclusion_result: ConclusionResult | null
  conclusion_summary: string
}
type ConclusionResult = 'full_win' | 'partial_win' | 'full_loss' | 'partial_loss'
interface LegalProcessConclusion {
  id: number
  result: ConclusionResult
  summary: string
  concludedAt: string
  concludedByName: string
}
interface ProcessDetail {
  id: number
  title: string
  processNumber: string
  statusId: number
  enterpriseKey: string | null
  enterpriseName: string
  startDate: string | null
  endDate: string | null
  description: string
  caseValue: string | null
  claimant: string
  driveUrl: string
  notebookUrl: string
  distributionDate: string | null
  isDemo: boolean
  assigneeIds: number[]
  children: ChildProcess[]
  items: ProcessItem[]
  payments: LegalPayment[]
  paidTotal: string
  pendingPaymentTotal?: string
  comments: LegalComment[]
  conclusionResult: ConclusionResult | null
  conclusionSummary: string
  conclusionHistory: LegalProcessConclusion[]
  tags: LegalTag[]
}
interface ProcessDraft {
  title: string
  processNumber: string
  statusId: number
  enterpriseKey: string
  startDate: string
  endDate: string
  description: string
  caseValue: string
  claimant: string
  driveUrl: string
  notebookUrl: string
  distributionDate: string
  assigneeIds: number[]
  children: ChildProcess[]
  items: ProcessItem[]
}
interface PendingProcessSave {
  draft: ProcessDraft
  token: number
}

type FaceField = 'processNumber' | 'enterprise' | 'claimant' | 'assignees' | 'dates' | 'caseValue' | 'children' | 'paidTotal' | 'distributionDate'
const faceFields: { id: FaceField; label: string }[] = [
  { id: 'processNumber', label: 'Número único do processo' },
  { id: 'enterprise', label: 'Empreendimento' },
  { id: 'claimant', label: 'Requerente' },
  { id: 'assignees', label: 'Responsáveis' },
  { id: 'dates', label: 'Início e finalização' },
  { id: 'caseValue', label: 'Valor da causa' },
  { id: 'children', label: 'Processos filhos' },
  { id: 'paidTotal', label: 'Total pago' },
  { id: 'distributionDate', label: 'Data de distribuição' },
]
const defaultFaceFields: FaceField[] = ['processNumber', 'enterprise', 'claimant', 'assignees', 'dates', 'caseValue', 'paidTotal']
const kanbanPageSize = 5
const listPageSize = 50
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function isConcludedStatus(name: string) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR') === 'concluido'
}
const conclusionLabels: Record<ConclusionResult, string> = {
  full_win: 'Ganho total',
  partial_win: 'Ganho parcial',
  full_loss: 'Perda total',
  partial_loss: 'Perda parcial',
}

function formatCnjProcessNumber(value: string | null | undefined): string {
  if (!value) return ''
  if (/[a-zA-Z]/.test(value)) return value
  const d = value.replace(/\D/g, '').slice(0, 20)
  if (!d) return ''
  let r = d.slice(0, 7)
  if (d.length > 7) r += '-' + d.slice(7, 9)
  if (d.length > 9) r += '.' + d.slice(9, 13)
  if (d.length > 13) r += '.' + d.slice(13, 14)
  if (d.length > 14) r += '.' + d.slice(14, 16)
  if (d.length > 16) r += '.' + d.slice(16, 20)
  return r
}

function dateInput(value: string | null | undefined) { return value ? value.slice(0, 10) : '' }
function showDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
function getTodayIso() {
  return new Date().toISOString().slice(0, 10)
}
function getInSevenDaysIso() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function blankDraft(statusId: number): ProcessDraft {
  return {
    title: '', processNumber: '', statusId, enterpriseKey: '', startDate: '', endDate: '', description: '', caseValue: '',
    claimant: '', driveUrl: '', notebookUrl: '', distributionDate: '', assigneeIds: [], children: [], items: [],
  }
}
function toDraft(process: ProcessDetail): ProcessDraft {
  return {
    title: process.title, processNumber: formatCnjProcessNumber(process.processNumber), statusId: process.statusId, enterpriseKey: process.enterpriseKey ?? '', startDate: dateInput(process.startDate),
    endDate: dateInput(process.endDate), description: process.description,
    caseValue: process.caseValue ?? '', claimant: process.claimant, driveUrl: process.driveUrl,
    notebookUrl: process.notebookUrl, distributionDate: dateInput(process.distributionDate),
    assigneeIds: process.assigneeIds,
    children: process.children.map((c) => ({ ...c, processNumber: formatCnjProcessNumber(c.processNumber) })),
    items: process.items,
  }
}
function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : undefined
      if (result) resolve(result)
      else reject(new Error('Não foi possível ler o arquivo.'))
    }
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}

function decodeCsvFile(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3))
    }

    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8
  })
}

function exportProcessesToCsv(items: LegalProcess[]) {
  const headers = [
    'ID',
    'Número Único',
    'Processo',
    'Empreendimento',
    'Situação / Fase',
    'Requerente',
    'Responsáveis',
    'Data de Início',
    'Data de Finalização',
    'Data de Distribuição',
    'Valor da Causa (R$)',
    'Total Pago (R$)',
    'Total de Filhos',
    'Filhos Concluídos',
    'Total de Tarefas',
    'Tarefas Concluídas',
  ]
  const rows = items.map((p) => [
    p.id,
    `"${(p.process_number || '').replace(/"/g, '""')}"`,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    `"${(p.enterprise_name || '').replace(/"/g, '""')}"`,
    `"${(p.status_name || '').replace(/"/g, '""')}"`,
    `"${(p.claimant || '').replace(/"/g, '""')}"`,
    `"${p.assignees.map((a) => a.displayName ?? a.display_name ?? a.email ?? '').join(', ').replace(/"/g, '""')}"`,
    p.start_date ? showDate(p.start_date) : '',
    p.end_date ? showDate(p.end_date) : '',
    p.distribution_date ? showDate(p.distribution_date) : '',
    p.case_value ? Number(p.case_value).toFixed(2).replace('.', ',') : '',
    p.paid_total ? Number(p.paid_total).toFixed(2).replace('.', ',') : '0,00',
    p.children_count ?? 0,
    p.completed_children_count ?? 0,
    p.items_count ?? 0,
    p.completed_items_count ?? 0,
  ])
  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `processos-juridicos-${new Date().toISOString().slice(0, 10)}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

type MainTab = 'board' | 'list' | 'dashboard'
type DetailTab = 'general' | 'tasks' | 'children' | 'finances' | 'comments'
type ListSortField = 'title' | 'processNumber' | 'enterprise' | 'status' | 'claimant' | 'assignees' | 'dates' | 'caseValue' | 'paidTotal'

const LEGAL_DASHBOARD_STORAGE_KEY = 'atech_legal_dashboard_filters'

interface SavedLegalDashboardFilters {
  statusFilter?: string
  enterpriseFilter?: string
  claimantFilter?: string
  processNumberFilter?: string
  startDate?: string
  endDate?: string
  tagFilter?: string
}

function loadSavedLegalDashboardFilters(): SavedLegalDashboardFilters {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LEGAL_DASHBOARD_STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as SavedLegalDashboardFilters
  } catch {
    return {}
  }
}

export default function LegalProcessesPage({
  currentUser,
  initialProcessId = null,
  onProcessOpened,
}: {
  currentUser: { id: number; role: 'admin' | 'member' }
  initialProcessId?: string | null
  onProcessOpened?: () => void
}) {
  const [statuses, setStatuses] = useState<LegalStatus[]>([])
  const [processes, setProcesses] = useState<LegalProcess[]>([])
  const [legalTags, setLegalTags] = useState<LegalTag[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [processPagination, setProcessPagination] = useState<{ key: string; counts: Record<string, number> }>({ key: '', counts: {} })
  const [people, setPeople] = useState<Assignee[]>([])
  const [loading, setLoading] = useState(true)

  // Data de hoje e em 7 dias para alerta de prazos
  const [today] = useState(getTodayIso)
  const [inSevenDays] = useState(getInSevenDaysIso)

  // Unificação de abas principais com persistência
  const [activeTab, setActiveTab] = useState<MainTab>(() => {
    try {
      const saved = localStorage.getItem('atech-legal-active-tab')
      return saved === 'list' || saved === 'dashboard' ? saved : 'board'
    } catch {
      return 'board'
    }
  })

  // Aba interna do detalhe do processo
  const [detailTab, setDetailTab] = useState<DetailTab>('general')

  // Dashboard filters
  const [initialLegalDashFilters] = useState(() => loadSavedLegalDashboardFilters())
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState(() => initialLegalDashFilters.statusFilter ?? '')
  const [dashboardEnterpriseFilter, setDashboardEnterpriseFilter] = useState(() => initialLegalDashFilters.enterpriseFilter ?? '')
  const [dashboardClaimantFilter, setDashboardClaimantFilter] = useState(() => initialLegalDashFilters.claimantFilter ?? '')
  const [dashboardProcessNumberFilter, setDashboardProcessNumberFilter] = useState(() => initialLegalDashFilters.processNumberFilter ?? '')
  const [dashboardStartDate, setDashboardStartDate] = useState(() => initialLegalDashFilters.startDate ?? '')
  const [dashboardEndDate, setDashboardEndDate] = useState(() => initialLegalDashFilters.endDate ?? '')
  const [dashboardTagFilter, setDashboardTagFilter] = useState(() => initialLegalDashFilters.tagFilter ?? '')

  useEffect(() => {
    try {
      const stateToSave: SavedLegalDashboardFilters = {
        statusFilter: dashboardStatusFilter,
        enterpriseFilter: dashboardEnterpriseFilter,
        claimantFilter: dashboardClaimantFilter,
        processNumberFilter: dashboardProcessNumberFilter,
        startDate: dashboardStartDate,
        endDate: dashboardEndDate,
        tagFilter: dashboardTagFilter,
      }
      localStorage.setItem(LEGAL_DASHBOARD_STORAGE_KEY, JSON.stringify(stateToSave))
    } catch {
      // ignore
    }
  }, [
    dashboardStatusFilter,
    dashboardEnterpriseFilter,
    dashboardClaimantFilter,
    dashboardProcessNumberFilter,
    dashboardStartDate,
    dashboardEndDate,
    dashboardTagFilter,
  ])

  // Board/List filters
  const [faceMenu, setFaceMenu] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [query, setQuery] = useState('')
  const [processNumberFilter, setProcessNumberFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [claimantFilter, setClaimantFilter] = useState('')
  const [valueFilter, setValueFilter] = useState<'all' | 'with_value' | 'without_value'>('all')

  // Ordenação da tabela em lista
  const [listSortField, setListSortField] = useState<ListSortField>('title')
  const [listSortDirection, setListSortDirection] = useState<'asc' | 'desc'>('asc')

  // Feedback de cópia do número único
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Status & Tag managers
  const [showStatusForm, setShowStatusForm] = useState(false)
  const [statusManagerOpen, setStatusManagerOpen] = useState(false)
  const [statusName, setStatusName] = useState('')
  const [statusColor, setStatusColor] = useState('#3478a8')
  const [legalTagName, setLegalTagName] = useState('')
  const [legalTagColor, setLegalTagColor] = useState('#3478a8')
  const [creatingLegalTag, setCreatingLegalTag] = useState(false)
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null)
  const [editingStatusName, setEditingStatusName] = useState('')

  // Process editor & details
  const [newProcess, setNewProcess] = useState(false)
  const [showProgrammingForm, setShowProgrammingForm] = useState(false)
  const [showConclusionForm, setShowConclusionForm] = useState(false)
  const [showReopenForm, setShowReopenForm] = useState(false)
  const [reopenStatusId, setReopenStatusId] = useState('')
  const [conclusionResult, setConclusionResult] = useState<ConclusionResult | ''>('')
  const [conclusionSummary, setConclusionSummary] = useState('')
  const [savingConclusion, setSavingConclusion] = useState(false)
  const [selected, setSelected] = useState<ProcessDetail | null>(null)

  const scheduleProcess = useMemo<LegalProcessOption | undefined>(() => selected ? ({
    id: String(selected.id),
    title: selected.title,
    enterprise_name: selected.enterpriseName,
    claimant: selected.claimant,
    child_process_numbers: selected.children.map((child) => child.processNumber),
  }) : undefined, [selected])

  const detailPageOpen = newProcess || Boolean(selected)
  const selectedConclusionHistory = selected
    ? selected.conclusionHistory.length
      ? selected.conclusionHistory
      : selected.conclusionResult
        ? [{ id: 0, result: selected.conclusionResult, summary: selected.conclusionSummary, concludedAt: '', concludedByName: '' }]
        : []
    : []

  const [draft, setDraft] = useState<ProcessDraft | null>(null)
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const [autoSaveError, setAutoSaveError] = useState('')
  const [paymentDraft, setPaymentDraft] = useState({ description: '', amount: '', dueDate: '', isPaid: false })
  const [paymentFile, setPaymentFile] = useState<File | null>(null)
  const [savingPayment, setSavingPayment] = useState(false)
  const [busyPayment, setBusyPayment] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [mentions, setMentions] = useState<number[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionCursor, setMentionCursor] = useState<number | null>(null)
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [editingComment, setEditingComment] = useState<LegalComment | null>(null)
  const [busyComment, setBusyComment] = useState(false)
  const [dragged, setDragged] = useState<number | null>(null)
  const [savingStatusOrder, setSavingStatusOrder] = useState(false)

  // CSV Import Modal & State
  const [csvModalOpen, setCsvModalOpen] = useState(false)
  const [csvTasks, setCsvTasks] = useState<CsvLegalTask[]>([])
  const [csvFileName, setCsvFileName] = useState('')
  const [csvQuery, setCsvQuery] = useState('')
  const [csvPage, setCsvPage] = useState(1)
  const [importingCsv, setImportingCsv] = useState(false)

  const boardRef = useRef<HTMLDivElement>(null)
  const processDetailRef = useRef<HTMLElement>(null)
  const draftRef = useRef<ProcessDraft | null>(draft)
  const processIdRef = useRef<number | null>(selected?.id ?? null)
  const savedDraftRef = useRef('')
  const editTokenRef = useRef(0)
  const autoSaveTimerRef = useRef<number | null>(null)
  const pendingProcessSaveRef = useRef<PendingProcessSave | null>(null)
  const autoSavePromiseRef = useRef<Promise<boolean> | null>(null)
  const queueProcessSaveRef = useRef<(snapshot: ProcessDraft) => Promise<boolean>>(() => Promise.resolve(false))
  const boardDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null)
  const suppressBoardClickRef = useRef(false)
  const [peopleLoaded, setPeopleLoaded] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [face, setFace] = useState<FaceField[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('legal-process-card-face-v2') ?? 'null') as FaceField[] | null
      return saved && saved.every((item) => faceFields.some((field) => field.id === item)) ? saved : defaultFaceFields
    } catch { return defaultFaceFields }
  })

  const selectedProcessId = selected?.id ?? null

  const handleTabChange = (tab: MainTab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem('atech-legal-active-tab', tab)
    } catch {
      // Ignora erro de localStorage
    }
  }

  const copyToClipboard = (text: string, key: string) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((current) => current === key ? null : current)
      }, 2000)
    }).catch(() => {
      setNotice({ kind: 'error', text: 'Não foi possível copiar o texto.' })
    })
  }

  useEffect(() => {
    draftRef.current = draft
    if (selectedProcessId !== null) processIdRef.current = selectedProcessId
  }, [draft, selectedProcessId])

  useEffect(() => {
    if (!draft || (!newProcess && selectedProcessId === null)) return
    const serialized = JSON.stringify(draft)
    if (serialized === savedDraftRef.current) return
    if (!draft.title.trim()) {
      return
    }
    const statusTimer = window.setTimeout(() => {
      setAutoSaveState('pending')
      setAutoSaveError('')
    }, 0)
    const timer = window.setTimeout(() => {
      void queueProcessSaveRef.current(draft)
    }, 650)
    autoSaveTimerRef.current = timer
    return () => {
      window.clearTimeout(statusTimer)
      window.clearTimeout(timer)
      if (autoSaveTimerRef.current === timer) autoSaveTimerRef.current = null
    }
  }, [draft, newProcess, selectedProcessId])

  async function handleLegalCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setCsvTasks([])
    setCsvFileName('')
    setCsvQuery('')
    setCsvPage(1)
    setNotice(null)
    try {
      if (!file.name.toLocaleLowerCase().endsWith('.csv')) {
        throw new Error('Selecione um arquivo com extensão .csv.')
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('O arquivo CSV deve ter no máximo 10 MiB.')
      }

      const content = await decodeCsvFile(file)
      const parsed = Papa.parse<string[]>(content.replace(/^\uFEFF/, ''), {
        header: false,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
      })
      const parseError = parsed.errors.find((error) => error.code !== 'UndetectableDelimiter')
      if (parseError) throw new Error(`Não foi possível ler o CSV: ${parseError.message}`)

      const [headerRow, ...dataRows] = parsed.data
      if (!headerRow?.length) throw new Error('O arquivo CSV está vazio.')

      const headers = headerRow.map((header) => header.trim().toLocaleLowerCase('pt-BR'))
      const column = (name: string) => headers.indexOf(name.toLocaleLowerCase('pt-BR'))
      const nameIndex = column('Task Name')
      const statusIndex = column('Status')
      const idIndex = column('Task ID')
      if (nameIndex < 0 || statusIndex < 0 || idIndex < 0) {
        throw new Error('CSV incompatível. O cabeçalho precisa conter as colunas "Task ID", "Task Name" e "Status".')
      }
      const cell = (row: string[], index: number) => index < 0 ? '' : (row[index] ?? '').trim()
      const nonEmptyRows = dataRows.filter((row) => cell(row, nameIndex))
      if (!nonEmptyRows.length) throw new Error('O CSV não contém tarefas com nome.')
      if (nonEmptyRows.length > 5000) throw new Error('O CSV pode conter no máximo 5.000 tarefas.')
      if (nonEmptyRows.some((row) => !cell(row, idIndex))) {
        throw new Error('Há tarefas sem Task ID. Exporte novamente do ClickUp para permitir evitar cartões duplicados.')
      }
      if (new Set(nonEmptyRows.map((row) => cell(row, idIndex))).size !== nonEmptyRows.length) {
        throw new Error('O CSV contém Task IDs duplicados. Revise a exportação antes de importar.')
      }

      const assigneeIndex = column('Assignee')
      const priorityIndex = column('Priority')
      const dueDateIndex = column('Due Date')
      const contentIndex = column('Task Content')
      const commentIndex = column('Latest Comment')
      const commentCountIndex = column('Comment Count')
      const tasks = nonEmptyRows.map((row) => ({
        id: cell(row, idIndex),
        name: cell(row, nameIndex),
        status: cell(row, statusIndex) || 'Sem situação',
        assignee: cell(row, assigneeIndex),
        priority: cell(row, priorityIndex),
        dueDate: cell(row, dueDateIndex),
        taskContent: cell(row, contentIndex),
        latestComment: cell(row, commentIndex),
        commentCount: cell(row, commentCountIndex),
      }))
      setCsvTasks(tasks)
      setCsvFileName(file.name)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível ler o arquivo CSV.' })
    } finally {
      input.value = ''
    }
  }

  function clearCsvPreview() {
    setCsvTasks([])
    setCsvFileName('')
    setCsvQuery('')
    setCsvPage(1)
  }

  async function importCsvTasks() {
    if (!csvTasks.length || importingCsv) return
    const confirmed = window.confirm(
      `Importar ${csvTasks.length} cartões para Processos Jurídicos? Os dados serão salvos no banco. O arquivo CSV original não será guardado e Task IDs já importados serão ignorados.`,
    )
    if (!confirmed) return

    setImportingCsv(true)
    setNotice(null)
    try {
      const body = JSON.stringify({ tasks: csvTasks })
      if (new TextEncoder().encode(body).byteLength > 7_000_000) {
        throw new Error('O conteúdo do CSV é grande demais para importar em uma única operação.')
      }
      const result = await apiRequest<CsvImportResult>('/api/legal-processes/import-csv', {
        method: 'POST',
        body,
      })
      await load()
      setQuery('')
      setStatusFilter('')
      setCsvModalOpen(false)
      clearCsvPreview()
      setActiveTab('board')
      setNotice({
        kind: 'success',
        text: `Importação concluída: ${result.importedCount} cartão(ões) criado(s), ${result.skippedCount} já importado(s) ignorado(s) e ${result.statusesCreated} fase(s) criada(s).`,
      })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível importar os cartões do CSV.' })
    } finally {
      setImportingCsv(false)
    }
  }

  const load = useCallback(async () => {
    const [statusResult, processResult, enterpriseResult, tagResult] = await Promise.all([
      apiRequest<{ statuses: LegalStatus[] }>('/api/legal-processes/statuses'),
      apiRequest<{ processes: LegalProcess[] }>('/api/legal-processes'),
      apiRequest<{ enterprises: EnterpriseOption[] }>('/api/legal-processes/enterprises'),
      apiRequest<{ tags: LegalTag[] }>('/api/legal-processes/tags'),
    ])
    setStatuses(statusResult.statuses)
    setProcesses(processResult.processes)
    setEnterprises(enterpriseResult.enterprises)
    setLegalTags(tagResult.tags)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiRequest<{ statuses: LegalStatus[] }>('/api/legal-processes/statuses'),
      apiRequest<{ processes: LegalProcess[] }>('/api/legal-processes'),
      apiRequest<{ enterprises: EnterpriseOption[] }>('/api/legal-processes/enterprises'),
      apiRequest<{ tags: LegalTag[] }>('/api/legal-processes/tags'),
    ]).then((results) => {
      if (cancelled) return
      setStatuses(results[0].statuses)
      setProcesses(results[1].processes)
      setEnterprises(results[2].enterprises)
      setLegalTags(results[3].tags)
    }).catch((error: unknown) => {
      if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os processos jurídicos.' })
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (peopleLoaded) return
    let cancelled = false
    apiRequest<{ people: Assignee[] }>('/api/team/mentions')
      .then((result) => {
        if (cancelled) return
        setPeople(result.people)
        setPeopleLoaded(true)
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar as pessoas para responsáveis e menções.' })
      })
    return () => { cancelled = true }
  }, [peopleLoaded])

  const claimantOptions = useMemo(() =>
    [...new Set(processes.filter((process) => !process.is_demo).map((process) => process.claimant.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'pt-BR')),
  [processes])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    const normalizedProcessNumber = processNumberFilter.trim().toLocaleLowerCase('pt-BR')
    return processes.filter((process) => {
      if (statusFilter && String(process.status_id) !== statusFilter) return false
      if (enterpriseFilter && process.enterprise_key !== enterpriseFilter) return false
      if (tagFilter && !process.tags.some((tag) => String(tag.id) === tagFilter)) return false
      if (assigneeFilter && !process.assignees.some((assignee) => String(assignee.id) === assigneeFilter)) return false
      if (claimantFilter && process.claimant !== claimantFilter) return false
      if (valueFilter === 'with_value' && process.case_value === null) return false
      if (valueFilter === 'without_value' && process.case_value !== null) return false
      if (normalizedProcessNumber) {
        const allNumbers = `${process.process_number ?? ''} ${(process.child_process_numbers ?? []).join(' ')}`.toLocaleLowerCase('pt-BR')
        if (!allNumbers.includes(normalizedProcessNumber)) return false
      }
      if (normalizedQuery) {
        const haystack = `${process.title} ${process.process_number ?? ''} ${(process.child_process_numbers ?? []).join(' ')} ${process.enterprise_name} ${process.claimant} ${process.assignees.map((person) => person.displayName ?? person.display_name).join(' ')}`
          .toLocaleLowerCase('pt-BR')
        if (!haystack.includes(normalizedQuery)) return false
      }
      return true
    })
  }, [processes, query, processNumberFilter, statusFilter, enterpriseFilter, tagFilter, assigneeFilter, claimantFilter, valueFilter])

  // Lista ordenada
  const sortedProcesses = useMemo(() => {
    return [...filtered].sort((left, right) => {
      let comparison = 0
      switch (listSortField) {
        case 'title':
          comparison = left.title.localeCompare(right.title, 'pt-BR')
          break
        case 'processNumber':
          comparison = (left.process_number || '').localeCompare(right.process_number || '', 'pt-BR')
          break
        case 'enterprise':
          comparison = (left.enterprise_name || '').localeCompare(right.enterprise_name || '', 'pt-BR')
          break
        case 'status':
          comparison = left.status_name.localeCompare(right.status_name, 'pt-BR')
          break
        case 'claimant':
          comparison = (left.claimant || '').localeCompare(right.claimant || '', 'pt-BR')
          break
        case 'dates':
          comparison = (left.start_date || '').localeCompare(right.start_date || '')
          break
        case 'caseValue': {
          const lVal = left.case_value !== null ? Number(left.case_value) : -1
          const rVal = right.case_value !== null ? Number(right.case_value) : -1
          comparison = lVal - rVal
          break
        }
        case 'paidTotal':
          comparison = Number(left.paid_total || 0) - Number(right.paid_total || 0)
          break
      }
      return listSortDirection === 'asc' ? comparison : -comparison
    })
  }, [filtered, listSortField, listSortDirection])

  const toggleSort = (field: ListSortField) => {
    if (listSortField === field) {
      setListSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
    } else {
      setListSortField(field)
      setListSortDirection('asc')
    }
  }

  // Dashboard processes & metrics
  const dashboardProcesses = useMemo(() => {
    if (dashboardStartDate && dashboardEndDate && dashboardStartDate > dashboardEndDate) return []
    const normalizedDashNumber = dashboardProcessNumberFilter.trim().toLocaleLowerCase('pt-BR')
    return processes.filter((process) => {
      if (process.is_demo) return false
      if (dashboardStatusFilter && String(process.status_id) !== dashboardStatusFilter) return false
      if (dashboardEnterpriseFilter && process.enterprise_key !== dashboardEnterpriseFilter) return false
      if (dashboardClaimantFilter && process.claimant !== dashboardClaimantFilter) return false
      if (dashboardTagFilter && !process.tags.some((tag) => String(tag.id) === dashboardTagFilter)) return false
      if (normalizedDashNumber) {
        const allNumbers = `${process.process_number ?? ''} ${(process.child_process_numbers ?? []).join(' ')}`.toLocaleLowerCase('pt-BR')
        if (!allNumbers.includes(normalizedDashNumber)) return false
      }
      const startDate = dateInput(process.start_date)
      if (dashboardStartDate && (!startDate || startDate < dashboardStartDate)) return false
      if (dashboardEndDate && (!startDate || startDate > dashboardEndDate)) return false
      return true
    })
  }, [processes, dashboardStartDate, dashboardEndDate, dashboardStatusFilter, dashboardEnterpriseFilter, dashboardClaimantFilter, dashboardTagFilter, dashboardProcessNumberFilter])

  const concludedStatusIds = useMemo(() => new Set(statuses.filter((status) => isConcludedStatus(status.name)).map((status) => status.id)), [statuses])
  const dashboardConcludedProcesses = useMemo(() => dashboardProcesses.filter((process) => concludedStatusIds.has(process.status_id)), [dashboardProcesses, concludedStatusIds])
  const dashboardConcludedCount = dashboardConcludedProcesses.length
  const dashboardActiveProcesses = useMemo(() => dashboardProcesses.filter((process) => !concludedStatusIds.has(process.status_id)), [dashboardProcesses, concludedStatusIds])
  const dashboardTotalCaseValue = useMemo(() => dashboardActiveProcesses.reduce((total, process) =>
    total + (process.case_value === null ? 0 : Number(process.case_value)), 0), [dashboardActiveProcesses])
  const dashboardActiveProcessesWithCaseValue = useMemo(() => dashboardActiveProcesses.filter((process) => process.case_value !== null).length, [dashboardActiveProcesses])
  const dashboardMissingCaseValue = useMemo(() => dashboardProcesses.filter((process) => process.case_value === null).length, [dashboardProcesses])
  const dashboardTotalPaid = useMemo(() => dashboardProcesses.reduce((total, process) => total + (process.paid_total ? Number(process.paid_total) : 0), 0), [dashboardProcesses])

  // Desfechos / Conclusões no dashboard
  const conclusionStats = useMemo(() => {
    const withConclusion = dashboardConcludedProcesses.filter((p) => p.conclusion_result)
    const counts: Record<ConclusionResult, number> = {
      full_win: 0,
      partial_win: 0,
      partial_loss: 0,
      full_loss: 0,
    }
    for (const p of withConclusion) {
      if (p.conclusion_result && counts[p.conclusion_result] !== undefined) {
        counts[p.conclusion_result] += 1
      }
    }
    const totalWithConclusion = withConclusion.length
    const winCount = counts.full_win + counts.partial_win
    const winRate = totalWithConclusion ? Math.round((winCount / totalWithConclusion) * 100) : 0
    return { counts, totalWithConclusion, winRate }
  }, [dashboardConcludedProcesses])

  // Tempo médio de tramitação
  const averageDurationDays = useMemo(() => {
    const completedWithDates = dashboardConcludedProcesses.filter((p) => (p.start_date || p.distribution_date) && p.end_date)
    if (!completedWithDates.length) return null
    let totalDays = 0
    for (const p of completedWithDates) {
      const start = new Date(p.start_date || p.distribution_date!).getTime()
      const end = new Date(p.end_date!).getTime()
      if (end >= start) {
        totalDays += Math.round((end - start) / (1000 * 60 * 60 * 24))
      }
    }
    return Math.round(totalDays / completedWithDates.length)
  }, [dashboardConcludedProcesses])

  const dashboardStatuses = useMemo(() => statuses.map((status) => ({
    ...status,
    count: dashboardProcesses.filter((process) => process.status_id === status.id).length,
  })), [statuses, dashboardProcesses])

  const dashboardStatusMax = Math.max(1, ...dashboardStatuses.map((status) => status.count))

  const dashboardGroups = (field: 'claimant' | 'enterprise_name') => {
    const groups = new Map<string, { name: string; count: number; caseValue: number; missing: number }>()
    for (const process of dashboardProcesses) {
      const name = process[field].trim() || (field === 'claimant' ? 'Requerente não informado' : 'Empreendimento não informado')
      const group = groups.get(name) ?? { name, count: 0, caseValue: 0, missing: 0 }
      group.count += 1
      if (process.case_value === null) group.missing += 1
      else if (!concludedStatusIds.has(process.status_id)) group.caseValue += Number(process.case_value)
      groups.set(name, group)
    }
    return [...groups.values()]
      .sort((left, right) => right.count - left.count || right.caseValue - left.caseValue || left.name.localeCompare(right.name, 'pt-BR'))
      .slice(0, 10)
  }

  const dashboardClaimantGroups = dashboardGroups('claimant')
  const dashboardEnterpriseGroups = dashboardGroups('enterprise_name')
  const dashboardFiltersActive = Boolean(
    dashboardStatusFilter || dashboardEnterpriseFilter || dashboardClaimantFilter || dashboardTagFilter ||
    dashboardProcessNumberFilter || dashboardStartDate || dashboardEndDate,
  )

  const filteredCsvTasks = useMemo(() => {
    const normalizedQuery = csvQuery.toLocaleLowerCase('pt-BR')
    if (!normalizedQuery) return csvTasks
    return csvTasks.filter((task) =>
      `${task.name} ${task.status} ${task.assignee} ${task.priority} ${task.dueDate} ${task.taskContent} ${task.latestComment}`
        .toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  }, [csvTasks, csvQuery])

  const csvPageCount = Math.max(1, Math.ceil(filteredCsvTasks.length / listPageSize))
  const currentCsvPage = Math.min(csvPage, csvPageCount)
  const visibleCsvTasks = filteredCsvTasks.slice((currentCsvPage - 1) * listPageSize, currentCsvPage * listPageSize)

  const legalListKey = JSON.stringify([query, processNumberFilter, statusFilter, enterpriseFilter, tagFilter, assigneeFilter, claimantFilter, valueFilter, listSortField, listSortDirection, sortedProcesses.map((process) => process.id)])
  const [legalListPageState, setLegalListPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 })
  const legalListPageCount = Math.max(1, Math.ceil(sortedProcesses.length / listPageSize))
  const legalListPage = Math.min(legalListPageState.key === legalListKey ? legalListPageState.page : 1, legalListPageCount)
  const pagedProcesses = sortedProcesses.slice((legalListPage - 1) * listPageSize, legalListPage * listPageSize)

  const processPaginationKey = JSON.stringify([query, processNumberFilter, statusFilter, enterpriseFilter, tagFilter, assigneeFilter, claimantFilter, valueFilter, processes.map((process) => [process.id, process.status_id, process.enterprise_key])])
  const visibleProcessCounts = processPagination.key === processPaginationKey ? processPagination.counts : {}

  function loadMoreProcesses(statusKey: string, visibleCount: number) {
    setProcessPagination((current) => ({
      key: processPaginationKey,
      counts: { ...(current.key === processPaginationKey ? current.counts : {}), [statusKey]: visibleCount + kanbanPageSize },
    }))
  }

  async function moveStatus(statusId: number, offset: -1 | 1) {
    if (savingStatusOrder) return
    const fromIndex = statuses.findIndex((status) => status.id === statusId)
    const toIndex = fromIndex + offset
    if (fromIndex < 0 || toIndex < 0 || toIndex >= statuses.length) return
    const reordered = [...statuses]
    const [status] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, status)
    setSavingStatusOrder(true)
    try {
      const result = await apiRequest<{ statuses: LegalStatus[] }>('/api/legal-processes/statuses/order', {
        method: 'PUT',
        body: JSON.stringify({ statusIds: reordered.map((item) => item.id) }),
      })
      setStatuses(result.statuses)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível alterar a ordem dos status.' })
    } finally {
      setSavingStatusOrder(false)
    }
  }

  function moveBoard(direction: -1 | 1) {
    const board = boardRef.current
    if (!board) return
    const column = board.querySelector<HTMLElement>('.legal-column')
    board.scrollBy({ left: direction * (column ? column.offsetWidth + 13 : Math.max(board.clientWidth * 0.8, 260)), behavior: 'smooth' })
  }

  function startBoardDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest('.legal-process-card, .legal-new-column, button, input, select, a')) return
    boardDragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false }
  }

  function moveBoardDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = boardDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !(event.buttons & 1)) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 5) {
      if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId)
      drag.moved = true
      event.currentTarget.classList.add('is-dragging')
    }
    if (drag.moved) event.currentTarget.scrollLeft = drag.scrollLeft - delta
  }

  function endBoardDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = boardDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressBoardClickRef.current = true
      window.setTimeout(() => { suppressBoardClickRef.current = false }, 100)
    }
    boardDragRef.current = null
    event.currentTarget.classList.remove('is-dragging')
  }

  function toggleFaceField(field: FaceField) {
    const updated = face.includes(field) ? face.filter((item) => item !== field) : [...face, field]
    setFace(updated)
    localStorage.setItem('legal-process-card-face-v2', JSON.stringify(updated))
  }

  const openDetail = useCallback(async (
    item: Pick<LegalProcess, 'id'>,
    openScheduler = false,
    openConclusion = false,
    openReopen = false,
    requestedReopenStatusId?: number,
  ) => {
    setNotice(null)
    const token = ++editTokenRef.current
    try {
      const result = await apiRequest<{ process: ProcessDetail }>(`/api/legal-processes/${item.id}`)
      if (token !== editTokenRef.current) return
      processIdRef.current = result.process.id
      setSelected(result.process)
      setDetailTab('general')
      setShowProgrammingForm(openScheduler)
      const eligibleReopenStatuses = statuses.filter((status) => !isConcludedStatus(status.name))
      const selectedReopenStatus = eligibleReopenStatuses.find((status) => status.id === requestedReopenStatusId)
        ?? eligibleReopenStatuses[0]
      setShowReopenForm(openReopen && isConcludedStatus(
        statuses.find((status) => status.id === result.process.statusId)?.name ?? '',
      ))
      setReopenStatusId(selectedReopenStatus ? String(selectedReopenStatus.id) : '')
      setShowConclusionForm(openConclusion && !isConcludedStatus(
        statuses.find((status) => status.id === result.process.statusId)?.name ?? '',
      ))
      setConclusionResult('')
      setConclusionSummary('')
      const initialDraft = toDraft(result.process)
      savedDraftRef.current = JSON.stringify(initialDraft)
      setDraft(initialDraft)
      setAutoSaveState('saved')
      setAutoSaveError('')
      setPaymentDraft({ description: '', amount: '', dueDate: '', isPaid: false })
      setPaymentFile(null)
      const url = new URL(window.location.href)
      url.searchParams.set('processId', String(result.process.id))
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir o processo.' })
    }
  }, [statuses])

  useEffect(() => {
    const queryProcessId = initialProcessId || new URLSearchParams(window.location.search).get('processId')
    if (!queryProcessId) return
    const numericId = Number(queryProcessId)
    if (Number.isInteger(numericId) && numericId > 0 && processIdRef.current !== numericId) {
      void openDetail({ id: numericId })
      onProcessOpened?.()
    }
  }, [initialProcessId, onProcessOpened, openDetail])

  function startCreate(statusId = statuses.find((status) => !isConcludedStatus(status.name))?.id ?? statuses[0]?.id ?? 0) {
    editTokenRef.current += 1
    processIdRef.current = null
    setSelected(null)
    setDetailTab('general')
    setShowProgrammingForm(false)
    setShowConclusionForm(false)
    setShowReopenForm(false)
    setReopenStatusId('')
    const initialStatusId = isConcludedStatus(statuses.find((status) => status.id === statusId)?.name ?? '')
      ? statuses.find((status) => !isConcludedStatus(status.name))?.id ?? statusId
      : statusId
    const initialDraft = blankDraft(initialStatusId)
    savedDraftRef.current = JSON.stringify(initialDraft)
    setDraft(initialDraft)
    setNewProcess(true)
    setAutoSaveState('idle')
    setAutoSaveError('')
    setNotice(null)
  }

  async function closeEditor() {
    editTokenRef.current += 1
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (draft && draft.title.trim() && JSON.stringify(draft) !== savedDraftRef.current) {
      try {
        await queueProcessSave(draft)
      } catch {
        // Ignora erros para nunca prender o usuário na tela ao clicar em voltar
      }
    }
    setNewProcess(false)
    setSelected(null)
    setShowProgrammingForm(false)
    setShowConclusionForm(false)
    setShowReopenForm(false)
    setReopenStatusId('')
    setConclusionResult('')
    setConclusionSummary('')
    processIdRef.current = null
    setDraft(null)
    setReplyingTo(null)
    setEditingComment(null)
    setAutoSaveState('idle')
    setAutoSaveError('')
    const url = new URL(window.location.href)
    url.searchParams.delete('processId')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const queueProcessSave = useCallback((snapshot: ProcessDraft): Promise<boolean> => {
    pendingProcessSaveRef.current = { draft: snapshot, token: editTokenRef.current }
    if (autoSavePromiseRef.current) return autoSavePromiseRef.current

    const saveTask = (async () => {
      while (pendingProcessSaveRef.current) {
        const job = pendingProcessSaveRef.current
        pendingProcessSaveRef.current = null
        if (job.token !== editTokenRef.current) continue

        if (job.draft.children.some((child) =>
          (child.id !== undefined || child.processNumber.trim() || child.description.trim()) &&
          (!child.processNumber.trim() || !child.description.trim()))) {
          setAutoSaveState('error')
          setAutoSaveError('Preencha o número e a descrição de cada processo filho para salvar.')
          return false
        }
        if (job.draft.items.some((item) => item.id !== undefined && !item.title.trim())) {
          setAutoSaveState('error')
          setAutoSaveError('Preencha a descrição dos itens existentes antes de salvar.')
          return false
        }
        const caseValue = job.draft.caseValue.trim() ? Number(job.draft.caseValue) : null
        if (caseValue !== null && !Number.isFinite(caseValue)) {
          setAutoSaveState('error')
          setAutoSaveError('Informe um valor válido para a causa.')
          return false
        }
        if (job.draft.startDate && job.draft.endDate && job.draft.endDate < job.draft.startDate) {
          setAutoSaveState('error')
          setAutoSaveError('A data de finalização deve ser igual ou posterior à data de início.')
          return false
        }

        const body = {
          ...job.draft,
          title: job.draft.title.trim(),
          processNumber: formatCnjProcessNumber(job.draft.processNumber).trim(),
          enterpriseKey: job.draft.enterpriseKey || null,
          startDate: job.draft.startDate || null,
          endDate: job.draft.endDate || null,
          caseValue,
          distributionDate: job.draft.distributionDate || null,
          children: job.draft.children
            .filter((child) => child.processNumber.trim() && child.description.trim())
            .map((child) => ({ ...child, processNumber: formatCnjProcessNumber(child.processNumber).trim() })),
          items: job.draft.items.filter((item) => item.title.trim()),
        }
        setAutoSaveState('saving')
        setAutoSaveError('')
        try {
          let processId = processIdRef.current
          if (processId === null) {
            const created = await apiRequest<{ id: number }>('/api/legal-processes', { method: 'POST', body: JSON.stringify(body) })
            processId = created.id
            processIdRef.current = processId
            if (job.token === editTokenRef.current) setNewProcess(false)
          } else {
            await apiRequest(`/api/legal-processes/${processId}`, { method: 'PUT', body: JSON.stringify(body) })
          }
          await load()
          const detail = await apiRequest<{ process: ProcessDetail }>(`/api/legal-processes/${processId}`)
          savedDraftRef.current = JSON.stringify(job.draft)
          if (job.token === editTokenRef.current) {
            setSelected(detail.process)
            setAutoSaveState('saved')
          }
        } catch (error) {
          if (job.token === editTokenRef.current) {
            setAutoSaveState('error')
            setAutoSaveError(error instanceof Error ? error.message : 'Não foi possível salvar as alterações do processo.')
          }
          return false
        }
      }
      return true
    })()
    autoSavePromiseRef.current = saveTask
    void saveTask.finally(() => {
      if (autoSavePromiseRef.current === saveTask) autoSavePromiseRef.current = null
      if (pendingProcessSaveRef.current && pendingProcessSaveRef.current.token === editTokenRef.current) {
        void queueProcessSaveRef.current(pendingProcessSaveRef.current.draft)
      }
    })
    return saveTask
  }, [load])

  useEffect(() => {
    queueProcessSaveRef.current = queueProcessSave
  }, [queueProcessSave])

  function updateCommentText(value: string, cursor: number) {
    setComment(value)
    setMentionCursor(cursor)
    setMentions((current) => current.filter((id) => {
      const person = people.find((entry) => Number(entry.id) === id)
      return person && value.includes(`@${assigneeName(person)}`)
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

  function insertMention(person: Assignee) {
    if (mentionStart === null || mentionCursor === null) return
    const token = `@${assigneeName(person)} `
    setComment(`${comment.slice(0, mentionStart)}${token}${comment.slice(mentionCursor)}`)
    setMentions((current) => [...new Set([...current, Number(person.id)])])
    setMentionStart(null)
    setMentionQuery(null)
    setMentionCursor(null)
  }

  async function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !comment.trim()) return
    setBusyComment(true)
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: comment,
          mentionIds: mentions.filter((id) => {
            const person = people.find((entry) => Number(entry.id) === id)
            return person && comment.includes(`@${assigneeName(person)}`)
          }),
          parentCommentId: replyingTo,
        }),
      })
      setComment('')
      setMentions([])
      setReplyingTo(null)
      setMentionQuery(null)
      await refreshSelected(selected.id)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível adicionar o comentário.' })
    } finally { setBusyComment(false) }
  }

  async function refreshSelected(id: number) {
    const result = await apiRequest<{ process: ProcessDetail }>(`/api/legal-processes/${id}`)
    setSelected(result.process)
    const currentDraft = draftRef.current
    if (currentDraft && JSON.stringify(currentDraft) === savedDraftRef.current) {
      const refreshedDraft = toDraft(result.process)
      savedDraftRef.current = JSON.stringify(refreshedDraft)
      setDraft(refreshedDraft)
    }
  }

  async function saveComment(commentId: number, body: string) {
    if (!selected) return
    setBusyComment(true)
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      })
      setEditingComment(null)
      await refreshSelected(selected.id)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível editar o comentário.' })
    } finally { setBusyComment(false) }
  }

  async function deleteComment(commentId: number) {
    if (!selected || !window.confirm('Excluir este comentário e suas respostas?')) return
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/comments/${commentId}`, { method: 'DELETE' })
      await refreshSelected(selected.id)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o comentário.' })
    }
  }

  async function changeStatus(process: LegalProcess, statusId: number) {
    const targetStatus = statuses.find((status) => status.id === statusId)
    if (targetStatus && isConcludedStatus(targetStatus.name) && !isConcludedStatus(process.status_name)) {
      void openDetail(process, false, true)
      return
    }
    if (targetStatus && !isConcludedStatus(targetStatus.name) && isConcludedStatus(process.status_name)) {
      void openDetail(process, false, false, true, statusId)
      return
    }
    const original = process.status_id
    setProcesses((items) => items.map((item) => item.id === process.id
      ? { ...item, status_id: statusId, status_name: statuses.find((status) => status.id === statusId)?.name ?? item.status_name }
      : item))
    try {
      await apiRequest(`/api/legal-processes/${process.id}/status`, { method: 'PATCH', body: JSON.stringify({ statusId }) })
      await load()
    } catch (error) {
      setProcesses((items) => items.map((item) => item.id === process.id ? { ...item, status_id: original } : item))
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível mover o processo.' })
    }
  }

  async function completeSelectedProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !conclusionResult || savingConclusion) return
    setSavingConclusion(true)
    setNotice(null)
    try {
      if (draft && JSON.stringify(draft) !== savedDraftRef.current) {
        const saved = await queueProcessSave(draft)
        if (!saved) throw new Error('Salve as alterações pendentes antes de concluir o processo.')
      }
      await apiRequest(`/api/legal-processes/${selected.id}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ result: conclusionResult, summary: conclusionSummary }),
      })
      await load()
      await openDetail({ id: selected.id })
      setNotice({ kind: 'success', text: 'Processo concluído e resultado registrado.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível concluir o processo.' })
    } finally {
      setSavingConclusion(false)
    }
  }

  async function reopenSelectedProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !reopenStatusId || savingConclusion) return
    setSavingConclusion(true)
    setNotice(null)
    try {
      if (draft && JSON.stringify(draft) !== savedDraftRef.current) {
        const saved = await queueProcessSave(draft)
        if (!saved) throw new Error('Salve as alterações pendentes antes de reabrir o processo.')
      }
      await apiRequest(`/api/legal-processes/${selected.id}/reopen`, {
        method: 'PATCH',
        body: JSON.stringify({ statusId: Number(reopenStatusId) }),
      })
      await load()
      await openDetail({ id: selected.id })
      setNotice({ kind: 'success', text: 'Processo reaberto. Os dados da conclusão anterior foram mantidos no histórico.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível reabrir o processo.' })
    } finally {
      setSavingConclusion(false)
    }
  }

  async function saveProcessTags(tagIds: number[]) {
    if (!selected) return
    try {
      const result = await apiRequest<{ tags: LegalTag[] }>(`/api/legal-processes/${selected.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds }),
      })
      setSelected((current) => current ? { ...current, tags: result.tags } : current)
      setProcesses((current) => current.map((process) => process.id === selected.id
        ? { ...process, tags: result.tags }
        : process))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar as tags do processo.' })
    }
  }

  async function toggleProcessTag(tagId: number, checked: boolean) {
    if (!selected) return
    const currentTagIds = selected.tags.map((tag) => tag.id)
    await saveProcessTags(checked
      ? [...new Set([...currentTagIds, tagId])]
      : currentTagIds.filter((id) => id !== tagId))
  }

  async function createLegalTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!legalTagName.trim() || creatingLegalTag) return
    setCreatingLegalTag(true)
    try {
      const result = await apiRequest<{ tag: LegalTag }>('/api/legal-processes/tags', {
        method: 'POST',
        body: JSON.stringify({ name: legalTagName, color: legalTagColor }),
      })
      setLegalTags((current) => [...current, result.tag].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')))
      setLegalTagName('')
      setNotice({ kind: 'success', text: 'Tag jurídica criada com sucesso.' })
      if (selected) await saveProcessTags([...selected.tags.map((tag) => tag.id), result.tag.id])
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar a tag jurídica.' })
    } finally {
      setCreatingLegalTag(false)
    }
  }

  async function createStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    try {
      await apiRequest('/api/legal-processes/statuses', {
        method: 'POST', body: JSON.stringify({ name: statusName, color: statusColor }),
      })
      setStatusName('')
      setShowStatusForm(false)
      await load()
      setNotice({ kind: 'success', text: 'Status criado com sucesso.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar o status.' })
    }
  }

  async function updateStatus(event: FormEvent<HTMLFormElement>, status: LegalStatus) {
    event.preventDefault()
    try {
      const result = await apiRequest<{ status: LegalStatus }>(`/api/legal-processes/statuses/${status.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editingStatusName, color: status.color }),
      })
      setStatuses((current) => current.map((item) => item.id === status.id ? result.status : item))
      setEditingStatusId(null)
      setEditingStatusName('')
      setNotice({ kind: 'success', text: 'Nome da situação atualizado.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o nome da situação.' })
    }
  }

  async function deleteStatus(status: LegalStatus) {
    if (!window.confirm(`Excluir o status “${status.name}”?`)) return
    try {
      await apiRequest(`/api/legal-processes/statuses/${status.id}`, { method: 'DELETE' })
      await load()
      setNotice({ kind: 'success', text: 'Status excluído com sucesso.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o status.' })
    }
  }

  async function deleteProcess() {
    if (!selected || !window.confirm('Excluir este processo e todos os pagamentos, comprovantes e programações vinculados?')) return
    try {
      await apiRequest(`/api/legal-processes/${selected.id}`, { method: 'DELETE' })
      closeEditor()
      await load()
      setNotice({ kind: 'success', text: 'Processo excluído com sucesso.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o processo.' })
    }
  }

  async function createDemo() {
    try {
      await apiRequest('/api/legal-processes/demo', { method: 'POST' })
      await load()
      setNotice({ kind: 'success', text: 'Exemplo fictício criado. Você pode abrir, editar e excluir o cartão.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar o exemplo.' })
    }
  }

  async function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !paymentDraft.description.trim() || paymentDraft.amount === '') return
    setSavingPayment(true)
    try {
      const created = await apiRequest<{ id: number }>(`/api/legal-processes/${selected.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          ...paymentDraft,
          amount: Number(paymentDraft.amount),
          dueDate: paymentDraft.dueDate || null,
        }),
      })
      if (paymentFile) {
        await apiRequest(`/api/legal-processes/${selected.id}/payments/${created.id}/attachments`, {
          method: 'POST',
          body: JSON.stringify({
            fileName: paymentFile.name,
            contentType: paymentFile.type || 'application/octet-stream',
            contentBase64: await fileBase64(paymentFile),
          }),
        })
      }
      setPaymentDraft({ description: '', amount: '', dueDate: '', isPaid: false })
      setPaymentFile(null)
      await openDetail({ id: selected.id })
      await load()
      setNotice({ kind: 'success', text: 'Pagamento adicionado com sucesso.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível adicionar o pagamento.' })
    } finally { setSavingPayment(false) }
  }

  async function updatePayment(payment: LegalPayment, patch: Partial<LegalPayment>) {
    if (!selected) return
    setBusyPayment(payment.id)
    const next = { ...payment, ...patch }
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/payments/${payment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: next.description,
          amount: Number(next.amount),
          dueDate: next.dueDate,
          isPaid: next.isPaid,
        }),
      })
      await openDetail({ id: selected.id })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o pagamento.' })
    } finally { setBusyPayment(null) }
  }

  async function deletePayment(payment: LegalPayment) {
    if (!selected || !window.confirm(`Excluir o pagamento “${payment.description}” e seus comprovantes?`)) return
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/payments/${payment.id}`, { method: 'DELETE' })
      await openDetail({ id: selected.id })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o pagamento.' })
    }
  }

  async function downloadProof(payment: LegalPayment, attachment: PaymentAttachment) {
    if (!selected) return
    try {
      const response = await fetch(`/api/legal-processes/${selected.id}/payments/${payment.id}/attachments/${attachment.id}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Não foi possível baixar o comprovante.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Falha ao baixar o comprovante.' })
    }
  }

  const assigneeName = (person: Assignee) => person.displayName ?? person.display_name ?? person.email ?? 'Usuário'
  const assigneeOptions = people.map((person) => ({ value: String(person.id), label: assigneeName(person) }))

  const faceValue = (process: LegalProcess, field: FaceField) => {
    if (field === 'processNumber') return process.process_number ? `Nº único: ${process.process_number}` : 'Nº único não informado'
    if (field === 'enterprise') return process.enterprise_name || 'Empreendimento não associado'
    if (field === 'claimant') return process.claimant || 'Requerente não informado'
    if (field === 'assignees') return process.assignees.map(assigneeName).join(', ') || 'Sem responsáveis'
    if (field === 'dates') return `${showDate(process.start_date)} — ${showDate(process.end_date)}`
    if (field === 'caseValue') return process.case_value ? currency.format(Number(process.case_value)) : 'Valor não informado'
    if (field === 'children') return `${process.completed_children_count}/${process.children_count} processos filhos`
    if (field === 'paidTotal') return `Pago ${currency.format(Number(process.paid_total))}`
    return `Distribuição ${showDate(process.distribution_date)}`
  }

  // Tecla Escape para fechar modais/painéis
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (csvModalOpen) {
        setCsvModalOpen(false)
        return
      }
      if (faceMenu) {
        setFaceMenu(false)
        return
      }
      if (mentionQuery !== null) {
        setMentionQuery(null)
        setMentionStart(null)
        return
      }
      if (editingComment) {
        setEditingComment(null)
        return
      }
      if (showConclusionForm) {
        setShowConclusionForm(false)
        return
      }
      if (showReopenForm) {
        setShowReopenForm(false)
        return
      }
      if (showProgrammingForm) {
        setShowProgrammingForm(false)
        return
      }
      if (showStatusForm) {
        setShowStatusForm(false)
        return
      }
      if (detailPageOpen) {
        void closeEditor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const activeFiltersCount = [
    query, processNumberFilter, statusFilter, enterpriseFilter, tagFilter, assigneeFilter, claimantFilter,
    valueFilter !== 'all' ? valueFilter : '',
  ].filter(Boolean).length

  function clearAllFilters() {
    setQuery('')
    setProcessNumberFilter('')
    setStatusFilter('')
    setEnterpriseFilter('')
    setTagFilter('')
    setAssigneeFilter('')
    setClaimantFilter('')
    setValueFilter('all')
  }

  // Render do cartão no Kanban
  function processCard(process: LegalProcess, compact = false) {
    const totalTasks = (process.items_count ?? 0) + (process.children_count ?? 0)
    const doneTasks = (process.completed_items_count ?? 0) + (process.completed_children_count ?? 0)
    const taskPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

    // Alerta de vencimento
    const targetDate = process.end_date ? process.end_date.slice(0, 10) : ''
    const isOverdue = Boolean(targetDate && targetDate < today)
    const isDueSoon = Boolean(targetDate && !isOverdue && targetDate <= inSevenDays)

    return (
      <article
        className={`legal-process-card ${process.is_demo ? 'legal-demo-card' : ''}`}
        key={process.id}
        role="button"
        tabIndex={0}
        style={{ borderTopColor: process.status_color }}
        aria-label={`Abrir processo jurídico ${process.title}`}
        draggable={!compact}
        onDragStart={() => setDragged(process.id)}
        onDragEnd={() => setDragged(null)}
        onClick={() => void openDetail(process)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          void openDetail(process)
        }}
      >
        <div className="legal-process-card-top">
          <span className="legal-process-card-id">{process.is_demo ? 'EXEMPLO' : `#${process.id}`}</span>
          <span className="legal-process-card-tools">
            {!process.is_demo && (
              <button
                type="button"
                aria-label={`Agendar atividade para ${process.title}`}
                title="Agendar atividade para este processo"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); void openDetail(process, true) }}
              >
                <CalendarDays size={13} />
              </button>
            )}
            <GripVertical size={14} className="legal-grip-icon" />
          </span>
        </div>

        <strong className="legal-process-card-title">{process.title}</strong>

        {/* Número único em destaque com botão de cópia rápida */}
        {face.includes('processNumber') && process.process_number && (
          <div className="legal-process-card-number-badge" onClick={(event) => event.stopPropagation()}>
            <span title={process.process_number}>{process.process_number}</span>
            <button
              type="button"
              className="icon-button"
              title="Copiar número do processo"
              aria-label="Copiar número do processo"
              onClick={() => copyToClipboard(process.process_number, `${process.id}-num`)}
            >
              {copiedKey === `${process.id}-num` ? <Check size={11} className="legal-copy-success" /> : <Copy size={11} />}
            </button>
          </div>
        )}

        {/* Metadados configurados */}
        <div className="legal-process-card-metas">
          {face.filter((field) => field !== 'processNumber').map((field) => (
            <div className="legal-process-card-meta-row" key={field}>
              {field === 'enterprise' && <Building2 size={12} />}
              {field === 'claimant' && <User size={12} />}
              {field === 'dates' && <Calendar size={12} />}
              {field === 'caseValue' && <Coins size={12} />}
              {field === 'paidTotal' && <Receipt size={12} />}
              {field === 'children' && <Layers size={12} />}
              {field === 'distributionDate' && <Clock size={12} />}
              <span>{faceValue(process, field)}</span>
            </div>
          ))}
        </div>

        {/* Alerta de prazo */}
        {process.end_date && (isOverdue || isDueSoon) && (
          <div className={`legal-card-deadline-alert ${isOverdue ? 'is-overdue' : 'is-duesoon'}`}>
            <Clock size={11} />
            <span>{isOverdue ? `Atrasado desde ${showDate(process.end_date)}` : `Vence em ${showDate(process.end_date)}`}</span>
          </div>
        )}

        {/* Barra de progresso de subtarefas / itens */}
        {totalTasks > 0 && (
          <div className="legal-card-progress" title={`${doneTasks} de ${totalTasks} tarefas concluídas (${taskPercent}%)`}>
            <div className="legal-card-progress-labels">
              <span className="legal-card-progress-text"><CheckSquare size={11} /> {doneTasks}/{totalTasks} tarefas</span>
              <span className="legal-card-progress-pct">{taskPercent}%</span>
            </div>
            <div className="legal-card-progress-track">
              <div className="legal-card-progress-bar" style={{ width: `${taskPercent}%` }} />
            </div>
          </div>
        )}

        {/* Tags */}
        {process.tags.length > 0 && (
          <div className="legal-process-card-tags">
            {process.tags.slice(0, 3).map((tag) => (
              <span key={tag.id} style={{ color: tag.color, borderColor: `${tag.color}55`, background: `${tag.color}14` }}>{tag.name}</span>
            ))}
            {process.tags.length > 3 && <small>+{process.tags.length - 3}</small>}
          </div>
        )}

        <footer>
          <span className="legal-process-assignee-icons">
            {process.assignees.slice(0, 3).map((person) => (
              <i title={assigneeName(person)} key={person.id}>{assigneeName(person).slice(0, 1).toUpperCase()}</i>
            ))}
            {process.assignees.length > 3 && <small className="assignees-overflow">+{process.assignees.length - 3}</small>}
          </span>
          <span className="legal-card-payment-counter"><Receipt size={12} /> {process.payment_count} pagto(s)</span>
        </footer>

        {compact && (
          <select aria-label={`Mover ${process.title} para outro status`} value={process.status_id} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void changeStatus(process, Number(event.target.value)) }}>
            {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
          </select>
        )}
      </article>
    )
  }

  // Cálculos financeiros do processo selecionado
  const detailCaseValue = draft?.caseValue ? Number(draft.caseValue) : null
  const detailPaidTotal = selected ? Number(selected.paidTotal || 0) : 0
  const detailPendingTotal = selected ? Number(selected.pendingPaymentTotal || 0) : 0
  const detailBalance = detailCaseValue !== null ? detailCaseValue - detailPaidTotal : null

  // Progresso dos itens do checklist
  const checklistItems = draft?.items ?? []
  const completedChecklistCount = checklistItems.filter((item) => item.isDone).length
  const checklistPercent = checklistItems.length ? Math.round((completedChecklistCount / checklistItems.length) * 100) : 0

  return (
    <section className={`legal-page${!detailPageOpen && activeTab === 'board' && processes.length > 0 ? ' legal-board-page' : ''}`}>
      {/* Cabeçalho superior */}
      <header className="legal-heading">
        <div className="legal-heading-text">
          <span className="eyebrow">GESTÃO JURÍDICA</span>
          <h1>
            {detailPageOpen
              ? (newProcess ? 'Novo processo' : selected?.title ?? 'Processo jurídico')
              : activeTab === 'dashboard' ? 'Dashboard Jurídico' : 'Processos Jurídicos'}
          </h1>
          <p>
            {detailPageOpen
              ? 'Consulte dados, checklist, incidentes, financeiro e histórico do processo.'
              : activeTab === 'dashboard'
                ? 'Indicadores analíticos de causas, valores, desfechos e tramitação.'
                : 'Acompanhe processos, responsáveis, prazos, comprovantes e pagamentos em tempo real.'}
          </p>
        </div>

        <div className="legal-heading-actions">
          {detailPageOpen ? (
            <>
              {autoSaveState !== 'idle' && (
                <span
                  className={`legal-autosave-pill is-${autoSaveState}`}
                  role="status"
                  aria-live="polite"
                  title={autoSaveError || undefined}
                >
                  {(autoSaveState === 'pending' || autoSaveState === 'saving') && 'Salvando alterações...'}
                  {autoSaveState === 'saved' && '✓ Salvo automaticamente'}
                  {autoSaveState === 'error' && (autoSaveError || 'Erro ao salvar')}
                </span>
              )}
              <button type="button" className="secondary-button" onClick={() => void closeEditor()}>
                <ArrowLeft size={15} /> Voltar ao painel
              </button>
            </>
          ) : (
            <>
              {/* Abas superiores integradas (Quadro, Lista, Dashboard) */}
              <div className="legal-main-tabs" role="tablist" aria-label="Visualizações principais">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'board'}
                  className={`legal-main-tab ${activeTab === 'board' ? 'is-active' : ''}`}
                  onClick={() => handleTabChange('board')}
                >
                  <Columns3 size={15} /> Quadro
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'list'}
                  className={`legal-main-tab ${activeTab === 'list' ? 'is-active' : ''}`}
                  onClick={() => handleTabChange('list')}
                >
                  <List size={15} /> Lista
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'dashboard'}
                  className={`legal-main-tab ${activeTab === 'dashboard' ? 'is-active' : ''}`}
                  onClick={() => handleTabChange('dashboard')}
                >
                  <BarChart3 size={15} /> Dashboard
                </button>
              </div>

              {currentUser.role === 'admin' && (
                <button type="button" className="secondary-button" onClick={() => setCsvModalOpen(true)}>
                  <UploadCloud size={15} /> Importar ClickUp
                </button>
              )}

              <button type="button" className="primary-button" onClick={() => startCreate()} disabled={!statuses.length}>
                <Plus size={16} /> Novo processo
              </button>
            </>
          )}
        </div>
      </header>

      {/* Avisos e notificações */}
      {notice && (
        <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span className="notice-symbol">{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button>
        </div>
      )}

      {/* MODAL DE IMPORTAÇÃO CSV CLICKUP (Fase 1) */}
      {csvModalOpen && (
        <div className="legal-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="csv-modal-title">
          <div className="legal-modal legal-csv-modal">
            <header className="legal-modal-heading">
              <div className="legal-modal-title-wrap">
                <FileSpreadsheet size={22} className="legal-modal-icon" />
                <div>
                  <h2 id="csv-modal-title">Importar cartões do ClickUp</h2>
                  <p>Selecione a exportação CSV de tarefas. Task IDs já importados são ignorados.</p>
                </div>
              </div>
              <button type="button" className="icon-button" onClick={() => setCsvModalOpen(false)} aria-label="Fechar importação">
                <X size={18} />
              </button>
            </header>

            <div className="legal-csv-modal-body">
              {!csvFileName ? (
                <label className="legal-csv-dropzone">
                  <UploadCloud size={32} />
                  <strong>Selecione o arquivo CSV</strong>
                  <span>Tamanho máximo 10 MiB com colunas Task ID, Task Name e Status.</span>
                  <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void handleLegalCsvSelected(event)} />
                </label>
              ) : (
                <div className="legal-csv-preview">
                  <div className="legal-csv-preview-heading">
                    <span><strong>{csvFileName}</strong> · {csvTasks.length} tarefas prontas para importar</span>
                    <button type="button" className="text-action-btn" onClick={clearCsvPreview}><X size={14} /> Trocar arquivo</button>
                  </div>
                  <label className="search-box legal-csv-search">
                    <Search size={15} />
                    <input type="search" placeholder="Buscar nas tarefas do CSV" value={csvQuery} onChange={(event) => { setCsvQuery(event.target.value); setCsvPage(1) }} />
                  </label>
                  <div className="legal-csv-table-wrap">
                    <table className="legal-csv-table">
                      <thead>
                        <tr>
                          <th>Tarefa</th>
                          <th>Status</th>
                          <th>Responsável</th>
                          <th>Prioridade</th>
                          <th>Prazo</th>
                          <th>Comentários</th>
                          <th>Descrição e último comentário</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCsvTasks.map((task, index) => (
                          <tr key={`${task.id}-${(currentCsvPage - 1) * listPageSize + index}`}>
                            <td><strong>{task.name}</strong><small>{task.id}</small></td>
                            <td>{task.status}</td>
                            <td>{task.assignee || '—'}</td>
                            <td>{task.priority || '—'}</td>
                            <td>{task.dueDate || '—'}</td>
                            <td>{task.commentCount || '—'}</td>
                            <td className="legal-csv-details">
                              {task.taskContent && <details><summary>Ver descrição</summary><p>{task.taskContent}</p></details>}
                              {task.latestComment && <details><summary>Ver último comentário</summary><p>{task.latestComment}</p></details>}
                              {!task.taskContent && !task.latestComment && '—'}
                            </td>
                          </tr>
                        ))}
                        {!visibleCsvTasks.length && <tr><td colSpan={7}>Nenhuma tarefa corresponde à busca.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <LegalListPagination total={filteredCsvTasks.length} page={currentCsvPage} pageCount={csvPageCount} pageSize={listPageSize} onPageChange={setCsvPage} />
                  <div className="legal-csv-modal-actions">
                    <button type="button" className="secondary-button" onClick={() => setCsvModalOpen(false)}>Cancelar</button>
                    <button type="button" className="primary-button" disabled={importingCsv || !csvTasks.length} onClick={() => void importCsvTasks()}>
                      <Download size={15} />{importingCsv ? 'Importando cartões...' : `Confirmar e importar ${csvTasks.length} cartões`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VISTA DE PROCESSOS (QUADRO OU LISTA) */}
      {!detailPageOpen && activeTab !== 'dashboard' && (
        <>
          {/* Barra de Ferramentas e Filtros */}
          <div className="legal-toolbar">
            <div className="legal-toolbar-top">
              <div className="legal-toolbar-left">
                <button
                  type="button"
                  className="legal-filter-toggle"
                  aria-expanded={filtersExpanded}
                  onClick={() => setFiltersExpanded((expanded) => !expanded)}
                >
                  <ChevronDown size={15} className={`legal-filter-chevron ${filtersExpanded ? 'is-expanded' : ''}`} />
                  {filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
                  {activeFiltersCount > 0 && <span className="legal-filter-badge">{activeFiltersCount} ativo(s)</span>}
                </button>
                <button
                  type="button"
                  className="filter-clear-button"
                  disabled={!activeFiltersCount}
                  onClick={clearAllFilters}
                >
                  <X size={14} /> Limpar filtros
                </button>
              </div>

              <div className="legal-toolbar-actions">
                {activeTab === 'list' && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!filtered.length}
                    onClick={() => exportProcessesToCsv(sortedProcesses)}
                    title="Exportar processos filtrados para planilha CSV"
                  >
                    <Download size={14} /> Exportar CSV
                  </button>
                )}

                {activeTab === 'board' && (
                  <div className="legal-face-menu-wrap">
                    <button type="button" className="secondary-button" aria-expanded={faceMenu} onClick={() => setFaceMenu((value) => !value)}>
                      Campos do cartão
                    </button>
                    {faceMenu && (
                      <div className="legal-face-menu">
                        {faceFields.map((field) => (
                          <label key={field.id}>
                            <input type="checkbox" checked={face.includes(field.id)} onChange={() => toggleFaceField(field.id)} />
                            {field.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Painel de Filtros Avançados */}
            {filtersExpanded && (
              <div className="legal-filter-fields">
                <label className="legal-filter-item legal-filter-search">
                  <span>Busca geral</span>
                  <div className="search-box">
                    <Search size={15} />
                    <input
                      type="search"
                      placeholder="Buscar por nome, número, requerente ou responsável..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                </label>
                <label className="legal-filter-item">
                  <span>Número único do processo</span>
                  <input
                    type="search"
                    placeholder="0000000-00.0000.0.00.0000"
                    value={processNumberFilter}
                    onChange={(event) => setProcessNumberFilter(event.target.value)}
                  />
                </label>
                <label className="legal-filter-item">
                  <span>Situação / Fase</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="">Todas as situações</option>
                    {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                  </select>
                </label>
                <label className="legal-filter-item">
                  <span>Empreendimento</span>
                  <select value={enterpriseFilter} onChange={(event) => setEnterpriseFilter(event.target.value)}>
                    <option value="">Todos os empreendimentos</option>
                    {enterprises.map((ent) => <option key={ent.enterprise_key} value={ent.enterprise_key}>{ent.enterprise_name}</option>)}
                  </select>
                </label>
                <label className="legal-filter-item">
                  <span>Responsável</span>
                  <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                    <option value="">Todos os responsáveis</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{assigneeName(person)}</option>)}
                  </select>
                </label>
                <label className="legal-filter-item">
                  <span>Requerente</span>
                  <select value={claimantFilter} onChange={(event) => setClaimantFilter(event.target.value)}>
                    <option value="">Todos os requerentes</option>
                    {claimantOptions.map((claimant) => <option key={claimant} value={claimant}>{claimant}</option>)}
                  </select>
                </label>
                <label className="legal-filter-item">
                  <span>Valor da causa</span>
                  <select value={valueFilter} onChange={(event) => setValueFilter(event.target.value as typeof valueFilter)}>
                    <option value="all">Todos os valores</option>
                    <option value="with_value">Com valor informado</option>
                    <option value="without_value">Sem valor informado</option>
                  </select>
                </label>
                <label className="legal-filter-item">
                  <span>Tag jurídica</span>
                  <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                    <option value="">Todas as tags</option>
                    {legalTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Gerenciador de fases e situações (recolhível) */}
          {filtersExpanded && (
            <details className="legal-status-manager" open={statusManagerOpen} onToggle={(event) => setStatusManagerOpen(event.currentTarget.open)}>
              <summary>
                <span>
                  <strong>Organizar situações e fases do fluxo</strong>
                  <small>Ajuste a ordem das colunas do Kanban, altere nomes ou remova fases não utilizadas.</small>
                </span>
                <i>{statuses.length} fases ativas</i>
                <ChevronDown size={16} />
              </summary>
              <div className="legal-status-toolbar">
                {statuses.map((status, index) => (
                  <div className="legal-status-chip" key={status.id}>
                    <i style={{ background: status.color }} />
                    {editingStatusId === status.id ? (
                      <form className="legal-status-edit-form" onSubmit={(event) => void updateStatus(event, status)}>
                        <input aria-label={`Novo nome para ${status.name}`} value={editingStatusName} onChange={(event) => setEditingStatusName(event.target.value)} maxLength={80} required autoFocus />
                        <button type="submit" title="Salvar nome" aria-label="Salvar nome"><Check size={13} /></button>
                        <button type="button" title="Cancelar edição" aria-label="Cancelar edição" onClick={() => { setEditingStatusId(null); setEditingStatusName('') }}><X size={13} /></button>
                      </form>
                    ) : (
                      <>
                        <span className="legal-status-chip-name">{status.name}</span>
                        <button type="button" title={`Editar nome de ${status.name}`} aria-label={`Editar nome de ${status.name}`} onClick={() => { setEditingStatusId(status.id); setEditingStatusName(status.name) }}>
                          <Pencil size={12} />
                        </button>
                      </>
                    )}
                    <span className="legal-status-order">
                      <button type="button" title={`Mover ${status.name} para a esquerda`} aria-label={`Mover ${status.name} para a esquerda`} disabled={savingStatusOrder || index === 0} onClick={() => void moveStatus(status.id, -1)}>
                        <ArrowLeft size={12} />
                      </button>
                      <button type="button" title={`Mover ${status.name} para a direita`} aria-label={`Mover ${status.name} para a direita`} disabled={savingStatusOrder || index === statuses.length - 1} onClick={() => void moveStatus(status.id, 1)}>
                        <ArrowRight size={12} />
                      </button>
                    </span>
                    <button type="button" title={`Excluir status ${status.name}`} aria-label={`Excluir status ${status.name}`} onClick={() => void deleteStatus(status)}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button type="button" className="legal-status-add" onClick={() => { setShowStatusForm((value) => !value); setStatusManagerOpen(true) }}>
                  <Plus size={15} />
                  <strong>Nova situação</strong>
                  <small>Adicione uma fase ao quadro</small>
                </button>
              </div>
              {showStatusForm && (
                <form className="legal-status-create" onSubmit={(event) => void createStatus(event)}>
                  <input value={statusName} onChange={(event) => setStatusName(event.target.value)} placeholder="Nome da situação/fase" maxLength={80} required />
                  <input type="color" value={statusColor} onChange={(event) => setStatusColor(event.target.value)} aria-label="Cor da situação" />
                  <button className="secondary-button" type="submit">Criar status</button>
                  <button className="text-action-btn" type="button" onClick={() => setShowStatusForm(false)}>Cancelar</button>
                </form>
              )}
            </details>
          )}

          {/* CONTEÚDO PRINCIPAL (QUADRO OU LISTA) */}
          {loading ? (
            <ATechLoading message="Carregando processos jurídicos..." subtitle="Sincronizando processos e fases..." />
          ) : !processes.length && activeTab === 'list' ? (
            <div className="legal-empty">
              <FileText size={29} />
              <strong>Ainda não há processos jurídicos cadastrados</strong>
              <span>Crie um novo processo ou carregue um exemplo fictício removível para explorar a tela.</span>
              <div>
                <button className="primary-button" type="button" onClick={() => startCreate()}><Plus size={15} /> Novo processo</button>
                <button className="secondary-button" type="button" onClick={() => void createDemo()}>Carregar exemplo fictício</button>
              </div>
            </div>
          ) : activeTab === 'board' ? (
            <>
              <div className="legal-board-controls" aria-label="Navegação das situações jurídicas">
                <span>Deslize ou arraste horizontalmente para navegar entre as fases</span>
                <button type="button" aria-label="Mostrar situações anteriores" title="Mostrar situações anteriores" onClick={() => moveBoard(-1)}><ArrowLeft size={17} /></button>
                <button type="button" aria-label="Mostrar próximas situações" title="Mostrar próximas situações" onClick={() => moveBoard(1)}><ArrowRight size={17} /></button>
              </div>
              <div
                className="legal-board"
                ref={boardRef}
                onPointerDown={startBoardDrag}
                onPointerMove={moveBoardDrag}
                onPointerUp={endBoardDrag}
                onPointerCancel={endBoardDrag}
                onClickCapture={(event) => {
                  if (suppressBoardClickRef.current) {
                    event.preventDefault()
                    event.stopPropagation()
                    suppressBoardClickRef.current = false
                  }
                }}
              >
                {statuses.map((status) => {
                  const items = filtered.filter((process) => process.status_id === status.id)
                  const visibleCount = visibleProcessCounts[String(status.id)] ?? kanbanPageSize
                  const itemsToShow = items.slice(0, visibleCount)
                  const columnTotalValue = items.reduce((sum, p) => sum + (p.case_value ? Number(p.case_value) : 0), 0)

                  return (
                    <section
                      className="legal-column"
                      key={status.id}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const item = processes.find((process) => process.id === dragged)
                        if (item && item.status_id !== status.id) void changeStatus(item, status.id)
                        setDragged(null)
                      }}
                    >
                      <header style={{ borderTopColor: status.color }}>
                        <div className="legal-column-header-main">
                          <i style={{ background: status.color }} />
                          <strong>{status.name}</strong>
                          <span>{items.length}</span>
                        </div>
                        {columnTotalValue > 0 && (
                          <div className="legal-column-total-val" title={`Soma do valor das causas nesta fase: ${currency.format(columnTotalValue)}`}>
                            {currency.format(columnTotalValue)}
                          </div>
                        )}
                      </header>

                      <div className="legal-column-body">
                        {itemsToShow.map((process) => processCard(process))}
                        {itemsToShow.length < items.length && (
                          <button type="button" className="kanban-load-more" onClick={() => loadMoreProcesses(String(status.id), visibleCount)}>
                            Carregar mais ({Math.min(kanbanPageSize, items.length - visibleCount)})
                          </button>
                        )}
                        <button type="button" className="legal-add-card" onClick={() => startCreate(status.id)}>
                          <Plus size={14} /> Adicionar processo
                        </button>
                      </div>
                    </section>
                  )
                })}
                <section className="legal-new-column">
                  <button type="button" onClick={() => setShowStatusForm(true)}>
                    <Plus size={15} /> Nova situação
                  </button>
                </section>
              </div>
            </>
          ) : (
            /* VISUALIZAÇÃO EM LISTA (TABELA ORDENÁVEL COM EXPORTAÇÃO CSV) */
            <>
              <div className="legal-list-wrap">
                <table className="legal-list">
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort('title')} className="is-sortable">
                        <span className="th-content">
                          PROCESSO {listSortField === 'title' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('processNumber')} className="is-sortable">
                        <span className="th-content">
                          Nº ÚNICO {listSortField === 'processNumber' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('enterprise')} className="is-sortable">
                        <span className="th-content">
                          EMPREENDIMENTO {listSortField === 'enterprise' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('status')} className="is-sortable">
                        <span className="th-content">
                          SITUAÇÃO / FASE {listSortField === 'status' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('claimant')} className="is-sortable">
                        <span className="th-content">
                          REQUERENTE {listSortField === 'claimant' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th>RESPONSÁVEIS</th>
                      <th onClick={() => toggleSort('dates')} className="is-sortable">
                        <span className="th-content">
                          PERÍODO {listSortField === 'dates' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('caseValue')} className="is-sortable">
                        <span className="th-content">
                          VALOR {listSortField === 'caseValue' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                      <th onClick={() => toggleSort('paidTotal')} className="is-sortable">
                        <span className="th-content">
                          PAGO {listSortField === 'paidTotal' ? (listSortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="th-sort-hint" />}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProcesses.map((process) => (
                      <tr key={process.id} onClick={() => void openDetail(process)}>
                        <td>
                          <strong>{process.title}</strong>
                          {process.is_demo && <small>Exemplo fictício</small>}
                        </td>
                        <td className="legal-list-number">
                          {process.process_number ? (
                            <span className="legal-list-number-flex">
                              <span>{process.process_number}</span>
                              <button
                                type="button"
                                className="icon-button"
                                title="Copiar número"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(process.process_number, `${process.id}-tbl-num`) }}
                              >
                                {copiedKey === `${process.id}-tbl-num` ? <Check size={12} className="legal-copy-success" /> : <Copy size={12} />}
                              </button>
                            </span>
                          ) : '—'}
                        </td>
                        <td>{process.enterprise_name || '—'}</td>
                        <td>
                          <span className="legal-status-label">
                            <i style={{ background: process.status_color }} />
                            {process.status_name}
                            <select
                              aria-label={`Mover ${process.title} para outro status`}
                              value={process.status_id}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => { event.stopPropagation(); void changeStatus(process, Number(event.target.value)) }}
                            >
                              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                            </select>
                          </span>
                        </td>
                        <td>{process.claimant || '—'}</td>
                        <td>{process.assignees.map(assigneeName).join(', ') || '—'}</td>
                        <td>{showDate(process.start_date)} – {showDate(process.end_date)}</td>
                        <td>{process.case_value ? currency.format(Number(process.case_value)) : '—'}</td>
                        <td>{currency.format(Number(process.paid_total))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="legal-list-footer">
                <LegalListPagination
                  total={filtered.length}
                  page={legalListPage}
                  pageCount={legalListPageCount}
                  pageSize={listPageSize}
                  onPageChange={(page) => setLegalListPageState({ key: legalListKey, page })}
                />
              </div>
            </>
          )}

          {processes.length > 0 && !filtered.length && (
            <div className="legal-empty-inline">
              Nenhum processo encontrado com os filtros aplicados.
              <button type="button" className="text-action-btn" onClick={clearAllFilters}>Limpar todos os filtros</button>
            </div>
          )}
        </>
      )}

      {/* DASHBOARD JURÍDICO EXPANDIDO (Fase 3) */}
      {!detailPageOpen && activeTab === 'dashboard' && (
        <section className="legal-dashboard">
          <div className="legal-dashboard-filters-panel">
            <div className="legal-dashboard-filters-header">
              <div>
                <strong>Filtros e Recortes Analíticos</strong>
                <p>Refine os indicadores por período de distribuição, fase, empreendimento, requerente ou número do processo.</p>
              </div>
              {dashboardFiltersActive && (
                <button
                  type="button"
                  className="filter-clear-button"
                  onClick={() => {
                    setDashboardProcessNumberFilter('')
                    setDashboardStartDate('')
                    setDashboardEndDate('')
                    setDashboardStatusFilter('')
                    setDashboardEnterpriseFilter('')
                    setDashboardClaimantFilter('')
                    setDashboardTagFilter('')
                    try {
                      localStorage.removeItem(LEGAL_DASHBOARD_STORAGE_KEY)
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <X size={14} /> Limpar filtros
                </button>
              )}
            </div>

            <div className="legal-dashboard-filters">
              <label className="legal-dashboard-filter-item">
                <span>Número único do processo</span>
                <input
                  type="search"
                  placeholder="0000000-00.0000.0.00.0000"
                  value={dashboardProcessNumberFilter}
                  onChange={(event) => setDashboardProcessNumberFilter(event.target.value)}
                />
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Início a partir de</span>
                <input type="date" value={dashboardStartDate} onChange={(event) => setDashboardStartDate(event.target.value)} />
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Início até</span>
                <input type="date" value={dashboardEndDate} onChange={(event) => setDashboardEndDate(event.target.value)} />
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Fase / Status</span>
                <select value={dashboardStatusFilter} onChange={(event) => setDashboardStatusFilter(event.target.value)}>
                  <option value="">Todas as fases</option>
                  {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Empreendimento</span>
                <select value={dashboardEnterpriseFilter} onChange={(event) => setDashboardEnterpriseFilter(event.target.value)}>
                  <option value="">Todos os empreendimentos</option>
                  {enterprises.map((enterprise) => <option key={enterprise.enterprise_key} value={enterprise.enterprise_key}>{enterprise.enterprise_name}</option>)}
                </select>
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Requerente</span>
                <select value={dashboardClaimantFilter} onChange={(event) => setDashboardClaimantFilter(event.target.value)}>
                  <option value="">Todos os requerentes</option>
                  {claimantOptions.map((claimant) => <option key={claimant} value={claimant}>{claimant}</option>)}
                </select>
              </label>
              <label className="legal-dashboard-filter-item">
                <span>Tag jurídica</span>
                <select value={dashboardTagFilter} onChange={(event) => setDashboardTagFilter(event.target.value)}>
                  <option value="">Todas as tags</option>
                  {legalTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          {dashboardStartDate && dashboardEndDate && dashboardStartDate > dashboardEndDate && (
            <p className="legal-dashboard-warning" role="alert">A data inicial deve ser anterior ou igual à data final.</p>
          )}

          {loading ? (
            <ATechLoading message="Carregando indicadores jurídicos..." subtitle="Calculando estatísticas e prazos..." />
          ) : (
            <>
              {/* KPIs Principais */}
              <div className="legal-dashboard-kpis">
                <article className="legal-dashboard-kpi-card">
                  <div className="legal-kpi-icon-wrap is-primary">
                    <FolderKanban size={22} />
                  </div>
                  <div className="legal-kpi-content">
                    <span>Processos no recorte</span>
                    <strong>{dashboardProcesses.length}</strong>
                    <small>{dashboardFiltersActive ? 'Conforme filtros aplicados' : 'Todos os processos cadastrados'}</small>
                  </div>
                </article>
                <article className="legal-dashboard-kpi-card">
                  <div className="legal-kpi-icon-wrap is-warning">
                    <Clock size={22} />
                  </div>
                  <div className="legal-kpi-content">
                    <span>Em andamento</span>
                    <strong>{dashboardProcesses.length - dashboardConcludedCount}</strong>
                    <small>{dashboardConcludedCount} processo(s) concluído(s)</small>
                  </div>
                </article>
                <article className="legal-dashboard-kpi-card">
                  <div className="legal-kpi-icon-wrap is-info">
                    <Coins size={22} />
                  </div>
                  <div className="legal-kpi-content">
                    <span>Valor das causas ativas</span>
                    <strong>{currency.format(dashboardTotalCaseValue)}</strong>
                    <small>Exclui processos já concluídos</small>
                  </div>
                </article>
                <article className="legal-dashboard-kpi-card">
                  <div className="legal-kpi-icon-wrap is-success">
                    <Receipt size={22} />
                  </div>
                  <div className="legal-kpi-content">
                    <span>Total pago em acordos/custas</span>
                    <strong>{currency.format(dashboardTotalPaid)}</strong>
                    <small>Pagamentos liquidados no recorte</small>
                  </div>
                </article>
              </div>

              {dashboardMissingCaseValue > 0 && (
                <div className="legal-dashboard-warning" role="status">
                  <CircleAlert size={18} />
                  <span>
                    <strong>{dashboardMissingCaseValue} processo(s)</strong> do recorte não possuem valor da causa cadastrado; o montante das causas ativas soma apenas os processos em andamento com valor preenchido.
                  </span>
                </div>
              )}

              {!dashboardProcesses.length ? (
                <div className="legal-empty-inline">Nenhum processo encontrado com os filtros selecionados.</div>
              ) : (
                <div className="legal-dashboard-grid">
                  {/* Distribuição por Fase */}
                  <section className="legal-dashboard-panel">
                    <header>
                      <div>
                        <h2>Processos por status / fase</h2>
                        <p>Distribuição do recorte atual nas fases do quadro</p>
                      </div>
                      <span className="legal-panel-header-badge">{dashboardProcesses.length}</span>
                    </header>
                    <div className="legal-dashboard-bars">
                      {dashboardStatuses.map((status) => {
                        const pct = dashboardProcesses.length ? Math.round((status.count / dashboardProcesses.length) * 100) : 0
                        return (
                          <div className="legal-dashboard-bar-row" key={status.id}>
                            <span title={status.name}>
                              <i className="status-dot" style={{ background: status.color }} />
                              {status.name}
                            </span>
                            <div className="bar-track">
                              <i style={{ width: `${(status.count / dashboardStatusMax) * 100}%`, background: status.color }} />
                            </div>
                            <strong>
                              {status.count} <small>({pct}%)</small>
                            </strong>
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  {/* Painel de Desfecho & Taxa de Êxito (Fase 3) */}
                  <section className="legal-dashboard-panel">
                    <header>
                      <div>
                        <h2>Desfecho & Taxa de Êxito</h2>
                        <p>Resultados alcançados nas conclusões de processos</p>
                      </div>
                      {conclusionStats.totalWithConclusion > 0 && (
                        <span className="legal-dashboard-winrate-pill">
                          {conclusionStats.winRate}% de êxito
                        </span>
                      )}
                    </header>

                    {conclusionStats.totalWithConclusion > 0 ? (
                      <div className="legal-dashboard-outcomes-grid">
                        <div className="legal-outcome-card is-full-win">
                          <small>Ganho total</small>
                          <strong>{conclusionStats.counts.full_win}</strong>
                          <span>{Math.round((conclusionStats.counts.full_win / conclusionStats.totalWithConclusion) * 100)}%</span>
                        </div>
                        <div className="legal-outcome-card is-partial-win">
                          <small>Ganho parcial</small>
                          <strong>{conclusionStats.counts.partial_win}</strong>
                          <span>{Math.round((conclusionStats.counts.partial_win / conclusionStats.totalWithConclusion) * 100)}%</span>
                        </div>
                        <div className="legal-outcome-card is-partial-loss">
                          <small>Perda parcial</small>
                          <strong>{conclusionStats.counts.partial_loss}</strong>
                          <span>{Math.round((conclusionStats.counts.partial_loss / conclusionStats.totalWithConclusion) * 100)}%</span>
                        </div>
                        <div className="legal-outcome-card is-full-loss">
                          <small>Perda total</small>
                          <strong>{conclusionStats.counts.full_loss}</strong>
                          <span>{Math.round((conclusionStats.counts.full_loss / conclusionStats.totalWithConclusion) * 100)}%</span>
                        </div>
                      </div>
                    ) : (
                      <p className="legal-dashboard-empty-note">
                        Nenhum dos processos concluídos no recorte possui resultado de encerramento registrado.
                      </p>
                    )}

                    <div className="legal-dashboard-summary" style={{ marginTop: '16px' }}>
                      <div className="summary-stat-box">
                        <span>Tempo médio de tramitação</span>
                        <strong>{averageDurationDays !== null ? `${averageDurationDays} dias` : '—'}</strong>
                        <small>{averageDurationDays !== null ? `Aprox. ${(averageDurationDays / 30.4).toFixed(1)} meses` : 'Sem processos concluídos'}</small>
                      </div>
                      <div className="summary-stat-box">
                        <span>Valor médio por causa ativa</span>
                        <strong>{dashboardActiveProcessesWithCaseValue ? currency.format(dashboardTotalCaseValue / dashboardActiveProcessesWithCaseValue) : '—'}</strong>
                        <small>{dashboardActiveProcessesWithCaseValue} processo(s) com valor</small>
                      </div>
                      <div className="summary-stat-box">
                        <span>Taxa de conclusão</span>
                        <strong>{dashboardProcesses.length ? `${Math.round((dashboardConcludedCount / dashboardProcesses.length) * 100)}%` : '—'}</strong>
                        <small>{dashboardConcludedCount} de {dashboardProcesses.length} finalizados</small>
                      </div>
                    </div>
                  </section>

                  {/* Tabelas Top 10 por Requerente e Empreendimento */}
                  {([
                    { title: 'Processos por requerente', groups: dashboardClaimantGroups, onSelect: setDashboardClaimantFilter },
                    { title: 'Processos por empreendimento', groups: dashboardEnterpriseGroups, onSelect: (name: string) => {
                      const key = enterprises.find((enterprise) => enterprise.enterprise_name === name)?.enterprise_key
                      if (key) setDashboardEnterpriseFilter(key)
                    } },
                  ] as const).map(({ title, groups, onSelect }) => (
                    <section className="legal-dashboard-panel legal-dashboard-group-panel" key={title}>
                      <header>
                        <div>
                          <h2>{title}</h2>
                          <p>Até 10 grupos; valores excluem processos concluídos.</p>
                        </div>
                      </header>
                      <div className="legal-dashboard-table-wrap">
                        <table className="legal-dashboard-table">
                          <thead>
                            <tr>
                              <th>Nome</th>
                              <th>Processos</th>
                              <th>Valor em andamento</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groups.map((group) => (
                              <tr key={group.name}>
                                <td>
                                  <button type="button" onClick={() => onSelect(group.name)}>{group.name}</button>
                                  {group.missing > 0 && <small>{group.missing} sem valor</small>}
                                </td>
                                <td>{group.count}</td>
                                <td>{currency.format(group.caseValue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* DETALHE DO PROCESSO: REDESENHADO EM MASTER-DETAIL / DUAS COLUNAS (Fase 2) */}
      {detailPageOpen && draft && (
        <section ref={processDetailRef} className="legal-detail-layout" aria-labelledby="legal-editor-title">
          {/* BARRA SUPERIOR DO DETALHE */}
          <div className="legal-detail-topbar">
            <div className="legal-detail-topbar-left">
              <button type="button" className="secondary-button" onClick={() => void closeEditor()}>
                <ArrowLeft size={15} /> Voltar aos processos
              </button>
              <div className={`legal-autosave-status is-${autoSaveState}`} role={autoSaveState === 'error' ? 'alert' : 'status'} aria-live="polite">
                {autoSaveState === 'saving' ? 'Salvando alterações automaticamente...' :
                  autoSaveState === 'pending' ? 'Alterações pendentes; salvando...' :
                    autoSaveState === 'error' ? autoSaveError :
                      autoSaveState === 'saved' ? 'Todas as alterações salvas automaticamente.' :
                        newProcess ? 'O processo será criado automaticamente ao preencher o título.' : 'As alterações são salvas automaticamente.'}
              </div>
            </div>

            <div className="legal-detail-topbar-right">
              {selected && !selected.isDemo && (
                isConcludedStatus(statuses.find((status) => status.id === selected.statusId)?.name ?? '') ? (
                  <button
                    type="button"
                    className="secondary-button legal-reopen-btn"
                    disabled={!statuses.some((status) => !isConcludedStatus(status.name))}
                    title={!statuses.some((status) => !isConcludedStatus(status.name)) ? 'Crie uma fase diferente de Concluído antes de reabrir.' : undefined}
                    onClick={() => {
                      setReopenStatusId(String(statuses.find((status) => !isConcludedStatus(status.name))?.id ?? ''))
                      setShowReopenForm((open) => !open)
                      setShowConclusionForm(false)
                    }}
                  >
                    <ArrowRight size={14} /> Desconcluir / Reabrir processo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button legal-complete-btn"
                    onClick={() => {
                      setConclusionResult('')
                      setConclusionSummary('')
                      setShowConclusionForm((open) => !open)
                      setShowReopenForm(false)
                    }}
                  >
                    <Check size={14} /> Concluir processo
                  </button>
                )
              )}
            </div>
          </div>

          {/* FORMULÁRIO DE CONCLUSÃO SUSPENSO */}
          {selected && showConclusionForm && (
            <form className="legal-conclusion-form" onSubmit={(event) => void completeSelectedProcess(event)}>
              <div>
                <strong>Conclusão do processo</strong>
                <small>Registre o resultado jurídico para mover o processo ao status Concluído.</small>
              </div>
              <label className="legal-field">
                <span>Resultado para a empresa *</span>
                <select value={conclusionResult} onChange={(event) => setConclusionResult(event.target.value as ConclusionResult | '')} required>
                  <option value="">Selecione o resultado</option>
                  {(Object.entries(conclusionLabels) as [ConclusionResult, string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="legal-field legal-field-full">
                <span>Resumo do desfecho / Termos da finalização *</span>
                <textarea rows={3} value={conclusionSummary} onChange={(event) => setConclusionSummary(event.target.value)} maxLength={2000} required />
              </label>
              <div className="legal-form-actions legal-field-full">
                <button type="button" className="secondary-button" onClick={() => setShowConclusionForm(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={savingConclusion || !conclusionResult}>
                  {savingConclusion ? 'Concluindo...' : 'Confirmar conclusão'}
                </button>
              </div>
            </form>
          )}

          {/* FORMULÁRIO DE REABERTURA SUSPENSO */}
          {selected && showReopenForm && (
            <form className="legal-conclusion-form" onSubmit={(event) => void reopenSelectedProcess(event)}>
              <div>
                <strong>Reabrir processo jurídico</strong>
                <small>Escolha para qual fase o processo retornará. O histórico de conclusão anterior será preservado.</small>
              </div>
              <label className="legal-field">
                <span>Nova fase do processo *</span>
                <select value={reopenStatusId} onChange={(event) => setReopenStatusId(event.target.value)} required>
                  {statuses.filter((status) => !isConcludedStatus(status.name)).map((status) => (
                    <option key={status.id} value={status.id}>{status.name}</option>
                  ))}
                </select>
              </label>
              <div className="legal-form-actions legal-field-full">
                <button type="button" className="secondary-button" onClick={() => setShowReopenForm(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={savingConclusion || !reopenStatusId}>
                  {savingConclusion ? 'Reabrindo...' : 'Confirmar reabertura'}
                </button>
              </div>
            </form>
          )}

          {/* GRID DUAS COLUNAS: CONTEÚDO PRINCIPAL (65%) + SIDEBAR FIXA (35%) */}
          <div className="legal-detail-columns">
            {/* COLUNA PRINCIPAL COM ABAS */}
            <main className="legal-detail-main">
              {/* Título do processo inline */}
              <div className="legal-detail-title-card">
                <label className="legal-detail-title-label">
                  <span>Título / Objeto do processo</span>
                  <input
                    value={draft.title}
                    onChange={(event) => {
                      setDraft({ ...draft, title: event.target.value })
                      if (!event.target.value.trim()) { setAutoSaveState('idle'); setAutoSaveError('') }
                    }}
                    placeholder="Ex: Ação de Obrigação de Fazer c/c Indenizatória..."
                    maxLength={240}
                    required
                    autoFocus
                  />
                </label>
              </div>

              {/* Barra de abas internas do processo */}
              <div className="legal-detail-tabs-bar" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'general'}
                  className={`legal-detail-tab-btn ${detailTab === 'general' ? 'is-active' : ''}`}
                  onClick={() => setDetailTab('general')}
                >
                  <FileText size={15} /> Dados & Descrição
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'tasks'}
                  className={`legal-detail-tab-btn ${detailTab === 'tasks' ? 'is-active' : ''}`}
                  onClick={() => setDetailTab('tasks')}
                >
                  <CheckSquare size={15} /> Checklist & Tarefas
                  {draft.items.length > 0 && <span className="tab-pill">{completedChecklistCount}/{draft.items.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'children'}
                  className={`legal-detail-tab-btn ${detailTab === 'children' ? 'is-active' : ''}`}
                  onClick={() => setDetailTab('children')}
                >
                  <Layers size={15} /> Incidentes & Filhos
                  {draft.children.length > 0 && <span className="tab-pill">{draft.children.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'finances'}
                  className={`legal-detail-tab-btn ${detailTab === 'finances' ? 'is-active' : ''}`}
                  onClick={() => setDetailTab('finances')}
                >
                  <Coins size={15} /> Financeiro & Pagamentos
                  {selected && selected.payments.length > 0 && <span className="tab-pill">{selected.payments.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'comments'}
                  className={`legal-detail-tab-btn ${detailTab === 'comments' ? 'is-active' : ''}`}
                  onClick={() => setDetailTab('comments')}
                >
                  <MessageCircle size={15} /> Comentários & Histórico
                  {selected && selected.comments.length > 0 && <span className="tab-pill">{selected.comments.length}</span>}
                </button>
              </div>

              {/* ABA 1: DADOS & DESCRIÇÃO */}
              {detailTab === 'general' && (
                <div className="legal-tab-pane">
                  <div className="legal-pane-card">
                    <div className="legal-pane-header">
                      <div>
                        <h3>Informações Gerais do Litígio</h3>
                        <p>Valores em discussão, data de distribuição inicial e relatório de teses.</p>
                      </div>
                      <FileText size={18} className="legal-pane-header-icon" />
                    </div>

                    <div className="legal-general-grid">
                      <label className="legal-field">
                        <span>Valor da causa</span>
                        <div className="legal-input-group">
                          <span className="legal-input-addon">R$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0,00"
                            value={draft.caseValue}
                            onChange={(event) => setDraft({ ...draft, caseValue: event.target.value })}
                          />
                        </div>
                      </label>
                      <label className="legal-field">
                        <span>Data de distribuição</span>
                        <div className="legal-input-group">
                          <input
                            type="date"
                            value={draft.distributionDate}
                            onChange={(event) => setDraft({ ...draft, distributionDate: event.target.value })}
                          />
                        </div>
                      </label>
                    </div>

                    <label className="legal-field legal-field-full" style={{ marginTop: '16px' }}>
                      <span>Descrição detalhada e notas do processo</span>
                      <textarea
                        rows={8}
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        maxLength={20_000}
                        placeholder="Descreva o histórico, teses, petições e orientações jurídicas deste processo..."
                      />
                    </label>
                  </div>

                  {/* Histórico de conclusões anteriores se houver */}
                  {selectedConclusionHistory.length > 0 && (
                    <section className="legal-conclusion-record">
                      <div className="legal-conclusion-record-header">
                        <Check size={16} />
                        <strong>{isConcludedStatus(statuses.find((status) => status.id === selected?.statusId)?.name ?? '') ? 'Histórico de Conclusão do Processo' : 'Conclusões Anteriores Registradas'}</strong>
                      </div>
                      {selectedConclusionHistory.map((conclusion) => (
                        <article key={conclusion.id} className="legal-conclusion-item">
                          <div className="legal-conclusion-item-top">
                            <span className={`legal-outcome-tag is-${conclusion.result.replace('_', '-')}`}>
                              {conclusionLabels[conclusion.result]}
                            </span>
                            {conclusion.concludedAt && (
                              <time>{new Date(conclusion.concludedAt).toLocaleString('pt-BR')}{conclusion.concludedByName ? ` · Por ${conclusion.concludedByName}` : ''}</time>
                            )}
                          </div>
                          <p>{conclusion.summary}</p>
                        </article>
                      ))}
                    </section>
                  )}
                </div>
              )}

              {/* ABA 2: CHECKLIST & TAREFAS */}
              {detailTab === 'tasks' && (
                <div className="legal-tab-pane">
                  <div className="legal-pane-card">
                    <div className="legal-checklist-header">
                      <div>
                        <h3>Itens e Providências do Processo</h3>
                        <p>Controle prazos, juntadas de petição, custas e documentos pendentes.</p>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={draft.items.length >= 100}
                        onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', isDone: false }] })}
                      >
                        <Plus size={14} /> Adicionar tarefa
                      </button>
                    </div>

                    {/* Barra de progresso visual */}
                    {draft.items.length > 0 && (
                      <div className="legal-progress-wrap">
                        <div className="legal-progress-info">
                          <span>{completedChecklistCount} de {draft.items.length} providências concluídas</span>
                          <strong>{checklistPercent}%</strong>
                        </div>
                        <div className="legal-progress-track">
                          <div className="legal-progress-fill" style={{ width: `${checklistPercent}%` }} />
                        </div>
                      </div>
                    )}

                    <div className="legal-items-list">
                      {draft.items.map((item, index) => (
                        <div className="legal-item-row" key={item.id ?? `item-${index}`}>
                          <label className="legal-item-check">
                            <input
                              type="checkbox"
                              checked={item.isDone}
                              onChange={(event) => setDraft({
                                ...draft,
                                items: draft.items.map((entry, i) => i === index ? { ...entry, isDone: event.target.checked } : entry),
                              })}
                            />
                            <span>{item.isDone ? 'Concluído' : 'Pendente'}</span>
                          </label>
                          <input
                            value={item.title}
                            onChange={(event) => setDraft({
                              ...draft,
                              items: draft.items.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry),
                            })}
                            placeholder="Descreva a providência ou tarefa jurídica..."
                            maxLength={500}
                            className={item.isDone ? 'is-strikethrough' : ''}
                            aria-label={`Descrição do item ${index + 1}`}
                          />
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remover item ${index + 1}`}
                            onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      {!draft.items.length && (
                        <p className="legal-items-empty">Nenhum item ou tarefa cadastrado neste processo ainda.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 3: PROCESSOS FILHOS */}
              {detailTab === 'children' && (
                <div className="legal-tab-pane">
                  <div className="legal-pane-card">
                    <div className="legal-checklist-header">
                      <div>
                        <h3>Processos Filhos & Incidentes</h3>
                        <p>Recursos, embargos, agravos, cumprimentos de sentença e execuções vinculadas.</p>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setDraft({
                          ...draft,
                          children: [...draft.children, { processNumber: '', description: '', statusId: draft.statusId, movementDate: '', isDone: false }],
                        })}
                      >
                        <Plus size={14} /> Adicionar processo filho
                      </button>
                    </div>

                    <div className="legal-children-list">
                      {draft.children.map((child, index) => (
                        <div className="legal-child-card" key={child.id ?? `new-${index}`}>
                          <div className="legal-child-row">
                            <label className="legal-child-done">
                              <input
                                type="checkbox"
                                checked={child.isDone}
                                onChange={(event) => setDraft({
                                  ...draft,
                                  children: draft.children.map((entry, i) => i === index ? { ...entry, isDone: event.target.checked } : entry),
                                })}
                              />
                              <span>{child.isDone ? 'Concluído' : 'Em andamento'}</span>
                            </label>
                            <input
                              value={child.processNumber}
                              onChange={(event) => setDraft({
                                ...draft,
                                children: draft.children.map((entry, i) => i === index ? { ...entry, processNumber: formatCnjProcessNumber(event.target.value) } : entry),
                              })}
                              placeholder="0000000-00.0000.0.00.0000"
                              maxLength={25}
                              required
                            />
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Remover processo filho"
                              onClick={() => setDraft({ ...draft, children: draft.children.filter((_, i) => i !== index) })}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <textarea
                            value={child.description}
                            onChange={(event) => setDraft({
                              ...draft,
                              children: draft.children.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry),
                            })}
                            placeholder="Descrição e objeto do processo filho ou incidente..."
                            maxLength={2000}
                            required
                          />
                          <div className="legal-child-meta">
                            <label className="legal-field">
                              <span>Status da fase</span>
                              <select
                                value={child.statusId}
                                onChange={(event) => setDraft({
                                  ...draft,
                                  children: draft.children.map((entry, i) => i === index ? { ...entry, statusId: Number(event.target.value) } : entry),
                                })}
                              >
                                {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                              </select>
                            </label>
                            <label className="legal-field">
                              <span>Última movimentação</span>
                              <input
                                type="date"
                                value={dateInput(child.movementDate)}
                                onChange={(event) => setDraft({
                                  ...draft,
                                  children: draft.children.map((entry, i) => i === index ? { ...entry, movementDate: event.target.value || null } : entry),
                                })}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                      {!draft.children.length && (
                        <p className="legal-items-empty">Nenhum processo filho ou incidente cadastrado.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 4: FINANCEIRO & PAGAMENTOS */}
              {detailTab === 'finances' && (
                <div className="legal-tab-pane">
                  {/* Cards de Resumo Financeiro */}
                  <div className="legal-financial-summary">
                    <div className="legal-financial-card">
                      <small>Valor da Causa</small>
                      <strong>{detailCaseValue !== null ? currency.format(detailCaseValue) : 'Não informado'}</strong>
                      <span>Valor em discussão</span>
                    </div>
                    <div className="legal-financial-card is-success">
                      <small>Total Pago</small>
                      <strong>{currency.format(detailPaidTotal)}</strong>
                      <span>Liquidados e comprovados</span>
                    </div>
                    <div className="legal-financial-card is-warning">
                      <small>Total Pendente / Previsto</small>
                      <strong>{currency.format(detailPendingTotal)}</strong>
                      <span>Aguardando quitação</span>
                    </div>
                    <div className="legal-financial-card">
                      <small>Saldo Restante da Causa</small>
                      <strong>{detailBalance !== null ? currency.format(detailBalance) : '—'}</strong>
                      <span>Causa menos pagamentos</span>
                    </div>
                  </div>

                  {selected && (
                    <div className="legal-pane-card" style={{ marginTop: '16px' }}>
                      <header className="legal-payments-heading">
                        <div>
                          <h3>Lançamentos & Pagamentos</h3>
                          <p>Gerencie acordos, honorários periciais, depósitos judiciais e custas.</p>
                        </div>
                      </header>

                      <div className="legal-payments-list">
                        {selected.payments.map((payment) => (
                          <article className="legal-payment-card" key={payment.id}>
                            <div className="legal-payment-main">
                              <label className="legal-payment-check">
                                <input
                                  type="checkbox"
                                  checked={payment.isPaid}
                                  disabled={busyPayment === payment.id}
                                  onChange={(event) => void updatePayment(payment, { isPaid: event.target.checked })}
                                />
                                <span className={`payment-status-pill ${payment.isPaid ? 'is-paid' : 'is-pending'}`}>
                                  {payment.isPaid ? 'Pago' : 'Pendente'}
                                </span>
                              </label>
                              <strong>{payment.description}</strong>
                              <span className="payment-amount">{currency.format(Number(payment.amount))}</span>
                              <small>Vencimento / Data: {showDate(payment.dueDate)}</small>
                            </div>

                            <div className="legal-payment-attachments">
                              {payment.attachments.map((attachment) => (
                                <button type="button" key={attachment.id} onClick={() => void downloadProof(payment, attachment)} title="Baixar comprovante">
                                  <Download size={13} /> {attachment.fileName}
                                </button>
                              ))}
                            </div>

                            <button type="button" className="text-action-btn danger-action" onClick={() => void deletePayment(payment)} title="Excluir pagamento">
                              <Trash2 size={14} /> Excluir
                            </button>
                          </article>
                        ))}
                        {!selected.payments.length && (
                          <p className="legal-items-empty">Nenhum pagamento registrado neste processo.</p>
                        )}
                      </div>

                      {/* Formulário para novo pagamento */}
                      <form className="legal-payment-form" onSubmit={(event) => void addPayment(event)}>
                        <strong>Novo lançamento financeiro</strong>
                        <label className="legal-field">
                          <span>Descrição / Finalidade *</span>
                          <input
                            value={paymentDraft.description}
                            onChange={(event) => setPaymentDraft({ ...paymentDraft, description: event.target.value })}
                            placeholder="Ex: Acordo 1ª parcela, Honorários periciais..."
                            maxLength={500}
                            required
                          />
                        </label>
                        <label className="legal-field">
                          <span>Valor (R$) *</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={paymentDraft.amount}
                            onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })}
                            placeholder="0,00"
                            required
                          />
                        </label>
                        <label className="legal-field">
                          <span>Data para pagamento / vencimento</span>
                          <input
                            type="date"
                            value={paymentDraft.dueDate}
                            onChange={(event) => setPaymentDraft({ ...paymentDraft, dueDate: event.target.value })}
                          />
                        </label>
                        <label className="legal-payment-check legal-field-center">
                          <input
                            type="checkbox"
                            checked={paymentDraft.isPaid}
                            onChange={(event) => setPaymentDraft({ ...paymentDraft, isPaid: event.target.checked })}
                          />
                          <span>Marcar como já pago / quitado</span>
                        </label>
                        <label className="legal-field legal-field-full">
                          <span>Comprovante de pagamento (PDF, JPG, PNG ou WebP até 5 MiB)</span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                            onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)}
                          />
                        </label>
                        <button type="submit" className="primary-button legal-field-full" disabled={savingPayment}>
                          {savingPayment ? 'Salvando...' : <><Plus size={14} /> Cadastrar pagamento</>}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 5: HISTÓRICO & COMENTÁRIOS */}
              {detailTab === 'comments' && selected && (
                <div className="legal-tab-pane">
                  <div className="legal-pane-card">
                    <header className="legal-payments-heading">
                      <div>
                        <h3>Comentários e Histórico</h3>
                        <p>Use @ para marcar colaboradores; responda em threads e acompanhe as decisões.</p>
                      </div>
                      <MessageCircle size={18} />
                    </header>

                    <div className="legal-comment-list">
                      {selected.comments.filter((entry) => !entry.parentCommentId).map((entry) => {
                        const replies = selected.comments.filter((reply) => reply.parentCommentId === entry.id)
                        return (
                          <article className="legal-comment-thread" key={entry.id}>
                            {[entry, ...replies].map((item) => {
                              const editable = currentUser.role === 'admin' || item.authorId === currentUser.id
                              return (
                                <div className={`legal-comment ${item.parentCommentId ? 'legal-comment-reply' : ''}`} key={item.id}>
                                  <span className="legal-comment-avatar">{item.authorName.slice(0, 1).toUpperCase()}</span>
                                  <div className="legal-comment-content">
                                    <header>
                                      <strong>{item.authorName}</strong>
                                      <time>{new Date(item.createdAt).toLocaleString('pt-BR')}{item.updatedAt !== item.createdAt ? ' · editado' : ''}</time>
                                    </header>
                                    {editingComment?.id === item.id ? (
                                      <form className="legal-comment-edit" onSubmit={(event) => { event.preventDefault(); void saveComment(item.id, editingComment.body) }}>
                                        <textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required />
                                        <button type="submit" className="primary-button" disabled={busyComment}>Salvar</button>
                                        <button type="button" className="secondary-button" onClick={() => setEditingComment(null)}>Cancelar</button>
                                      </form>
                                    ) : (
                                      <p>{item.body}</p>
                                    )}
                                    {item.mentions.length > 0 && (
                                      <small>Marcados: {item.mentions.map((person) => person.displayName).join(', ')}</small>
                                    )}
                                    <div className="legal-comment-actions">
                                      {!item.parentCommentId && (
                                        <button type="button" className="text-action-btn" onClick={() => { setReplyingTo(item.id); setComment('') }}>
                                          <MessageCircle size={13} /> Responder
                                        </button>
                                      )}
                                      {editable && (
                                        <>
                                          <button type="button" className="text-action-btn" onClick={() => setEditingComment(item)}>
                                            <Pencil size={13} /> Editar
                                          </button>
                                          <button type="button" className="text-action-btn danger-action" onClick={() => void deleteComment(item.id)}>
                                            <Trash2 size={13} /> Excluir
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </article>
                        )
                      })}
                      {!selected.comments.length && <p className="legal-empty-inline">Ainda não há comentários neste processo.</p>}
                    </div>

                    {replyingTo && (
                      <div className="legal-replying-banner">
                        Respondendo a {selected.comments.find((entry) => entry.id === replyingTo)?.authorName ?? 'comentário'}
                        <button type="button" className="text-action-btn" onClick={() => setReplyingTo(null)}>Cancelar</button>
                      </div>
                    )}

                    <form className="legal-comment-form" onSubmit={(event) => void postComment(event)}>
                      <div className="legal-mention-composer">
                        <textarea
                          value={comment}
                          onChange={(event) => updateCommentText(event.target.value, event.currentTarget.selectionStart)}
                          rows={3}
                          maxLength={6000}
                          placeholder={replyingTo ? 'Escreva uma resposta...' : 'Escreva um comentário ou atualização jurídica... Use @ para marcar alguém'}
                          required
                        />
                        {mentionQuery !== null && (
                          <div className="legal-mention-suggestions" role="listbox">
                            {people.filter((person) => assigneeName(person).toLocaleLowerCase('pt-BR').includes(mentionQuery)).slice(0, 6).map((person) => (
                              <button key={person.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(person)}>
                                <AtSign size={13} />{assigneeName(person)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="legal-comment-form-footer">
                        <small>{mentions.length ? `${mentions.length} pessoa(s) marcada(s)` : 'As menções notificam os envolvidos.'}</small>
                        <button className="primary-button" type="submit" disabled={busyComment || !comment.trim()}>
                          {busyComment ? 'Enviando...' : replyingTo ? 'Responder' : 'Comentar'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </main>

            {/* SIDEBAR LATERAL FIXA DE METADADOS & AÇÕES RÁPIDAS (35%) */}
            <aside className="legal-detail-sidebar">
              {/* Card de Fase & Conclusão */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">SITUAÇÃO / FASE</span>
                <div className="legal-sidebar-status-select-wrap">
                  <select
                    value={draft.statusId}
                    onChange={(event) => setDraft({ ...draft, statusId: Number(event.target.value) })}
                    required
                  >
                    {statuses.map((status) => (
                      <option
                        key={status.id}
                        value={status.id}
                        disabled={selected
                          ? isConcludedStatus(statuses.find((item) => item.id === selected.statusId)?.name ?? '')
                            ? status.id !== selected.statusId
                            : isConcludedStatus(status.name)
                          : isConcludedStatus(status.name)}
                      >
                        {status.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Card de Identificação: Número único com cópia de 1 clique */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">NÚMERO ÚNICO DO PROCESSO</span>
                <div className="legal-sidebar-number-input">
                  <input
                    value={draft.processNumber}
                    onChange={(event) => setDraft({ ...draft, processNumber: formatCnjProcessNumber(event.target.value) })}
                    placeholder="0000000-00.0000.0.00.0000"
                    maxLength={25}
                  />
                  {draft.processNumber && (
                    <button
                      type="button"
                      className="icon-button"
                      title="Copiar número único"
                      onClick={() => copyToClipboard(draft.processNumber, 'detail-number')}
                    >
                      {copiedKey === 'detail-number' ? <Check size={14} className="legal-copy-success" /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
                {copiedKey === 'detail-number' && (
                  <span className="legal-copy-feedback">Número copiado para a área de transferência!</span>
                )}
              </div>

              {/* Card de Relacionamento (Empreendimento e Requerente) */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">RELACIONAMENTO</span>
                <label className="legal-field">
                  <span>Empreendimento</span>
                  <select value={draft.enterpriseKey} onChange={(event) => setDraft({ ...draft, enterpriseKey: event.target.value })}>
                    <option value="">Sem empreendimento associado</option>
                    {enterprises.map((enterprise) => <option key={enterprise.enterprise_key} value={enterprise.enterprise_key}>{enterprise.enterprise_name}</option>)}
                  </select>
                </label>
                <label className="legal-field" style={{ marginTop: '8px' }}>
                  <span>Requerente / Autor</span>
                  <input
                    value={draft.claimant}
                    onChange={(event) => setDraft({ ...draft, claimant: event.target.value })}
                    maxLength={240}
                    placeholder="Nome do cliente ou requerente..."
                  />
                </label>
              </div>

              {/* Card de Responsáveis */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">RESPONSÁVEIS JURÍDICOS</span>
                <div className="legal-field legal-assignee-field">
                  <SearchableMultiSelect
                    label="Selecionar responsáveis"
                    options={assigneeOptions}
                    value={draft.assigneeIds.map(String)}
                    onChange={(values) => setDraft({ ...draft, assigneeIds: values.map(Number) })}
                    emptyLabel="Nenhum responsável cadastrado."
                  />
                  {draft.assigneeIds.length > 0 && (
                    <div className="legal-assignee-selected" aria-label="Responsáveis selecionados">
                      {people.filter((person) => draft.assigneeIds.includes(person.id)).map((person) => (
                        <span key={person.id}>
                          {assigneeName(person)}
                          <button type="button" aria-label={`Remover ${assigneeName(person)}`} onClick={() => setDraft({ ...draft, assigneeIds: draft.assigneeIds.filter((id) => id !== person.id) })}>
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Card de Prazos e Datas */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">PRAZOS E DATAS</span>
                <div className="legal-dates-grid">
                  <label className="legal-field">
                    <span>Data de início</span>
                    <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
                  </label>
                  <label className="legal-field">
                    <span>Data de finalização</span>
                    <input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
                  </label>
                </div>
              </div>

              {/* Links Externos (Drive e Notebook) */}
              <div className="legal-sidebar-card">
                <span className="legal-sidebar-card-label">LINKS EXTERNOS</span>
                {(['driveUrl', 'notebookUrl'] as const).map((field) => {
                  const label = field === 'driveUrl' ? 'Google Drive' : 'Notebook'
                  return (
                    <div className="legal-resource-row" key={field}>
                      <div className="legal-resource-title-row">
                        <span className="legal-resource-title">{label}</span>
                        {draft[field] ? (
                          <a
                            href={draft[field]}
                            target="_blank"
                            rel="noreferrer"
                            className="legal-resource-link-btn"
                            title={`Acessar ${label}`}
                          >
                            <ExternalLink size={12} /> Acessar
                          </a>
                        ) : null}
                      </div>
                      <input
                        type="url"
                        value={draft[field]}
                        onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                        placeholder="https://"
                      />
                    </div>
                  )
                })}
              </div>

              {/* Tags do processo */}
              {selected && !selected.isDemo && (
                <div className="legal-sidebar-card">
                  <span className="legal-sidebar-card-label">TAGS JURÍDICAS</span>
                  {legalTags.length > 0 ? (
                    <div className="legal-process-tag-options">
                      {legalTags.map((tag) => (
                        <label key={tag.id} style={{ '--legal-tag-color': tag.color } as CSSProperties}>
                          <input
                            type="checkbox"
                            checked={selected.tags.some((current) => current.id === tag.id)}
                            onChange={(event) => void toggleProcessTag(tag.id, event.target.checked)}
                          />
                          <span>{tag.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="legal-tag-empty">Nenhuma tag cadastrada.</p>
                  )}
                  <form className="legal-create-tag-form" onSubmit={(event) => void createLegalTag(event)}>
                    <input
                      aria-label="Nome da nova tag"
                      placeholder="Nova tag..."
                      value={legalTagName}
                      onChange={(event) => setLegalTagName(event.target.value)}
                      maxLength={60}
                      required
                    />
                    <input type="color" aria-label="Cor da tag" value={legalTagColor} onChange={(event) => setLegalTagColor(event.target.value)} />
                    <button type="submit" className="secondary-button" disabled={creatingLegalTag}>
                      {creatingLegalTag ? 'Criando...' : <Plus size={13} />}
                    </button>
                  </form>
                </div>
              )}

              {/* Agendamento de Atividade Jurídica */}
              {selected && scheduleProcess && (
                <div className="legal-sidebar-card">
                  <span className="legal-sidebar-card-label">PROGRAMAÇÃO & AGENDA</span>
                  {!showProgrammingForm ? (
                    <button type="button" className="secondary-button legal-schedule-trigger-btn" onClick={() => setShowProgrammingForm(true)}>
                      <CalendarDays size={14} /> Agendar atividade neste processo
                    </button>
                  ) : (
                    <div className="legal-schedule-form-wrap">
                      <TicketProgrammingForm
                        tickets={[]}
                        initialLegalProcessId={scheduleProcess.id}
                        initialLegalProcess={scheduleProcess}
                        programmingType="general"
                        allowMixedCollaborators
                        onCancel={() => setShowProgrammingForm(false)}
                        onSaved={() => { setShowProgrammingForm(false); void load() }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Ações de Fechamento / Exclusão */}
              <div className="legal-sidebar-footer">
                <button type="button" className="secondary-button" onClick={() => void closeEditor()}>
                  <ArrowLeft size={14} /> Voltar aos processos
                </button>
                {selected && (
                  <button type="button" className="text-action-btn danger-action" onClick={() => void deleteProcess()}>
                    <Trash2 size={14} /> Excluir processo
                  </button>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}
    </section>
  )
}
