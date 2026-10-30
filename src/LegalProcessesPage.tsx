import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ChevronDown,
  Columns3,
  Download,
  FileText,
  FileSpreadsheet,
  GripVertical,
  List,
  MessageCircle,
  AtSign,
  CalendarDays,
  BarChart3,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import Papa from 'papaparse'
import { apiRequest } from './api/client'
import SearchableMultiSelect from './SearchableMultiSelect'
import TicketProgrammingForm from './tickets/TicketProgrammingForm'
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
  paid_total: string
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
  comments: LegalComment[]
  conclusionResult: ConclusionResult | null
  conclusionSummary: string
  conclusionHistory: LegalProcessConclusion[]
  tags: LegalTag[]
}
interface ProcessDraft {
  title: string
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

type FaceField = 'enterprise' | 'claimant' | 'assignees' | 'dates' | 'caseValue' | 'children' | 'paidTotal' | 'distributionDate'
const faceFields: { id: FaceField; label: string }[] = [
  { id: 'enterprise', label: 'Empreendimento' },
  { id: 'claimant', label: 'Requerente' },
  { id: 'assignees', label: 'Responsáveis' },
  { id: 'dates', label: 'Início e finalização' },
  { id: 'caseValue', label: 'Valor da causa' },
  { id: 'children', label: 'Processos filhos' },
  { id: 'paidTotal', label: 'Total pago' },
  { id: 'distributionDate', label: 'Data de distribuição' },
]
const defaultFaceFields: FaceField[] = ['enterprise', 'claimant', 'assignees', 'dates', 'caseValue', 'paidTotal']
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
function dateInput(value: string | null | undefined) { return value ? value.slice(0, 10) : '' }
function showDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
function blankDraft(statusId: number): ProcessDraft {
  return {
    title: '', statusId, enterpriseKey: '', startDate: '', endDate: '', description: '', caseValue: '',
    claimant: '', driveUrl: '', notebookUrl: '', distributionDate: '', assigneeIds: [], children: [], items: [],
  }
}
function toDraft(process: ProcessDetail): ProcessDraft {
  return {
    title: process.title, statusId: process.statusId, enterpriseKey: process.enterpriseKey ?? '', startDate: dateInput(process.startDate),
    endDate: dateInput(process.endDate), description: process.description,
    caseValue: process.caseValue ?? '', claimant: process.claimant, driveUrl: process.driveUrl,
    notebookUrl: process.notebookUrl, distributionDate: dateInput(process.distributionDate),
    assigneeIds: process.assigneeIds, children: process.children, items: process.items,
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

export default function LegalProcessesPage({ currentUser }: { currentUser: { id: number; role: 'admin' | 'member' } }) {
  const [statuses, setStatuses] = useState<LegalStatus[]>([])
  const [processes, setProcesses] = useState<LegalProcess[]>([])
  const [legalTags, setLegalTags] = useState<LegalTag[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [processPagination, setProcessPagination] = useState<{ key: string; counts: Record<string, number> }>({ key: '', counts: {} })
  const [people, setPeople] = useState<Assignee[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [legalSection, setLegalSection] = useState<'dashboard' | 'processes'>('processes')
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState('')
  const [dashboardEnterpriseFilter, setDashboardEnterpriseFilter] = useState('')
  const [dashboardClaimantFilter, setDashboardClaimantFilter] = useState('')
  const [dashboardStartDate, setDashboardStartDate] = useState('')
  const [dashboardEndDate, setDashboardEndDate] = useState('')
  const [dashboardTagFilter, setDashboardTagFilter] = useState('')
  const [faceMenu, setFaceMenu] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showStatusForm, setShowStatusForm] = useState(false)
  const [statusManagerOpen, setStatusManagerOpen] = useState(false)
  const [statusName, setStatusName] = useState('')
  const [statusColor, setStatusColor] = useState('#3478a8')
  const [legalTagName, setLegalTagName] = useState('')
  const [legalTagColor, setLegalTagColor] = useState('#3478a8')
  const [creatingLegalTag, setCreatingLegalTag] = useState(false)
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null)
  const [editingStatusName, setEditingStatusName] = useState('')
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
  const [saving, setSaving] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [busyPayment, setBusyPayment] = useState<number | null>(null)
  const [editingLink, setEditingLink] = useState<'driveUrl' | 'notebookUrl' | null>(null)
  const [linkDraft, setLinkDraft] = useState('')
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
      const saved = JSON.parse(localStorage.getItem('legal-process-card-face') ?? 'null') as FaceField[] | null
      return saved && saved.every((item) => faceFields.some((field) => field.id === item)) ? saved : defaultFaceFields
    } catch { return defaultFaceFields }
  })

  const selectedProcessId = selected?.id ?? null

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
      setView('board')
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
    if ((!newProcess && !selected) || peopleLoaded) return
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
  }, [newProcess, selected, peopleLoaded])

  const filtered = useMemo(() => processes.filter((process) =>
    (!statusFilter || String(process.status_id) === statusFilter) &&
    (!enterpriseFilter || process.enterprise_key === enterpriseFilter) &&
    (!tagFilter || process.tags.some((tag) => String(tag.id) === tagFilter)) &&
    `${process.title} ${process.enterprise_name} ${process.claimant} ${process.assignees.map((person) => person.displayName ?? person.display_name).join(' ')}`
      .toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))), [processes, query, statusFilter, enterpriseFilter, tagFilter])
  const dashboardClaimantOptions = useMemo(() =>
    [...new Set(processes.filter((process) => !process.is_demo).map((process) => process.claimant.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'pt-BR')),
  [processes])
  const dashboardProcesses = useMemo(() => {
    if (dashboardStartDate && dashboardEndDate && dashboardStartDate > dashboardEndDate) return []
    return processes.filter((process) => {
      if (process.is_demo) return false
      if (dashboardStatusFilter && String(process.status_id) !== dashboardStatusFilter) return false
      if (dashboardEnterpriseFilter && process.enterprise_key !== dashboardEnterpriseFilter) return false
      if (dashboardClaimantFilter && process.claimant !== dashboardClaimantFilter) return false
      if (dashboardTagFilter && !process.tags.some((tag) => String(tag.id) === dashboardTagFilter)) return false
      const startDate = dateInput(process.start_date)
      if (dashboardStartDate && (!startDate || startDate < dashboardStartDate)) return false
      if (dashboardEndDate && (!startDate || startDate > dashboardEndDate)) return false
      return true
    })
  }, [processes, dashboardStartDate, dashboardEndDate, dashboardStatusFilter, dashboardEnterpriseFilter, dashboardClaimantFilter, dashboardTagFilter])
  const concludedStatusIds = new Set(statuses.filter((status) => isConcludedStatus(status.name)).map((status) => status.id))
  const dashboardConcludedCount = dashboardProcesses.filter((process) => concludedStatusIds.has(process.status_id)).length
  const dashboardActiveProcesses = dashboardProcesses.filter((process) => !concludedStatusIds.has(process.status_id))
  const dashboardTotalCaseValue = dashboardActiveProcesses.reduce((total, process) =>
    total + (process.case_value === null ? 0 : Number(process.case_value)), 0)
  const dashboardActiveProcessesWithCaseValue = dashboardActiveProcesses.filter((process) => process.case_value !== null).length
  const dashboardMissingCaseValue = dashboardProcesses.filter((process) => process.case_value === null).length
  const dashboardStatuses = statuses.map((status) => ({
    ...status,
    count: dashboardProcesses.filter((process) => process.status_id === status.id).length,
  }))
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
    dashboardStartDate || dashboardEndDate,
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
  const legalListKey = JSON.stringify([query, statusFilter, enterpriseFilter, filtered.map((process) => process.id)])
  const [legalListPageState, setLegalListPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 })
  const legalListPageCount = Math.max(1, Math.ceil(filtered.length / listPageSize))
  const legalListPage = Math.min(legalListPageState.key === legalListKey ? legalListPageState.page : 1, legalListPageCount)
  const pagedProcesses = filtered.slice((legalListPage - 1) * listPageSize, legalListPage * listPageSize)

  const processPaginationKey = JSON.stringify([query, statusFilter, enterpriseFilter, processes.map((process) => [process.id, process.status_id, process.enterprise_key])])
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
    localStorage.setItem('legal-process-card-face', JSON.stringify(updated))
  }

  async function openDetail(
    item: Pick<LegalProcess, 'id'>,
    openScheduler = false,
    openConclusion = false,
    openReopen = false,
    requestedReopenStatusId?: number,
  ) {
    setNotice(null)
    const token = ++editTokenRef.current
    try {
      const result = await apiRequest<{ process: ProcessDetail }>(`/api/legal-processes/${item.id}`)
      if (token !== editTokenRef.current) return
      processIdRef.current = result.process.id
      setSelected(result.process)
      setLegalSection('processes')
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
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir o processo.' })
    }
  }

  function startCreate(statusId = statuses.find((status) => !isConcludedStatus(status.name))?.id ?? statuses[0]?.id ?? 0) {
    editTokenRef.current += 1
    processIdRef.current = null
    setSelected(null)
    setLegalSection('processes')
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
    if (draft && JSON.stringify(draft) !== savedDraftRef.current) {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      const saved = await queueProcessSave(draft)
      if (!saved) return
    }
    editTokenRef.current += 1
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
    setEditingLink(null)
    setReplyingTo(null)
    setEditingComment(null)
    setAutoSaveState('idle')
    setAutoSaveError('')
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
          enterpriseKey: job.draft.enterpriseKey || null,
          startDate: job.draft.startDate || null,
          endDate: job.draft.endDate || null,
          caseValue,
          distributionDate: job.draft.distributionDate || null,
          children: job.draft.children.filter((child) => child.processNumber.trim() && child.description.trim()),
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

  async function saveLink(field: 'driveUrl' | 'notebookUrl') {
    if (!selected) return
    setSaving(true)
    try {
      await apiRequest(`/api/legal-processes/${selected.id}/links`, {
        method: 'PATCH',
        body: JSON.stringify({ field, url: linkDraft }),
      })
      setSelected({ ...selected, [field]: linkDraft })
      setDraft((current) => current ? { ...current, [field]: linkDraft } : current)
      setEditingLink(null)
      setNotice({ kind: 'success', text: 'Link atualizado.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o link.' })
    } finally { setSaving(false) }
  }

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
      setNotice({ kind: 'success', text: 'Processo reaberto. Os dados da conclusão anterior foram mantidos.' })
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
      setNotice({ kind: 'success', text: 'Tag jurídica criada.' })
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
      setNotice({ kind: 'success', text: 'Status criado.' })
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
      setNotice({ kind: 'success', text: 'Status excluído.' })
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
      setNotice({ kind: 'success', text: 'Processo excluído.' })
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
      setNotice({ kind: 'success', text: 'Pagamento adicionado.' })
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
    if (field === 'enterprise') return process.enterprise_name || 'Empreendimento não associado'
    if (field === 'claimant') return process.claimant || 'Requerente não informado'
    if (field === 'assignees') return process.assignees.map(assigneeName).join(', ') || 'Sem responsáveis'
    if (field === 'dates') return `${showDate(process.start_date)} — ${showDate(process.end_date)}`
    if (field === 'caseValue') return process.case_value ? currency.format(Number(process.case_value)) : 'Valor não informado'
    if (field === 'children') return `${process.completed_children_count}/${process.children_count} processos filhos`
    if (field === 'paidTotal') return `Pago ${currency.format(Number(process.paid_total))}`
    return `Distribuição ${showDate(process.distribution_date)}`
  }

  function processCard(process: LegalProcess, compact = false) {
    return (
      <article
        className={`legal-process-card ${process.is_demo ? 'legal-demo-card' : ''}`}
        key={process.id}
        role="button"
        tabIndex={0}
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
        <div className="legal-process-card-top"><span>{process.is_demo ? 'EXEMPLO' : `#${process.id}`}</span><span className="legal-process-card-tools">{!process.is_demo && <button type="button" aria-label={`Agendar atividade para ${process.title}`} title="Agendar atividade para este processo" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void openDetail(process, true) }}><CalendarDays size={13} /></button>}<GripVertical size={14} /></span></div>
        <strong className="legal-process-card-title">{process.title}</strong>
        {face.map((field) => <small className="legal-process-card-meta" key={field}>{faceValue(process, field)}</small>)}
        {process.tags.length > 0 && <div className="legal-process-card-tags">{process.tags.slice(0, 3).map((tag) => <span key={tag.id} style={{ color: tag.color, borderColor: `${tag.color}55`, background: `${tag.color}12` }}>{tag.name}</span>)}{process.tags.length > 3 && <small>+{process.tags.length - 3}</small>}</div>}
        <footer><span className="legal-process-assignee-icons">{process.assignees.slice(0, 3).map((person) => <i title={assigneeName(person)} key={person.id}>{assigneeName(person).slice(0, 1).toUpperCase()}</i>)}</span><span>{process.payment_count} pagamento(s)</span></footer>
        {compact && <select aria-label={`Mover ${process.title} para outro status`} value={process.status_id} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void changeStatus(process, Number(event.target.value)) }}>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select>}
      </article>
    )
  }

  return (
    <section className={`legal-page${!detailPageOpen && legalSection === 'processes' && processes.length > 0 && view === 'board' ? ' legal-board-page' : ''}`}>
      <header className="legal-heading">
        <div><span className="eyebrow">GESTÃO JURÍDICA</span><h1>{detailPageOpen ? (newProcess ? 'Novo processo' : selected?.title ?? 'Processo jurídico') : legalSection === 'dashboard' ? 'Dashboard jurídico' : 'Processos Jurídicos'}</h1><p>{detailPageOpen ? 'Consulte os dados, atualize as informações e acompanhe o histórico do processo.' : legalSection === 'dashboard' ? 'Indicadores de volume, fases e valores dos processos cadastrados.' : 'Acompanhe processos, responsáveis, prazos e pagamentos em um só lugar.'}</p></div>
        <div className="legal-heading-actions">
          {detailPageOpen ? <button type="button" className="secondary-button" onClick={() => void closeEditor()}><ArrowLeft size={15} /> Voltar</button> : <>
            {legalSection === 'dashboard'
              ? <button type="button" className="secondary-button" onClick={() => setLegalSection('processes')}><List size={15} /> Processos</button>
              : <><button type="button" className="secondary-button" onClick={() => setLegalSection('dashboard')}><BarChart3 size={15} /> Dashboard</button><button type="button" className="primary-button" onClick={() => startCreate()} disabled={!statuses.length}><Plus size={16} /> Novo processo</button></>}
          </>}
        </div>
      </header>
      {notice && <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span className="notice-symbol">{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button></div>}

      {!detailPageOpen && legalSection === 'processes' && <>
      {currentUser.role === 'admin' && <section className="legal-csv-upload" aria-labelledby="legal-csv-title">
        <div className="legal-csv-heading">
          <div><FileSpreadsheet size={19} /><div><h2 id="legal-csv-title">Importar cartões do ClickUp</h2><p>A prévia é lida no navegador. Ao importar, os cartões e seus dados serão salvos; o arquivo CSV original não será guardado.</p></div></div>
          <label className="secondary-button legal-csv-picker"><UploadCloud size={15} />Selecionar CSV<input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void handleLegalCsvSelected(event)} /></label>
        </div>
        {csvFileName && <div className="legal-csv-preview">
          <div className="legal-csv-preview-heading">
            <span><strong>{csvFileName}</strong> · {csvTasks.length} tarefas prontas para importar</span>
            <button type="button" className="text-action-btn" onClick={clearCsvPreview}><X size={14} /> Remover prévia</button>
          </div>
          <p className="legal-csv-temporary-note">O status do ClickUp será usado como fase do quadro; fases ausentes serão criadas. Task IDs já importados serão ignorados e cartões existentes não serão sobrescritos.</p>
          <label className="search-box legal-csv-search"><Search size={15} /><input type="search" placeholder="Buscar nas tarefas do CSV" value={csvQuery} onChange={(event) => { setCsvQuery(event.target.value); setCsvPage(1) }} /></label>
          <div className="legal-csv-table-wrap">
            <table className="legal-csv-table">
              <thead><tr><th>Tarefa</th><th>Status</th><th>Responsável</th><th>Prioridade</th><th>Prazo</th><th>Comentários</th><th>Descrição e último comentário</th></tr></thead>
              <tbody>{visibleCsvTasks.map((task, index) => <tr key={`${task.id}-${(currentCsvPage - 1) * listPageSize + index}`}>
                <td><strong>{task.name}</strong><small>{task.id}</small></td>
                <td>{task.status}</td><td>{task.assignee || '—'}</td><td>{task.priority || '—'}</td><td>{task.dueDate || '—'}</td><td>{task.commentCount || '—'}</td>
                <td className="legal-csv-details">
                  {task.taskContent && <details><summary>Ver descrição</summary><p>{task.taskContent}</p></details>}
                  {task.latestComment && <details><summary>Ver último comentário</summary><p>{task.latestComment}</p></details>}
                  {!task.taskContent && !task.latestComment && '—'}
                </td>
              </tr>)}
                {!visibleCsvTasks.length && <tr><td colSpan={7}>Nenhuma tarefa corresponde à busca.</td></tr>}
              </tbody>
            </table>
          </div>
          <LegalListPagination total={filteredCsvTasks.length} page={currentCsvPage} pageCount={csvPageCount} pageSize={listPageSize} onPageChange={setCsvPage} />
          <div className="legal-csv-import-action">
            <button type="button" className="primary-button" disabled={importingCsv || !csvTasks.length} onClick={() => void importCsvTasks()}>
              <Download size={15} />{importingCsv ? 'Importando cartões...' : `Importar ${csvTasks.length} cartões`}
            </button>
            <small>Importa todas as tarefas do CSV, mesmo se a prévia estiver filtrada.</small>
          </div>
        </div>}
      </section>}

      <div className="legal-toolbar">
        <button type="button" className="legal-filter-toggle" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((expanded) => !expanded)}><ChevronDown size={15} />{filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}{!filtersExpanded && <span>{[query, statusFilter, enterpriseFilter, tagFilter].filter(Boolean).length} filtro(s)</span>}</button>
        {filtersExpanded && <div className="legal-filter-fields">
          <label className="search-box"><Search size={15} /><input type="search" placeholder="Buscar processo, empreendimento, requerente ou responsável" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="legal-status-filter"><span>Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todas</option>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label>
          <label className="legal-status-filter"><span>Empreendimento</span><select value={enterpriseFilter} onChange={(event) => setEnterpriseFilter(event.target.value)}><option value="">Todos</option>{enterprises.map((enterprise) => <option key={enterprise.enterprise_key} value={enterprise.enterprise_key}>{enterprise.enterprise_name}</option>)}</select></label>
          <label className="legal-status-filter"><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Todas</option>{legalTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <button type="button" className="filter-clear-button" disabled={!query && !statusFilter && !enterpriseFilter && !tagFilter} onClick={() => { setQuery(''); setStatusFilter(''); setEnterpriseFilter(''); setTagFilter('') }}><X size={14} /> Limpar filtros</button>
        </div>}
        <div className="legal-toolbar-actions">
          <div className="legal-face-menu-wrap"><button type="button" className="secondary-button" aria-expanded={faceMenu} onClick={() => setFaceMenu((value) => !value)}>Campos do cartão</button>
            {faceMenu && <div className="legal-face-menu">{faceFields.map((field) => <label key={field.id}><input type="checkbox" checked={face.includes(field.id)} onChange={() => toggleFaceField(field.id)} />{field.label}</label>)}</div>}
          </div>
          <div className="legal-view-switch" aria-label="Modo de visualização">
            <button type="button" className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}><Columns3 size={15} /> Quadro</button>
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={15} /> Lista</button>
          </div>
        </div>
      </div>

      {filtersExpanded && <>
        <details className="legal-status-manager" open={statusManagerOpen} onToggle={(event) => setStatusManagerOpen(event.currentTarget.open)}>
          <summary><span><strong>Organizar situações e fases</strong><small>Edite nomes, ajuste a ordem do Kanban ou remova fases vazias.</small></span><i>{statuses.length} fases</i><ChevronDown size={16} /></summary>
          <div className="legal-status-toolbar">
            {statuses.map((status, index) => <div className="legal-status-chip" key={status.id}><i style={{ background: status.color }} />{editingStatusId === status.id
              ? <form className="legal-status-edit-form" onSubmit={(event) => void updateStatus(event, status)}><input aria-label={`Novo nome para ${status.name}`} value={editingStatusName} onChange={(event) => setEditingStatusName(event.target.value)} maxLength={80} required autoFocus /><button type="submit" title="Salvar nome" aria-label="Salvar nome"><Check size={13} /></button><button type="button" title="Cancelar edição" aria-label="Cancelar edição" onClick={() => { setEditingStatusId(null); setEditingStatusName('') }}><X size={13} /></button></form>
              : <><span className="legal-status-chip-name">{status.name}</span><button type="button" title={`Editar nome de ${status.name}`} aria-label={`Editar nome de ${status.name}`} onClick={() => { setEditingStatusId(status.id); setEditingStatusName(status.name) }}><Pencil size={12} /></button></>}
              <span className="legal-status-order"><button type="button" title={`Mover ${status.name} para a esquerda`} aria-label={`Mover ${status.name} para a esquerda`} disabled={savingStatusOrder || index === 0} onClick={() => void moveStatus(status.id, -1)}><ArrowLeft size={12} /></button><button type="button" title={`Mover ${status.name} para a direita`} aria-label={`Mover ${status.name} para a direita`} disabled={savingStatusOrder || index === statuses.length - 1} onClick={() => void moveStatus(status.id, 1)}><ArrowRight size={12} /></button></span><button type="button" title={`Excluir status ${status.name}`} aria-label={`Excluir status ${status.name}`} onClick={() => void deleteStatus(status)}><X size={12} /></button></div>)}
            <button type="button" className="legal-status-add" onClick={() => { setShowStatusForm((value) => !value); setStatusManagerOpen(true) }}><Plus size={15} /><strong>Novo status</strong><small>Adicione uma fase ao quadro</small></button>
          </div>
        {showStatusForm && <form className="legal-status-create" onSubmit={(event) => void createStatus(event)}><input value={statusName} onChange={(event) => setStatusName(event.target.value)} placeholder="Nome da situação/fase" maxLength={80} required /><input type="color" value={statusColor} onChange={(event) => setStatusColor(event.target.value)} aria-label="Cor da situação" /><button className="secondary-button" type="submit">Criar status</button><button className="text-action-btn" type="button" onClick={() => setShowStatusForm(false)}>Cancelar</button></form>}
        </details>
      </>}

      {loading ? <div className="legal-empty">Carregando processos...</div>
        : !processes.length && view === 'list' ? <div className="legal-empty"><FileText size={29} /><strong>Ainda não há processos jurídicos</strong><span>Crie um processo ou carregue um exemplo fictício removível para conhecer os campos.</span><div><button className="primary-button" type="button" onClick={() => startCreate()}><Plus size={15} /> Novo processo</button><button className="secondary-button" type="button" onClick={() => void createDemo()}>Carregar exemplo fictício</button></div></div>
          : view === 'board' ? <><div className="legal-board-controls" aria-label="Navegação das situações jurídicas"><span>Deslize ou arraste para ver outras situações</span><button type="button" aria-label="Mostrar situações anteriores" title="Mostrar situações anteriores" onClick={() => moveBoard(-1)}><ArrowLeft size={17} /></button><button type="button" aria-label="Mostrar próximas situações" title="Mostrar próximas situações" onClick={() => moveBoard(1)}><ArrowRight size={17} /></button></div><div className="legal-board" ref={boardRef} onPointerDown={startBoardDrag} onPointerMove={moveBoardDrag} onPointerUp={endBoardDrag} onPointerCancel={endBoardDrag} onClickCapture={(event) => { if (suppressBoardClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressBoardClickRef.current = false } }}>{statuses.map((status) => {
            const items = filtered.filter((process) => process.status_id === status.id)
            const visibleCount = visibleProcessCounts[String(status.id)] ?? kanbanPageSize
            const itemsToShow = items.slice(0, visibleCount)
            return <section className="legal-column" key={status.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const item = processes.find((process) => process.id === dragged); if (item && item.status_id !== status.id) void changeStatus(item, status.id); setDragged(null) }}>
              <header><i style={{ background: status.color }} /><strong>{status.name}</strong><span>{items.length}</span></header>
              <div className="legal-column-body">{itemsToShow.map((process) => processCard(process))}{itemsToShow.length < items.length && <button type="button" className="kanban-load-more" onClick={() => loadMoreProcesses(String(status.id), visibleCount)}>Carregar mais ({Math.min(kanbanPageSize, items.length - visibleCount)})</button>}<button type="button" className="legal-add-card" onClick={() => startCreate(status.id)}><Plus size={14} /> Adicionar processo</button></div>
            </section>
          })}<section className="legal-new-column"><button type="button" onClick={() => setShowStatusForm(true)}><Plus size={15} /> Nova situação</button></section></div></>
            : <><div className="legal-list-wrap"><table className="legal-list"><thead><tr><th>PROCESSO</th><th>EMPREENDIMENTO</th><th>SITUAÇÃO / FASE</th><th>REQUERENTE</th><th>RESPONSÁVEIS</th><th>PERÍODO</th><th>VALOR</th><th>PAGO</th></tr></thead><tbody>{pagedProcesses.map((process) => <tr key={process.id} onClick={() => void openDetail(process)}><td><strong>{process.title}</strong>{process.is_demo && <small>Exemplo fictício</small>}</td><td>{process.enterprise_name || '—'}</td><td><span className="legal-status-label"><i style={{ background: process.status_color }} />{process.status_name}<select aria-label={`Mover ${process.title} para outro status`} value={process.status_id} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void changeStatus(process, Number(event.target.value)) }}>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></span></td><td>{process.claimant || '—'}</td><td>{process.assignees.map(assigneeName).join(', ') || '—'}</td><td>{showDate(process.start_date)} – {showDate(process.end_date)}</td><td>{process.case_value ? currency.format(Number(process.case_value)) : '—'}</td><td>{currency.format(Number(process.paid_total))}</td></tr>)}</tbody></table></div><LegalListPagination total={filtered.length} page={legalListPage} pageCount={legalListPageCount} pageSize={listPageSize} onPageChange={(page) => setLegalListPageState({ key: legalListKey, page })} /></>}
      {processes.length > 0 && !filtered.length && <div className="legal-empty-inline">Nenhum processo encontrado com os filtros aplicados.</div>}
      </>}

      {!detailPageOpen && legalSection === 'dashboard' && <section className="legal-dashboard">
        <div className="legal-dashboard-filters">
          <label><span>Início do processo a partir de</span><input type="date" value={dashboardStartDate} onChange={(event) => setDashboardStartDate(event.target.value)} /></label>
          <label><span>Início do processo até</span><input type="date" value={dashboardEndDate} onChange={(event) => setDashboardEndDate(event.target.value)} /></label>
          <label><span>Status</span><select value={dashboardStatusFilter} onChange={(event) => setDashboardStatusFilter(event.target.value)}><option value="">Todos os status</option>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label>
          <label><span>Empreendimento</span><select value={dashboardEnterpriseFilter} onChange={(event) => setDashboardEnterpriseFilter(event.target.value)}><option value="">Todos</option>{enterprises.map((enterprise) => <option key={enterprise.enterprise_key} value={enterprise.enterprise_key}>{enterprise.enterprise_name}</option>)}</select></label>
          <label><span>Requerente</span><select value={dashboardClaimantFilter} onChange={(event) => setDashboardClaimantFilter(event.target.value)}><option value="">Todos</option>{dashboardClaimantOptions.map((claimant) => <option key={claimant} value={claimant}>{claimant}</option>)}</select></label>
          <label><span>Tag</span><select value={dashboardTagFilter} onChange={(event) => setDashboardTagFilter(event.target.value)}><option value="">Todas</option>{legalTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <button type="button" className="filter-clear-button" disabled={!dashboardFiltersActive} onClick={() => {
            setDashboardStartDate('')
            setDashboardEndDate('')
            setDashboardStatusFilter('')
            setDashboardEnterpriseFilter('')
            setDashboardClaimantFilter('')
            setDashboardTagFilter('')
          }}><X size={14} /> Limpar filtros</button>
        </div>
        {dashboardStartDate && dashboardEndDate && dashboardStartDate > dashboardEndDate && <p className="legal-dashboard-warning" role="alert">A data inicial deve ser anterior ou igual à data final.</p>}
        {loading ? <div className="legal-empty">Carregando indicadores jurídicos...</div> : <>
          <div className="legal-dashboard-kpis">
            <article><span>Processos no recorte</span><strong>{dashboardProcesses.length}</strong><small>{dashboardFiltersActive ? 'Conforme filtros aplicados' : 'Todos os processos cadastrados'}</small></article>
            <article><span>Em andamento</span><strong>{dashboardProcesses.length - dashboardConcludedCount}</strong><small>{dashboardConcludedCount} concluído(s)</small></article>
            <article><span>Valor das causas em andamento</span><strong>{currency.format(dashboardTotalCaseValue)}</strong><small>Exclui processos concluídos</small></article>
            <article className={dashboardMissingCaseValue ? 'has-warning' : ''}><span>Valor da causa pendente</span><strong>{dashboardMissingCaseValue}</strong><small>{dashboardMissingCaseValue ? 'Processos sem valor cadastrado' : 'Todos os processos têm valor cadastrado'}</small></article>
          </div>
          {dashboardMissingCaseValue > 0 && <div className="legal-dashboard-warning" role="status"><CircleAlert size={17} /> {dashboardMissingCaseValue} processo(s) do recorte não têm valor da causa cadastrado; o valor das causas em andamento soma apenas os processos não concluídos com valor informado.</div>}
          {!dashboardProcesses.length ? <div className="legal-empty-inline">Nenhum processo encontrado com os filtros selecionados.</div> : <>
            <div className="legal-dashboard-grid">
              <section className="legal-dashboard-panel">
                <header><div><h2>Processos por status</h2><p>Distribuição do recorte atual</p></div><strong>{dashboardProcesses.length}</strong></header>
                <div className="legal-dashboard-bars">{dashboardStatuses.map((status) => <div className="legal-dashboard-bar-row" key={status.id}><span>{status.name}</span><div><i style={{ width: `${status.count / dashboardStatusMax * 100}%`, background: status.color }} /></div><strong>{status.count}</strong></div>)}</div>
              </section>
              <section className="legal-dashboard-panel">
                <header><div><h2>Indicadores do processo</h2><p>Qualidade e composição dos registros</p></div></header>
                <div className="legal-dashboard-summary">
                  <div><span>Com valor de causa</span><strong>{dashboardProcesses.length - dashboardMissingCaseValue}</strong></div>
                  <div><span>Valor médio em andamento</span><strong>{dashboardActiveProcessesWithCaseValue ? currency.format(dashboardTotalCaseValue / dashboardActiveProcessesWithCaseValue) : '—'}</strong></div>
                  <div><span>Percentual concluído</span><strong>{dashboardProcesses.length ? `${Math.round(dashboardConcludedCount / dashboardProcesses.length * 100)}%` : '—'}</strong></div>
                </div>
              </section>
              {([
                { title: 'Processos por requerente', groups: dashboardClaimantGroups, onSelect: setDashboardClaimantFilter },
                { title: 'Processos por empreendimento', groups: dashboardEnterpriseGroups, onSelect: (name: string) => {
                  const key = enterprises.find((enterprise) => enterprise.enterprise_name === name)?.enterprise_key
                  if (key) setDashboardEnterpriseFilter(key)
                } },
              ] as const).map(({ title, groups, onSelect }) => <section className="legal-dashboard-panel legal-dashboard-group-panel" key={title}>
                <header><div><h2>{title}</h2><p>Até 10 grupos; valores excluem processos concluídos.</p></div></header>
                <div className="legal-dashboard-table-wrap"><table className="legal-dashboard-table"><thead><tr><th>Nome</th><th>Processos</th><th>Valor em andamento</th></tr></thead><tbody>{groups.map((group) => <tr key={group.name}><td><button type="button" onClick={() => onSelect(group.name)}>{group.name}</button>{group.missing > 0 && <small>{group.missing} sem valor</small>}</td><td>{group.count}</td><td>{currency.format(group.caseValue)}</td></tr>)}</tbody></table></div>
              </section>)}
            </div>
          </>}
        </>}
      </section>}

      {detailPageOpen && draft && <section ref={processDetailRef} className="legal-detail-page" aria-labelledby="legal-editor-title">
          <nav className="legal-detail-nav">{selected && !selected.isDemo && (isConcludedStatus(statuses.find((status) => status.id === selected.statusId)?.name ?? '')
            ? <button type="button" className="primary-button" disabled={!statuses.some((status) => !isConcludedStatus(status.name))} title={!statuses.some((status) => !isConcludedStatus(status.name)) ? 'Crie uma fase diferente de Concluído antes de reabrir.' : undefined} onClick={() => { setReopenStatusId(String(statuses.find((status) => !isConcludedStatus(status.name))?.id ?? '')); setShowReopenForm((open) => !open) }}><ArrowRight size={15} /> Desconcluir processo</button>
            : <button type="button" className="primary-button" onClick={() => { setConclusionResult(''); setConclusionSummary(''); setShowConclusionForm((open) => !open) }}><Check size={15} /> Concluir processo</button>)}</nav>
          <header className="legal-modal-heading"><div><span className="eyebrow">PROCESSO JURÍDICO{selected?.isDemo ? ' · EXEMPLO' : ''}</span><h2 id="legal-editor-title">{newProcess ? 'Novo processo' : selected?.title}</h2></div></header>
          {selectedConclusionHistory.length > 0 && <section className="legal-conclusion-record">
            <strong>{isConcludedStatus(statuses.find((status) => status.id === selected?.statusId)?.name ?? '') ? 'Histórico de conclusão' : 'Conclusões anteriores'}</strong>
            {selectedConclusionHistory.map((conclusion) => <article key={conclusion.id}>
              <b>{conclusionLabels[conclusion.result]}</b>
              {conclusion.concludedAt && <small>{new Date(conclusion.concludedAt).toLocaleString('pt-BR')}{conclusion.concludedByName ? ` · ${conclusion.concludedByName}` : ''}</small>}
              <p>{conclusion.summary}</p>
            </article>)}
          </section>}
          {selected && !selected.isDemo && <section className="legal-process-tag-manager" aria-labelledby="legal-process-tags-heading">
            <header><div><h3 id="legal-process-tags-heading">Tags do processo</h3><p>Classifique e encontre este processo pelos filtros de tags.</p></div><span>{selected.tags.length} selecionada(s)</span></header>
            {legalTags.length > 0
              ? <div className="legal-process-tag-options">{legalTags.map((tag) => <label key={tag.id} style={{ '--legal-tag-color': tag.color } as CSSProperties}><input type="checkbox" checked={selected.tags.some((current) => current.id === tag.id)} onChange={(event) => void toggleProcessTag(tag.id, event.target.checked)} /><span>{tag.name}</span></label>)}
              </div>
              : <p className="legal-tag-empty">Nenhuma tag cadastrada. Crie a primeira para começar a classificar processos.</p>}
            <form className="legal-create-tag-form" onSubmit={(event) => void createLegalTag(event)}>
              <input aria-label="Nome da nova tag" placeholder="Nome da nova tag" value={legalTagName} onChange={(event) => setLegalTagName(event.target.value)} maxLength={60} required />
              <input type="color" aria-label="Cor da tag" value={legalTagColor} onChange={(event) => setLegalTagColor(event.target.value)} />
              <button type="submit" className="secondary-button" disabled={creatingLegalTag}>{creatingLegalTag ? 'Criando...' : <><Plus size={14} /> Criar tag</>}</button>
            </form>
          </section>}
          {selected && showConclusionForm && <form className="legal-conclusion-form" onSubmit={(event) => void completeSelectedProcess(event)}>
            <div><strong>Conclusão do processo</strong><small>Registre o resultado para mover o processo ao status Concluído.</small></div>
            <label className="legal-field"><span>Resultado para a empresa *</span><select value={conclusionResult} onChange={(event) => setConclusionResult(event.target.value as ConclusionResult | '')} required><option value="">Selecione o resultado</option>{(Object.entries(conclusionLabels) as [ConclusionResult, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="legal-field legal-field-full"><span>Resumo de como o processo foi finalizado *</span><textarea rows={3} value={conclusionSummary} onChange={(event) => setConclusionSummary(event.target.value)} maxLength={2000} required /></label>
            <div className="legal-form-actions legal-field-full"><button type="button" className="secondary-button" onClick={() => setShowConclusionForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={savingConclusion || !conclusionResult}>{savingConclusion ? 'Concluindo...' : 'Confirmar conclusão'}</button></div>
          </form>}
          {selected && showReopenForm && <form className="legal-conclusion-form" onSubmit={(event) => void reopenSelectedProcess(event)}>
            <div><strong>Reabrir processo</strong><small>Escolha a fase para a qual o processo retornará. A conclusão anterior será mantida como histórico.</small></div>
            <label className="legal-field"><span>Fase *</span><select value={reopenStatusId} onChange={(event) => setReopenStatusId(event.target.value)} required>{statuses.filter((status) => !isConcludedStatus(status.name)).map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label>
            <div className="legal-form-actions legal-field-full"><button type="button" className="secondary-button" onClick={() => setShowReopenForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={savingConclusion || !reopenStatusId}>{savingConclusion ? 'Reabrindo...' : 'Confirmar reabertura'}</button></div>
          </form>}
          <form className="legal-process-form" onSubmit={(event) => event.preventDefault()}>
            <div className={`legal-autosave-status is-${autoSaveState}`} role={autoSaveState === 'error' ? 'alert' : 'status'} aria-live="polite">
              {autoSaveState === 'saving' ? 'Salvando alterações automaticamente...' :
                autoSaveState === 'pending' ? 'Alterações pendentes; salvamento automático em instantes...' :
                  autoSaveState === 'error' ? autoSaveError :
                    autoSaveState === 'saved' ? 'Alterações salvas automaticamente.' :
                      newProcess ? 'O processo será criado automaticamente após preencher o nome.' : 'As alterações são salvas automaticamente.'}
            </div>
            <label className="legal-field legal-field-full"><span>Nome do processo</span><input value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); if (!event.target.value.trim()) { setAutoSaveState('idle'); setAutoSaveError('') } }} maxLength={240} required autoFocus /></label>
            <label className="legal-field"><span>Situação / Fase</span><select value={draft.statusId} onChange={(event) => setDraft({ ...draft, statusId: Number(event.target.value) })} required>{statuses.map((status) => <option key={status.id} value={status.id} disabled={selected
              ? isConcludedStatus(statuses.find((item) => item.id === selected.statusId)?.name ?? '')
                ? status.id !== selected.statusId
                : isConcludedStatus(status.name)
              : isConcludedStatus(status.name)}>{status.name}</option>)}</select></label>
            <label className="legal-field"><span>Empreendimento</span><select value={draft.enterpriseKey} onChange={(event) => setDraft({ ...draft, enterpriseKey: event.target.value })}><option value="">Sem empreendimento associado</option>{enterprises.map((enterprise) => <option key={enterprise.enterprise_key} value={enterprise.enterprise_key}>{enterprise.enterprise_name}</option>)}</select></label>
            <div className="legal-field legal-assignee-field"><span>Responsáveis</span><SearchableMultiSelect label="Selecionar responsáveis" options={assigneeOptions} value={draft.assigneeIds.map(String)} onChange={(values) => setDraft({ ...draft, assigneeIds: values.map(Number) })} emptyLabel="Nenhum responsável cadastrado." />
              {draft.assigneeIds.length > 0 && <div className="legal-assignee-selected" aria-label="Responsáveis selecionados">
                {people.filter((person) => draft.assigneeIds.includes(person.id)).map((person) => <span key={person.id}>{assigneeName(person)}<button type="button" aria-label={`Remover ${assigneeName(person)}`} onClick={() => setDraft({ ...draft, assigneeIds: draft.assigneeIds.filter((id) => id !== person.id) })}><X size={12} /></button></span>)}
              </div>}
            </div>
            <label className="legal-field"><span>Data de início</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label className="legal-field"><span>Data de finalização</span><input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
            <label className="legal-field legal-field-full"><span>Descrição</span><textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={20_000} /></label>
            <label className="legal-field"><span>Valor da causa (R$)</span><input type="number" min="0" step="0.01" value={draft.caseValue} onChange={(event) => setDraft({ ...draft, caseValue: event.target.value })} /></label>
            <label className="legal-field"><span>Requerente</span><input value={draft.claimant} onChange={(event) => setDraft({ ...draft, claimant: event.target.value })} maxLength={240} /></label>
            {(['driveUrl', 'notebookUrl'] as const).map((field) => {
              const label = field === 'driveUrl' ? 'Google Drive' : 'Notebook'
              return <div className="legal-field legal-resource-field" key={field}><span>{label}</span>
                {selected ? editingLink === field
                  ? <div className="legal-link-edit"><input type="url" value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="https://" /><button type="button" className="primary-button" disabled={saving} onClick={() => void saveLink(field)}><Save size={14} /> Salvar</button><button type="button" className="text-action-btn" onClick={() => setEditingLink(null)}>Cancelar</button></div>
                  : <div className="legal-resource-value">{selected[field] ? <a href={selected[field]} target="_blank" rel="noreferrer">{selected[field]}</a> : <span>Link não informado</span>}<button type="button" className="text-action-btn" onClick={() => { setLinkDraft(selected[field]); setEditingLink(field) }} aria-label={`Editar link ${label}`}><Pencil size={14} /> Editar</button></div>
                  : <input type="url" value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} placeholder="https://" />}
              </div>
            })}
            <label className="legal-field"><span>Data de distribuição</span><input type="date" value={draft.distributionDate} onChange={(event) => setDraft({ ...draft, distributionDate: event.target.value })} /></label>
            <section className="legal-children-field legal-field-full"><div className="legal-subsection-title"><div><strong>Processos filhos</strong><small>Cadastre o número, a descrição, a fase e a data da última movimentação.</small></div><button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, children: [...draft.children, { processNumber: '', description: '', statusId: draft.statusId, movementDate: '', isDone: false }] })}><Plus size={14} /> Adicionar</button></div>
              {draft.children.map((child, index) => <div className="legal-child-card" key={child.id ?? `new-${index}`}>
                <div className="legal-child-row"><label className="legal-child-done"><input type="checkbox" checked={child.isDone} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, i) => i === index ? { ...entry, isDone: event.target.checked } : entry) })} /> Concluído</label><input value={child.processNumber} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, i) => i === index ? { ...entry, processNumber: event.target.value } : entry) })} placeholder="Número do processo" maxLength={100} required /><button type="button" className="icon-button" aria-label="Remover processo filho" onClick={() => setDraft({ ...draft, children: draft.children.filter((_, i) => i !== index) })}><Trash2 size={14} /></button></div>
                <textarea value={child.description} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry) })} placeholder="Descrição do processo filho" maxLength={2000} required />
                <div className="legal-child-meta"><label className="legal-field"><span>Status</span><select value={child.statusId} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, i) => i === index ? { ...entry, statusId: Number(event.target.value) } : entry) })}>{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label><label className="legal-field"><span>Data de movimentação</span><input type="date" value={dateInput(child.movementDate)} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, i) => i === index ? { ...entry, movementDate: event.target.value || null } : entry) })} /></label></div>
              </div>)}
            </section>
            <section className="legal-items-field legal-field-full"><div className="legal-subsection-title"><div><strong>Itens do processo</strong><small>Cadastre tarefas, documentos ou providências e marque quando cada item for concluído.</small></div><button type="button" className="secondary-button" disabled={draft.items.length >= 100} onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', isDone: false }] })}><Plus size={14} /> Adicionar item</button></div>
              {draft.items.map((item, index) => <div className="legal-item-row" key={item.id ?? `item-${index}`}>
                <label><input type="checkbox" checked={item.isDone} onChange={(event) => setDraft({ ...draft, items: draft.items.map((entry, i) => i === index ? { ...entry, isDone: event.target.checked } : entry) })} /><span>Concluído</span></label>
                <input value={item.title} onChange={(event) => setDraft({ ...draft, items: draft.items.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry) })} placeholder="Descrição do item" maxLength={500} aria-label={`Descrição do item ${index + 1}`} />
                <button type="button" className="icon-button" aria-label={`Remover item ${index + 1}`} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
              </div>)}
              {!draft.items.length && <p className="legal-items-empty">Nenhum item cadastrado.</p>}
            </section>
            <div className="legal-form-actions legal-field-full"><button type="button" className="secondary-button" onClick={() => void closeEditor()}>{autoSaveState === 'saving' || autoSaveState === 'pending' ? 'Salvar e fechar' : 'Fechar'}</button>{selected && <button type="button" className="text-action-btn danger-action" onClick={() => void deleteProcess()}><Trash2 size={14} /> Excluir processo</button>}</div>
          </form>

          {selected && scheduleProcess && <section className="legal-schedule">
            <header className="legal-payments-heading">
              <div><h3>Programação</h3><p>Agende uma atividade vinculada a este processo jurídico.</p></div>
              {!showProgrammingForm && <button type="button" className="secondary-button" onClick={() => setShowProgrammingForm(true)}><CalendarDays size={14} /> Agendar atividade</button>}
            </header>
            {showProgrammingForm && <TicketProgrammingForm
              tickets={[]}
              initialLegalProcessId={scheduleProcess.id}
              initialLegalProcess={scheduleProcess}
              programmingType="general"
              allowMixedCollaborators
              onCancel={() => setShowProgrammingForm(false)}
              onSaved={() => { setShowProgrammingForm(false); void load() }}
            />}
          </section>}

          {selected && <section className="legal-comments">
            <header className="legal-payments-heading"><div><h3>Comentários</h3><p>Use @ para marcar pessoas; responda e edite comentários da conversa.</p></div><MessageCircle size={17} /></header>
            <div className="legal-comment-list">
              {selected.comments.filter((entry) => !entry.parentCommentId).map((entry) => {
                const replies = selected.comments.filter((reply) => reply.parentCommentId === entry.id)
                return <article className="legal-comment-thread" key={entry.id}>
                  {[entry, ...replies].map((item) => {
                    const editable = currentUser.role === 'admin' || item.authorId === currentUser.id
                    return <div className={`legal-comment ${item.parentCommentId ? 'legal-comment-reply' : ''}`} key={item.id}>
                      <span className="legal-comment-avatar">{item.authorName.slice(0, 1).toUpperCase()}</span>
                      <div className="legal-comment-content"><header><strong>{item.authorName}</strong><time>{new Date(item.createdAt).toLocaleString('pt-BR')}{item.updatedAt !== item.createdAt ? ' · editado' : ''}</time></header>
                        {editingComment?.id === item.id
                          ? <form className="legal-comment-edit" onSubmit={(event) => { event.preventDefault(); void saveComment(item.id, editingComment.body) }}><textarea value={editingComment.body} onChange={(event) => setEditingComment({ ...editingComment, body: event.target.value })} maxLength={6000} required /><button type="submit" className="primary-button" disabled={busyComment}>Salvar</button><button type="button" className="secondary-button" onClick={() => setEditingComment(null)}>Cancelar</button></form>
                          : <p>{item.body}</p>}
                        {item.mentions.length > 0 && <small>Marcados: {item.mentions.map((person) => person.displayName).join(', ')}</small>}
                        <div className="legal-comment-actions">{!item.parentCommentId && <button type="button" className="text-action-btn" onClick={() => { setReplyingTo(item.id); setComment('') }}><MessageCircle size={13} /> Responder</button>}{editable && <><button type="button" className="text-action-btn" onClick={() => setEditingComment(item)}><Pencil size={13} /> Editar</button><button type="button" className="text-action-btn danger-action" onClick={() => void deleteComment(item.id)}><Trash2 size={13} /> Excluir</button></>}</div>
                      </div>
                    </div>
                  })}
                </article>
              })}
              {!selected.comments.length && <p className="legal-empty-inline">Ainda não há comentários.</p>}
            </div>
            {replyingTo && <div className="legal-replying-banner">Respondendo a {selected.comments.find((entry) => entry.id === replyingTo)?.authorName ?? 'comentário'}<button type="button" className="text-action-btn" onClick={() => setReplyingTo(null)}>Cancelar</button></div>}
            <form className="legal-comment-form" onSubmit={(event) => void postComment(event)}>
              <div className="legal-mention-composer"><textarea value={comment} onChange={(event) => updateCommentText(event.target.value, event.currentTarget.selectionStart)} rows={3} maxLength={6000} placeholder={replyingTo ? 'Escreva uma resposta...' : 'Escreva um comentário... Use @ para marcar alguém'} required />
                {mentionQuery !== null && <div className="legal-mention-suggestions" role="listbox">{people.filter((person) => assigneeName(person).toLocaleLowerCase('pt-BR').includes(mentionQuery)).slice(0, 6).map((person) => <button key={person.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(person)}><AtSign size={13} />{assigneeName(person)}</button>)}</div>}
              </div>
              <div className="legal-comment-form-footer"><small>{mentions.length ? `${mentions.length} pessoa(s) marcada(s)` : 'As marcações ficam registradas no comentário.'}</small><button className="primary-button" type="submit" disabled={busyComment || !comment.trim()}>{busyComment ? 'Enviando...' : replyingTo ? 'Responder' : 'Comentar'}</button></div>
            </form>
          </section>}

          {selected && <section className="legal-payments">
            <header className="legal-payments-heading"><div><h3>Pagamentos</h3><p>Total pago até agora</p></div><strong>{currency.format(Number(selected.paidTotal))}</strong></header>
            {selected.payments.map((payment) => <article className="legal-payment-card" key={payment.id}>
              <div className="legal-payment-main"><label className="legal-payment-check"><input type="checkbox" checked={payment.isPaid} disabled={busyPayment === payment.id} onChange={(event) => void updatePayment(payment, { isPaid: event.target.checked })} /><span>{payment.isPaid ? 'Pago' : 'Pendente'}</span></label><strong>{payment.description}</strong><span>{currency.format(Number(payment.amount))}</span><small>Data para pagamento: {showDate(payment.dueDate)}</small></div>
              <div className="legal-payment-attachments">{payment.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void downloadProof(payment, attachment)}><Download size={13} />{attachment.fileName}</button>)}</div>
              <button type="button" className="text-action-btn danger-action" onClick={() => void deletePayment(payment)}><Trash2 size={13} /> Excluir</button>
            </article>)}
            <form className="legal-payment-form" onSubmit={(event) => void addPayment(event)}>
              <strong>Adicionar pagamento</strong>
              <label className="legal-field"><span>Descrição</span><input value={paymentDraft.description} onChange={(event) => setPaymentDraft({ ...paymentDraft, description: event.target.value })} maxLength={500} required /></label>
              <label className="legal-field"><span>Valor pago / previsto (R$)</span><input type="number" min="0" step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} required /></label>
              <label className="legal-field"><span>Data para pagamento</span><input type="date" value={paymentDraft.dueDate} onChange={(event) => setPaymentDraft({ ...paymentDraft, dueDate: event.target.value })} /></label>
              <label className="legal-payment-check"><input type="checkbox" checked={paymentDraft.isPaid} onChange={(event) => setPaymentDraft({ ...paymentDraft, isPaid: event.target.checked })} /><span>Já foi pago</span></label>
              <label className="legal-field legal-field-full"><span>Comprovante (PDF, JPG, PNG ou WebP até 5 MiB)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)} /></label>
              <button type="submit" className="secondary-button legal-field-full" disabled={savingPayment}>{savingPayment ? 'Salvando...' : <><Plus size={14} /> Adicionar pagamento</>}</button>
            </form>
          </section>}
      </section>}

    </section>
  )
}
