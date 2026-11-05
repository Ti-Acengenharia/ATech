import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  GripVertical,
  LayoutGrid,
  List,
  ListTodo,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoveHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import { ATechLoading } from './ATechLoading'
import './PersonalActivitiesPage.css'

export type ActivityPriority = 'urgent' | 'high' | 'medium' | 'low'

interface ActivityColumn {
  id: number
  name: string
  position: number
}

interface ActivityTag {
  id: number
  name: string
}

interface PersonalActivity {
  id: number
  columnId: number
  title: string
  description: string
  priority: ActivityPriority
  startDate: string | null
  dueDate: string | null
  tags: string[]
  commentsCount?: number
  attachmentsCount?: number
  checklistTotal?: number
  checklistDone?: number
}

interface ActivityChecklistItem {
  id: number
  activityId: number
  title: string
  isDone: boolean
  position: number
}

interface ActivityComment {
  id: number
  body: string
  createdAt: string
  updatedAt: string
  authorId: number
  authorName: string
}

interface ActivityAttachment {
  id: number
  fileName: string
  contentType: string
  fileSize: number
  createdAt: string
  uploadedBy: number
  uploadedByName: string
}

interface BoardUser {
  id: number
  displayName: string
}

interface ActivityDraft {
  id: number | null
  columnId: number
  title: string
  description: string
  priority: ActivityPriority
  startDate: string
  dueDate: string
  tags: string[]
}

const PRIORITY_CONFIG: Record<
  ActivityPriority,
  { label: string; badgeClass: string; color: string; bg: string; icon: string }
> = {
  urgent: { label: 'Urgente', badgeClass: 'priority-urgent', color: '#dc2626', bg: '#fef2f2', icon: '⚑' },
  high: { label: 'Alta', badgeClass: 'priority-high', color: '#ea580c', bg: '#fff7ed', icon: '⚑' },
  medium: { label: 'Média', badgeClass: 'priority-medium', color: '#0f3b99', bg: '#eff6ff', icon: '⚑' },
  low: { label: 'Baixa', badgeClass: 'priority-low', color: '#64748b', bg: '#f1f5f9', icon: '⚑' },
}

const PRESET_TAG_COLORS: Record<string, string> = {
  obra: '#0284c7',
  cliente: '#7c3aed',
  financeiro: '#059669',
  jurídico: '#d97706',
  juridico: '#d97706',
  pessoal: '#db2777',
  cvcrm: '#4f46e5',
  atendimento: '#0f3b99',
  garantia: '#0d9488',
}

function getTagColor(tagName: string): string {
  const norm = tagName.trim().toLowerCase()
  if (PRESET_TAG_COLORS[norm]) return PRESET_TAG_COLORS[norm]
  let hash = 0
  for (let i = 0; i < norm.length; i++) {
    hash = norm.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 42%)`
}

function formatDateDisplay(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const parts = isoDate.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`
  }
  return isoDate
}

function getActivityPayload(draft: ActivityDraft) {
  const rawTitle = typeof draft.title === 'string' ? draft.title : String(draft.title || '')
  const safeTags = Array.isArray(draft.tags)
    ? draft.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
    : []
  return {
    columnId: Number(draft.columnId) || 1,
    title: rawTitle.trim(),
    description: typeof draft.description === 'string' ? draft.description : '',
    priority: draft.priority || 'medium',
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    tags: [...new Set(safeTags)].slice(0, 20),
  }
}

function getDraftSnapshot(draft: ActivityDraft) {
  return JSON.stringify(getActivityPayload(draft))
}

function emptyDraft(columnId: number): ActivityDraft {
  return {
    id: null,
    columnId,
    title: '',
    description: '',
    priority: 'medium',
    startDate: '',
    dueDate: '',
    tags: [],
  }
}

function normalizeTagName(name: string) {
  return name.trim().toLocaleLowerCase('pt-BR')
}

export default function PersonalActivitiesPage({
  currentUser,
  canViewOtherActivities,
}: {
  currentUser: { id: number; displayName: string }
  canViewOtherActivities: boolean
}) {
  const currentUserId = Number(currentUser.id)
  const [ownerId, setOwnerId] = useState(currentUserId)
  const [loadedOwnerId, setLoadedOwnerId] = useState<number | null>(null)
  const [ownerName, setOwnerName] = useState(currentUser.displayName)
  const [users, setUsers] = useState<BoardUser[]>([])
  const [columns, setColumns] = useState<ActivityColumn[]>([])
  const [tags, setTags] = useState<ActivityTag[]>([])
  const [activities, setActivities] = useState<PersonalActivity[]>([])

  // Views & Filters
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'week'>('kanban')
  const [activitySearch, setActivitySearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [priorityFilter, setPriorityFilter] = useState<'all' | ActivityPriority>('all')
  const [dueFilter, setDueFilter] = useState<'all' | 'late' | 'today' | 'week' | 'no-date'>('all')

  // Quick Add inline por coluna
  const [quickAddColumnId, setQuickAddColumnId] = useState<number | null>(null)
  const [quickAddText, setQuickAddText] = useState('')

  // Drag and Drop (Cards)
  const [draggedActivityId, setDraggedActivityId] = useState<number | null>(null)
  const [dragOverColumnId, setDragOverColumnId] = useState<number | null>(null)

  // Drag Canvas / Horizontal Pan-to-scroll
  const boardRef = useRef<HTMLDivElement>(null)
  const boardPanRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null)
  const suppressBoardClickRef = useRef(false)
  const cardClickRef = useRef<{ id: number; x: number; y: number } | null>(null)

  // Modals & Card Detail Sheet
  const [draft, setDraft] = useState<ActivityDraft | null>(null)
  const [isModalFullscreen, setIsModalFullscreen] = useState(false)
  const [sheetRightTab, setSheetRightTab] = useState<'activity' | 'files'>('activity')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [activityTagName, setActivityTagName] = useState('')

  // Details: Checklist, Comments, Attachments
  const [checklist, setChecklist] = useState<ActivityChecklistItem[]>([])
  const [newChecklistItemTitle, setNewChecklistItemTitle] = useState('')
  const [comments, setComments] = useState<ActivityComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [busyComment, setBusyComment] = useState(false)
  const [busyChecklist, setBusyChecklist] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Column management
  const [newColumnName, setNewColumnName] = useState('')

  // Autosave & notices
  const [saving, setSaving] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const draftSessionRef = useRef(0)
  const draftRef = useRef<ActivityDraft | null>(null)
  const savedDraftSnapshotRef = useRef<string | null>(null)
  const failedDraftSnapshotRef = useRef<string | null>(null)
  const closeRequestedSessionRef = useRef<number | null>(null)

  const isOwnBoard = ownerId === currentUserId

  const [dateFilterBounds] = useState(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = today.toISOString().slice(0, 10)
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)
    const nextWeekIso = nextWeek.toISOString().slice(0, 10)
    return { todayIso, nextWeekIso }
  })

  // Carregar Quadro
  const loadBoard = useCallback(async () => {
    try {
      const result = await apiRequest<{
        userId: number
        userName?: string
        columns: ActivityColumn[]
        tags: ActivityTag[]
        activities: PersonalActivity[]
      }>(`/api/personal-activities?userId=${ownerId}`)
      setColumns(result.columns)
      setTags(result.tags)
      setActivities(result.activities)
      setOwnerName(result.userName ?? currentUser.displayName)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível carregar o quadro pessoal.',
      })
    } finally {
      setLoadedOwnerId(ownerId)
    }
  }, [ownerId, currentUser.displayName])

  useLiveSync(['personal-activities'], loadBoard)

  useEffect(() => {
    let cancelled = false
    apiRequest<{
      userId: number
      userName?: string
      columns: ActivityColumn[]
      tags: ActivityTag[]
      activities: PersonalActivity[]
    }>(`/api/personal-activities?userId=${ownerId}`)
      .then((result) => {
        if (cancelled) return
        setColumns(result.columns)
        setTags(result.tags)
        setActivities(result.activities)
        setOwnerName(result.userName ?? currentUser.displayName)
        setLoadedOwnerId(ownerId)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Não foi possível carregar o quadro pessoal.',
        })
        setLoadedOwnerId(ownerId)
      })
    return () => {
      cancelled = true
    }
  }, [ownerId, currentUser.displayName])

  const loading = loadedOwnerId !== ownerId

  useEffect(() => {
    if (!canViewOtherActivities) return
    apiRequest<{ users: BoardUser[] }>('/api/personal-activities/users')
      .then((result) => setUsers(result.users))
      .catch((error: unknown) =>
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Não foi possível carregar a lista de usuários.',
        }),
      )
  }, [canViewOtherActivities])

  // Detecção de Coluna Concluída
  const isColumnCompleted = useCallback((colId: number) => {
    const col = columns.find((c) => c.id === colId)
    return Boolean(col && /conclu/i.test(col.name))
  }, [columns])

  const isActivityCompleted = useCallback(
    (activity: PersonalActivity) => isColumnCompleted(activity.columnId),
    [isColumnCompleted],
  )

  const getDueStatus = useCallback(
    (activity: PersonalActivity): 'late' | 'today' | 'soon' | 'later' | null => {
      if (!activity.dueDate || isActivityCompleted(activity)) return null
      if (activity.dueDate < dateFilterBounds.todayIso) return 'late'
      if (activity.dueDate === dateFilterBounds.todayIso) return 'today'
      if (activity.dueDate <= dateFilterBounds.nextWeekIso) return 'soon'
      return 'later'
    },
    [dateFilterBounds, isActivityCompleted],
  )

  // Filtros
  const filteredActivities = useMemo(() => {
    return activities.filter((activity) => {
      const search = activitySearch.trim().toLowerCase()
      if (search) {
        const text = `${activity.title} ${activity.description} ${(activity.tags ?? []).join(' ')}`.toLowerCase()
        if (!text.includes(search)) return false
      }
      if (priorityFilter !== 'all' && (activity.priority || 'medium') !== priorityFilter) {
        return false
      }
      if (tagFilter.length > 0) {
        const hasTag = tagFilter.some((t) =>
          activity.tags?.some((at) => normalizeTagName(at) === normalizeTagName(t)),
        )
        if (!hasTag) return false
      }
      if (dueFilter !== 'all') {
        const ds = getDueStatus(activity)
        if (dueFilter === 'late' && ds !== 'late') return false
        if (dueFilter === 'today' && ds !== 'today') return false
        if (dueFilter === 'week' && ds !== 'late' && ds !== 'today' && ds !== 'soon') return false
        if (dueFilter === 'no-date' && activity.dueDate) return false
      }
      return true
    })
  }, [activities, activitySearch, priorityFilter, tagFilter, dueFilter, getDueStatus])

  // Contadores para métricas
  const totalCount = activities.length
  const completedCount = activities.filter(isActivityCompleted).length
  const lateCount = activities.filter((a) => getDueStatus(a) === 'late').length
  const todayCount = activities.filter((a) => getDueStatus(a) === 'today').length
  const weekCount = activities.filter((a) => {
    const s = getDueStatus(a)
    return s === 'late' || s === 'today' || s === 'soon'
  }).length

  // Abrir Atividade no Card Sheet
  function openActivity(activity: PersonalActivity) {
    if (!activity) return
    const safeTags = Array.isArray(activity.tags)
      ? activity.tags.filter((t): t is string => typeof t === 'string')
      : []
    const nextDraft: ActivityDraft = {
      id: activity.id,
      columnId: activity.columnId,
      title: activity.title || '',
      description: activity.description || '',
      priority: activity.priority || 'medium',
      startDate: activity.startDate ?? '',
      dueDate: activity.dueDate ?? '',
      tags: safeTags,
    }
    draftSessionRef.current += 1
    closeRequestedSessionRef.current = null
    savedDraftSnapshotRef.current = getDraftSnapshot(nextDraft)
    failedDraftSnapshotRef.current = null
    setDraftDirty(false)
    setDraftSaveFailed(false)
    setDraft(nextDraft)
    setTagPickerOpen(false)
    setActivityTagName('')
    setComments([])
    setAttachments([])
    setChecklist([])
    setNewChecklistItemTitle('')
    setCommentBody('')
    setLoadingDetails(true)

    void Promise.all([
      apiRequest<{ comments: ActivityComment[] }>(`/api/personal-activities/items/${activity.id}/comments`),
      apiRequest<{ attachments: ActivityAttachment[] }>(`/api/personal-activities/items/${activity.id}/attachments`),
      apiRequest<{ items: ActivityChecklistItem[] }>(`/api/personal-activities/items/${activity.id}/checklist`),
    ])
      .then(([commentResult, attachmentResult, checklistResult]) => {
        setComments(Array.isArray(commentResult?.comments) ? commentResult.comments : [])
        setAttachments(Array.isArray(attachmentResult?.attachments) ? attachmentResult.attachments : [])
        setChecklist(Array.isArray(checklistResult?.items) ? checklistResult.items : [])
      })
      .catch(() => {
        // Silencioso em caso de falha de dados opcionais
      })
      .finally(() => {
        setLoadingDetails(false)
      })
  }

  function startNewActivity(columnId?: number) {
    const targetColId = columnId ?? columns[0]?.id ?? 1
    draftSessionRef.current += 1
    closeRequestedSessionRef.current = null
    savedDraftSnapshotRef.current = null
    failedDraftSnapshotRef.current = null
    setDraftDirty(false)
    setDraftSaveFailed(false)
    setChecklist([])
    setComments([])
    setAttachments([])
    setDraft(emptyDraft(targetColId))
  }

  function closeActivityEditor() {
    const currentDraft = draftRef.current
    if (currentDraft && isOwnBoard) {
      const snapshot = getDraftSnapshot(currentDraft)
      if (snapshot !== savedDraftSnapshotRef.current && (currentDraft.id !== null || currentDraft.title.trim())) {
        if (snapshot === failedDraftSnapshotRef.current) {
          if (!window.confirm('As alterações ainda não foram salvas. Deseja fechar e descartar?')) return
        } else {
          closeRequestedSessionRef.current = draftSessionRef.current
          return
        }
      }
    }
    draftSessionRef.current += 1
    closeRequestedSessionRef.current = null
    savedDraftSnapshotRef.current = null
    failedDraftSnapshotRef.current = null
    setDraft(null)
    setTagPickerOpen(false)
  }

  const closeActivityEditorRef = useRef(closeActivityEditor)
  const startNewActivityRef = useRef(startNewActivity)

  useEffect(() => {
    closeActivityEditorRef.current = closeActivityEditor
    startNewActivityRef.current = startNewActivity
  })

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  // Atalhos Globais: Esc, /, N, Setas
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
        if (event.key === 'Escape' && tagPickerOpen) {
          setTagPickerOpen(false)
        }
        return
      }
      if (event.key === 'Escape') {
        if (tagPickerOpen) setTagPickerOpen(false)
        else if (draft) closeActivityEditorRef.current()
        else if (quickAddColumnId !== null) setQuickAddColumnId(null)
      } else if (event.key === '/' && !draft) {
        event.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('.personal-search-input')
        searchInput?.focus()
      } else if (event.key.toLowerCase() === 'n' && !draft && isOwnBoard) {
        event.preventDefault()
        startNewActivityRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draft, tagPickerOpen, quickAddColumnId, isOwnBoard])

  // Autosave
  useEffect(() => {
    if (!draft || !isOwnBoard || saving) return
    const session = draftSessionRef.current
    const snapshot = getDraftSnapshot(draft)
    if (snapshot === savedDraftSnapshotRef.current) {
      setDraftDirty(false)
      setDraftSaveFailed(false)
      return
    }
    setDraftDirty(true)
    if (snapshot === failedDraftSnapshotRef.current) {
      setDraftSaveFailed(true)
      return
    }
    setDraftSaveFailed(false)
    if (draft.id === null && !draft.title.trim()) return

    const timer = window.setTimeout(() => {
      const currentDraft = draftRef.current
      if (!currentDraft || session !== draftSessionRef.current) return
      const payload = getActivityPayload(currentDraft)
      const currentSnapshot = JSON.stringify(payload)
      if (currentSnapshot === savedDraftSnapshotRef.current || currentSnapshot === failedDraftSnapshotRef.current) return

      setSaving(true)
      void (async () => {
        try {
          if (currentDraft.id === null) {
            const result = await apiRequest<{ activity: PersonalActivity }>('/api/personal-activities/items', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
            if (session !== draftSessionRef.current) return
            savedDraftSnapshotRef.current = currentSnapshot
            failedDraftSnapshotRef.current = null
            setDraftSaveFailed(false)
            setActivities((current) =>
              current.some((activity) => activity.id === result.activity.id)
                ? current
                : [...current, result.activity],
            )
            setDraft((current) => (current?.id === null ? { ...current, id: result.activity.id } : current))
          } else {
            await apiRequest(`/api/personal-activities/items/${currentDraft.id}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            })
            if (session !== draftSessionRef.current) return
            savedDraftSnapshotRef.current = currentSnapshot
            failedDraftSnapshotRef.current = null
            setDraftSaveFailed(false)
            setActivities((current) =>
              current.map((activity) =>
                activity.id === currentDraft.id ? { ...activity, ...payload } : activity,
              ),
            )
          }
          setNotice(null)
          const latestDraft = draftRef.current
          if (
            closeRequestedSessionRef.current === session &&
            latestDraft &&
            getDraftSnapshot(latestDraft) === savedDraftSnapshotRef.current
          ) {
            draftSessionRef.current += 1
            closeRequestedSessionRef.current = null
            savedDraftSnapshotRef.current = null
            failedDraftSnapshotRef.current = null
            setDraft(null)
            setTagPickerOpen(false)
          }
        } catch (error) {
          if (session !== draftSessionRef.current) return
          failedDraftSnapshotRef.current = currentSnapshot
          setDraftSaveFailed(true)
          setNotice({
            kind: 'error',
            text: error instanceof Error ? error.message : 'Não foi possível salvar as alterações da atividade.',
          })
        } finally {
          if (session === draftSessionRef.current) {
            setSaving(false)
            setDraftDirty(false)
          }
        }
      })()
    }, 450)

    return () => window.clearTimeout(timer)
  }, [draft, isOwnBoard, saving])

  // Mover atividade entre colunas
  async function moveActivity(activity: PersonalActivity, targetColumnId: number) {
    if (ownerId !== currentUserId || targetColumnId === activity.columnId) return
    const prevColId = activity.columnId
    setActivities((current) =>
      current.map((item) => (item.id === activity.id ? { ...item, columnId: targetColumnId } : item)),
    )
    if (draft && draft.id === activity.id) {
      setDraft((current) => (current ? { ...current, columnId: targetColumnId } : current))
    }
    try {
      await apiRequest(`/api/personal-activities/items/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ columnId: targetColumnId }),
      })
    } catch (error) {
      setActivities((current) =>
        current.map((item) => (item.id === activity.id ? { ...item, columnId: prevColId } : item)),
      )
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível mover a atividade.',
      })
    }
  }

  // Alternar Conclusão com 1 Clique (Botão Círculo ✓)
  async function toggleComplete(activity: PersonalActivity) {
    if (!isOwnBoard) return
    const doneCol = columns.find((c) => /conclu/i.test(c.name)) || columns[columns.length - 1]
    const initialCol = columns[0]
    if (!doneCol || !initialCol) return

    const isCurrentlyDone = isActivityCompleted(activity)
    const targetColId = isCurrentlyDone ? initialCol.id : doneCol.id
    await moveActivity(activity, targetColId)
  }

  // Quick Add com Atalhos (!alta #Obra @amanhã)
  async function handleQuickAdd(columnId: number) {
    const raw = quickAddText.trim()
    if (!raw || !isOwnBoard) return

    let title = raw
    let priority: ActivityPriority = 'medium'
    const newTags: string[] = []
    let dueDate: string | null = null

    // Atalho !prioridade
    title = title.replace(/!(urgente|alta|media|média|baixa)/i, (_, p) => {
      const lower = p.toLowerCase()
      if (lower === 'urgente') priority = 'urgent'
      else if (lower === 'alta') priority = 'high'
      else if (lower === 'media' || lower === 'média') priority = 'medium'
      else if (lower === 'baixa') priority = 'low'
      return ''
    })

    // Atalho #etiqueta
    title = title.replace(/#(\S+)/g, (_, t) => {
      const found = tags.find((x) => x.name.toLowerCase() === t.toLowerCase())
      if (found) newTags.push(found.name)
      else newTags.push(t)
      return ''
    })

    // Atalho @prazo
    title = title.replace(/@(hoje|amanh[ãa]|semana)/i, (_, d) => {
      const lower = d.toLowerCase()
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (lower === 'hoje') {
        dueDate = today.toISOString().slice(0, 10)
      } else if (lower.startsWith('amanh')) {
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        dueDate = tomorrow.toISOString().slice(0, 10)
      } else if (lower === 'semana') {
        const nextWeek = new Date(today)
        nextWeek.setDate(nextWeek.getDate() + 7)
        dueDate = nextWeek.toISOString().slice(0, 10)
      }
      return ''
    })

    title = title.replace(/\s+/g, ' ').trim()
    if (!title) return

    try {
      const result = await apiRequest<{ activity: PersonalActivity }>('/api/personal-activities/items', {
        method: 'POST',
        body: JSON.stringify({
          columnId,
          title,
          priority,
          dueDate,
          tags: newTags,
          description: '',
        }),
      })
      setActivities((current) => [...current, result.activity])
      setQuickAddText('')
      setQuickAddColumnId(null)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível criar a tarefa rápida.',
      })
    }
  }

  // Panning Horizontal nas Áreas Vazias (Arrastar para os lados)
  function startBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const target = event.target as HTMLElement
    // Não iniciar pan se clicar em cards, listas ou controles interativos
    if (
      target.closest(
        '.personal-card, .list-item-row, .week-mini-card, button, input, select, textarea, a, .personal-tag-menu, .personal-quick-box',
      )
    ) {
      return
    }
    boardPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    }
  }

  function moveBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = boardPanRef.current
    if (!pan || pan.pointerId !== event.pointerId || !(event.buttons & 1)) return
    const delta = event.clientX - pan.startX
    if (Math.abs(delta) > 5) {
      if (!pan.moved) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      pan.moved = true
      event.currentTarget.classList.add('is-panning')
    }
    if (pan.moved) {
      event.currentTarget.scrollLeft = pan.scrollLeft - delta
    }
  }

  function endBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = boardPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    if (pan.moved) {
      suppressBoardClickRef.current = true
      window.setTimeout(() => {
        suppressBoardClickRef.current = false
      }, 80)
    }
    boardPanRef.current = null
    event.currentTarget.classList.remove('is-panning')
  }

  function scrollBoard(offset: number) {
    if (boardRef.current) {
      boardRef.current.scrollBy({ left: offset, behavior: 'smooth' })
    }
  }

  // Checklist Helpers
  async function toggleChecklistItem(item: ActivityChecklistItem) {
    if (!draft?.id || !isOwnBoard) return
    const nextDone = !item.isDone
    setChecklist((current) => current.map((i) => (i.id === item.id ? { ...i, isDone: nextDone } : i)))
    setActivities((current) =>
      current.map((a) =>
        a.id === draft.id
          ? { ...a, checklistDone: Math.max(0, (a.checklistDone ?? 0) + (nextDone ? 1 : -1)) }
          : a,
      ),
    )
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: nextDone }),
      })
    } catch {
      setChecklist((current) => current.map((i) => (i.id === item.id ? { ...i, isDone: !nextDone } : i)))
    }
  }

  async function addChecklistItem(e: FormEvent) {
    e.preventDefault()
    if (!draft?.id || !isOwnBoard || !newChecklistItemTitle.trim()) return
    setBusyChecklist(true)
    try {
      const result = await apiRequest<{ item: ActivityChecklistItem }>(
        `/api/personal-activities/items/${draft.id}/checklist`,
        {
          method: 'POST',
          body: JSON.stringify({ title: newChecklistItemTitle.trim() }),
        },
      )
      setChecklist((current) => [...current, result.item])
      setNewChecklistItemTitle('')
      setActivities((current) =>
        current.map((a) => (a.id === draft.id ? { ...a, checklistTotal: (a.checklistTotal ?? 0) + 1 } : a)),
      )
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Erro ao adicionar item.' })
    } finally {
      setBusyChecklist(false)
    }
  }

  async function deleteChecklistItem(item: ActivityChecklistItem) {
    if (!draft?.id || !isOwnBoard) return
    setChecklist((current) => current.filter((i) => i.id !== item.id))
    setActivities((current) =>
      current.map((a) =>
        a.id === draft.id
          ? {
              ...a,
              checklistTotal: Math.max(0, (a.checklistTotal ?? 1) - 1),
              checklistDone: item.isDone ? Math.max(0, (a.checklistDone ?? 1) - 1) : a.checklistDone,
            }
          : a,
      ),
    )
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/checklist/${item.id}`, {
        method: 'DELETE',
      })
    } catch {
      void loadBoard()
    }
  }

  // Comments Helpers
  async function postComment(e: FormEvent) {
    e.preventDefault()
    if (!draft?.id || !isOwnBoard || !commentBody.trim()) return
    setBusyComment(true)
    try {
      const result = await apiRequest<{ comment: ActivityComment }>(
        `/api/personal-activities/items/${draft.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: commentBody.trim() }),
        },
      )
      setComments((current) => [...current, result.comment])
      setCommentBody('')
      setActivities((current) =>
        current.map((a) => (a.id === draft.id ? { ...a, commentsCount: (a.commentsCount ?? 0) + 1 } : a)),
      )
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Erro ao comentar.' })
    } finally {
      setBusyComment(false)
    }
  }

  async function deleteComment(comment: ActivityComment) {
    if (!draft?.id || !isOwnBoard || !window.confirm('Excluir este comentário?')) return
    setComments((current) => current.filter((c) => c.id !== comment.id))
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/comments/${comment.id}`, { method: 'DELETE' })
      setActivities((current) =>
        current.map((a) => (a.id === draft.id ? { ...a, commentsCount: Math.max(0, (a.commentsCount ?? 1) - 1) } : a)),
      )
    } catch {
      void loadBoard()
    }
  }

  // Attachments Helpers
  async function uploadAttachment(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.currentTarget.value = ''
    if (!draft?.id || !isOwnBoard || !file) return
    if (file.size > 5 * 1024 * 1024) {
      setNotice({ kind: 'error', text: 'O arquivo não pode ultrapassar 5 MiB.' })
      return
    }
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject())
        reader.onerror = () => reject()
        reader.readAsDataURL(file)
      })
      await apiRequest(`/api/personal-activities/items/${draft.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBase64: dataUrl.split(',')[1],
        }),
      })
      const result = await apiRequest<{ attachments: ActivityAttachment[] }>(
        `/api/personal-activities/items/${draft.id}/attachments`,
      )
      setAttachments(result.attachments)
      setActivities((current) =>
        current.map((a) => (a.id === draft.id ? { ...a, attachmentsCount: result.attachments.length } : a)),
      )
    } catch {
      setNotice({ kind: 'error', text: 'Erro ao enviar anexo.' })
    } finally {
      setUploading(false)
    }
  }

  async function downloadAttachment(att: ActivityAttachment) {
    if (!draft?.id) return
    try {
      const res = await fetch(`/api/personal-activities/items/${draft.id}/attachments/${att.id}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Falha ao baixar anexo.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = att.fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao baixar anexo.' })
    }
  }

  async function deleteAttachment(att: ActivityAttachment) {
    if (!draft?.id || !isOwnBoard || !window.confirm(`Excluir o anexo "${att.fileName}"?`)) return
    setAttachments((current) => current.filter((a) => a.id !== att.id))
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/attachments/${att.id}`, { method: 'DELETE' })
      setActivities((current) =>
        current.map((a) => (a.id === draft.id ? { ...a, attachmentsCount: Math.max(0, (a.attachmentsCount ?? 1) - 1) } : a)),
      )
    } catch {
      void loadBoard()
    }
  }

  // Tags Helpers
  async function createTag(name: string) {
    const clean = name.trim()
    if (!clean || !isOwnBoard) return
    try {
      const result = await apiRequest<{ tag: ActivityTag }>('/api/personal-activities/tags', {
        method: 'POST',
        body: JSON.stringify({ name: clean }),
      })
      setTags((current) => [...current, result.tag].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      setActivityTagName('')
      if (draft && !draft.tags.some((t) => normalizeTagName(t) === normalizeTagName(clean))) {
        setDraft({ ...draft, tags: [...draft.tags, clean].slice(0, 20) })
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao criar tag.' })
    }
  }

  // Colunas Helpers
  async function createColumn(e: FormEvent) {
    e.preventDefault()
    if (!newColumnName.trim() || !isOwnBoard) return
    try {
      const res = await apiRequest<{ column: ActivityColumn }>('/api/personal-activities/columns', {
        method: 'POST',
        body: JSON.stringify({ name: newColumnName.trim() }),
      })
      setColumns((current) => [...current, res.column])
      setNewColumnName('')
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao criar coluna.' })
    }
  }

  async function renameColumn(col: ActivityColumn) {
    if (!isOwnBoard) return
    const name = window.prompt('Novo nome da coluna:', col.name)?.trim()
    if (!name || name === col.name) return
    try {
      await apiRequest(`/api/personal-activities/columns/${col.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setColumns((current) => current.map((c) => (c.id === col.id ? { ...c, name } : c)))
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao renomear coluna.' })
    }
  }

  async function deleteColumn(col: ActivityColumn) {
    if (!isOwnBoard || !window.confirm(`Excluir a coluna "${col.name}" e todas as tarefas nela?`)) return
    try {
      await apiRequest(`/api/personal-activities/columns/${col.id}`, { method: 'DELETE' })
      setColumns((current) => current.filter((c) => c.id !== col.id))
      setActivities((current) => current.filter((a) => a.columnId !== col.id))
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao excluir coluna.' })
    }
  }

  // Navegação entre cartões no modal
  const currentCardIndex = draft?.id ? filteredActivities.findIndex((a) => a.id === draft.id) : -1
  const prevActivity = currentCardIndex > 0 ? filteredActivities[currentCardIndex - 1] : null
  const nextActivity =
    currentCardIndex >= 0 && currentCardIndex < filteredActivities.length - 1
      ? filteredActivities[currentCardIndex + 1]
      : null

  // Checklist counts in modal
  const modalChecklistTotal = checklist.length
  const modalChecklistDone = checklist.filter((i) => i.isDone).length
  const modalChecklistPct = modalChecklistTotal > 0 ? Math.round((modalChecklistDone / modalChecklistTotal) * 100) : 0

  // 7 dias para visualização "Minha Semana"
  const [weekDays] = useState(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days: { iso: string; label: string; isToday: boolean }[] = []
    const weekNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      const iso = d.toISOString().slice(0, 10)
      days.push({
        iso,
        label: `${weekNames[d.getDay()]} ${formatDateDisplay(iso)}`,
        isToday: i === 0,
      })
    }
    return days
  })

  return (
    <main className="personal-page">
      {/* 1. CABEÇALHO DA PLATAFORMA */}
      <header className="personal-header">
        <div className="personal-header-copy">
          <div className="personal-header-tagline">
            <span className="eyebrow">
              <CheckSquare size={13} /> ORGANIZAÇÃO & ROTINAS
            </span>
          </div>
          <div className="personal-title-row">
            <div className="personal-avatar-badge" title={ownerName}>
              {ownerName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'DS'}
            </div>
            <div>
              <h1>{isOwnBoard ? 'Minhas Atividades' : `Quadro de ${ownerName}`}</h1>
              <p className="personal-header-stats">
                <strong>{totalCount - completedCount}</strong> em aberto · <strong>{completedCount}</strong> concluídas
                {totalCount > 0 && ` · ${Math.round((completedCount / totalCount) * 100)}% concluído`}
              </p>
            </div>
          </div>
        </div>

        <div className="personal-header-actions">
          {canViewOtherActivities && (
            <label className="personal-user-selector">
              <span>Quadro de:</span>
              <select value={ownerId} onChange={(e) => setOwnerId(Number(e.target.value))}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === currentUserId ? 'Meu quadro' : u.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Seletor de visualização (Quadro / Lista / Minha Semana) */}
          <div className="personal-view-pills" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              className={`view-pill-btn ${viewMode === 'kanban' ? 'is-active' : ''}`}
              onClick={() => setViewMode('kanban')}
            >
              <LayoutGrid size={15} />
              <span>Quadro</span>
            </button>
            <button
              type="button"
              className={`view-pill-btn ${viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <List size={15} />
              <span>Lista</span>
            </button>
            <button
              type="button"
              className={`view-pill-btn ${viewMode === 'week' ? 'is-active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              <CalendarDays size={15} />
              <span>Minha Semana</span>
            </button>
          </div>

          <div className="personal-search-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="search"
              className="personal-search-input"
              value={activitySearch}
              onChange={(e) => setActivitySearch(e.target.value)}
              placeholder="Buscar tarefas..."
              aria-label="Buscar tarefas"
            />
            <kbd className="personal-search-kbd">/</kbd>
          </div>

          {isOwnBoard && (
            <button type="button" className="primary-button" onClick={() => startNewActivity()}>
              <Plus size={15} /> Nova tarefa <kbd className="btn-kbd">N</kbd>
            </button>
          )}
        </div>
      </header>

      {/* Aviso de leitura para quadros alheios */}
      {!isOwnBoard && (
        <div className="personal-readonly-banner">
          <ListTodo size={15} />
          <span>Visualizando o quadro de <strong>{ownerName}</strong> em modo de consulta (somente leitura).</span>
        </div>
      )}

      {/* Feedback de avisos */}
      {notice && (
        <div className={`notice notice-${notice.kind}`} role="alert">
          <CircleAlert size={16} />
          <span>{notice.text}</span>
          <button type="button" className="notice-close" onClick={() => setNotice(null)} aria-label="Fechar">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 2. BARRA DE INSIGHTS & FILTROS RÁPIDOS */}
      <div className="personal-filter-toolbar">
        <div className="personal-insight-chips">
          <button
            type="button"
            className={`insight-chip is-late ${dueFilter === 'late' ? 'is-active' : ''}`}
            onClick={() => setDueFilter(dueFilter === 'late' ? 'all' : 'late')}
          >
            <span className="insight-chip-dot" />
            <span>Atrasadas</span>
            <strong className="insight-chip-count">{lateCount}</strong>
          </button>

          <button
            type="button"
            className={`insight-chip is-today ${dueFilter === 'today' ? 'is-active' : ''}`}
            onClick={() => setDueFilter(dueFilter === 'today' ? 'all' : 'today')}
          >
            <span className="insight-chip-dot" />
            <span>Hoje</span>
            <strong className="insight-chip-count">{todayCount}</strong>
          </button>

          <button
            type="button"
            className={`insight-chip is-week ${dueFilter === 'week' ? 'is-active' : ''}`}
            onClick={() => setDueFilter(dueFilter === 'week' ? 'all' : 'week')}
          >
            <span className="insight-chip-dot" />
            <span>Próx. 7 dias</span>
            <strong className="insight-chip-count">{weekCount}</strong>
          </button>
        </div>

        <div className="filter-divider" />

        {/* Chips de Prioridade */}
        <div className="personal-tag-chips">
          {(['urgent', 'high', 'medium', 'low'] as const).map((pKey) => {
            const pCfg = PRIORITY_CONFIG[pKey]
            const isSelected = priorityFilter === pKey
            return (
              <button
                key={pKey}
                type="button"
                className={`priority-filter-chip ${isSelected ? 'is-active' : ''}`}
                style={{
                  borderColor: isSelected ? pCfg.color : '#e2e8f0',
                  background: isSelected ? pCfg.color : '#fff',
                  color: isSelected ? '#fff' : pCfg.color,
                }}
                onClick={() => setPriorityFilter(priorityFilter === pKey ? 'all' : pKey)}
              >
                <span>{pCfg.icon}</span>
                <span>{pCfg.label}</span>
              </button>
            )
          })}

          {/* Chips de Tags */}
          {tags.map((tag) => {
            const tagColor = getTagColor(tag.name)
            const isSelected = tagFilter.includes(tag.name)
            return (
              <button
                key={tag.id}
                type="button"
                className={`tag-filter-chip ${isSelected ? 'is-active' : ''}`}
                style={{
                  borderColor: isSelected ? tagColor : '#e2e8f0',
                  background: isSelected ? tagColor : '#fff',
                  color: isSelected ? '#fff' : tagColor,
                }}
                onClick={() => {
                  setTagFilter((current) =>
                    isSelected ? current.filter((t) => t !== tag.name) : [...current, tag.name],
                  )
                }}
              >
                <span>#</span>
                <span>{tag.name}</span>
              </button>
            )
          })}

          {(priorityFilter !== 'all' || tagFilter.length > 0 || dueFilter !== 'all' || activitySearch.trim()) && (
            <button
              type="button"
              className="clear-filters-btn"
              onClick={() => {
                setPriorityFilter('all')
                setTagFilter([])
                setDueFilter('all')
                setActivitySearch('')
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* 3. CONTEÚDO PRINCIPAL (QUADRO / LISTA / MINHA SEMANA) */}
      {loading ? (
        <ATechLoading
          message="Carregando atividades..."
          subtitle={`Sincronizando tarefas de ${ownerName}...`}
        />
      ) : viewMode === 'kanban' ? (
        /* VISÃO QUADRO (KANBAN) */
        <div className="personal-board-wrapper">
          {/* Barra de controle e dica de deslizar para os lados */}
          <div className="personal-board-nav-bar">
            <span className="personal-board-hint">
              <MoveHorizontal size={13} /> Clique e arraste nas áreas vazias para rolar o quadro para os lados
            </span>
            <div className="personal-board-scroll-btns">
              <button
                type="button"
                className="secondary-button scroll-btn"
                title="Rolar para esquerda"
                onClick={() => scrollBoard(-320)}
                aria-label="Rolar para esquerda"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="secondary-button scroll-btn"
                title="Rolar para direita"
                onClick={() => scrollBoard(320)}
                aria-label="Rolar para direita"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div
            className="personal-board"
            ref={boardRef}
            onPointerDown={startBoardPan}
            onPointerMove={moveBoardPan}
            onPointerUp={endBoardPan}
            onPointerCancel={endBoardPan}
            onClickCapture={(e) => {
              if (!suppressBoardClickRef.current) return
              const target = e.target as HTMLElement
              if (target.closest('.personal-card, .list-item-row, .week-mini-card')) {
                suppressBoardClickRef.current = false
                return
              }
              e.preventDefault()
              e.stopPropagation()
              suppressBoardClickRef.current = false
            }}
          >
            {columns.map((column) => {
              const colActivities = filteredActivities.filter((a) => a.columnId === column.id)
              const isDoneCol = /conclu/i.test(column.name)
              const isAddingHere = quickAddColumnId === column.id

              return (
                <section
                  key={column.id}
                  className={`personal-col ${dragOverColumnId === column.id ? 'is-drag-over' : ''}`}
                  onDragOver={(e) => {
                    if (!isOwnBoard || !draggedActivityId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverColumnId !== column.id) setDragOverColumnId(column.id)
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return
                    if (dragOverColumnId === column.id) setDragOverColumnId(null)
                  }}
                  onDrop={(e) => {
                    if (!isOwnBoard) return
                    e.preventDefault()
                    const rawId = e.dataTransfer.getData('text/plain') || String(draggedActivityId || '')
                    const cardId = Number(rawId)
                    setDragOverColumnId(null)
                    setDraggedActivityId(null)
                    if (!cardId) return
                    const found = activities.find((a) => a.id === cardId)
                    if (found && found.columnId !== column.id) {
                      void moveActivity(found, column.id)
                    }
                  }}
                >
                  {/* Cabeçalho da Coluna */}
                  <header className="personal-col-header">
                    <span className="col-indicator-dot" style={{ backgroundColor: isDoneCol ? '#10b981' : '#0f3b99' }} />
                    <h2 className="col-title">{column.name}</h2>
                    <span className="col-count-badge">{colActivities.length}</span>
                    {isDoneCol && <span className="col-done-tag">Final</span>}

                    {isOwnBoard && (
                      <div className="col-actions">
                        <button
                          type="button"
                          className="col-header-btn"
                          title="Adicionar tarefa nesta coluna"
                          onClick={() => {
                            setQuickAddColumnId(column.id)
                            setQuickAddText('')
                          }}
                        >
                          <Plus size={15} />
                        </button>
                        <button
                          type="button"
                          className="col-header-btn"
                          title="Opções da coluna"
                          onClick={() => renameColumn(column)}
                        >
                          <Pencil size={12} />
                        </button>
                        {columns.length > 1 && (
                          <button
                            type="button"
                            className="col-header-btn is-delete"
                            title="Excluir coluna"
                            onClick={() => deleteColumn(column)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </header>

                  {/* Caixa de Criação Rápida Inline com Atalhos */}
                  {isAddingHere && (
                    <div className="personal-quick-box">
                      <textarea
                        autoFocus
                        rows={2}
                        value={quickAddText}
                        onChange={(e) => setQuickAddText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void handleQuickAdd(column.id)
                          } else if (e.key === 'Escape') {
                            setQuickAddColumnId(null)
                          }
                        }}
                        placeholder="Nome da tarefa... Dica: use !alta, #Obra, @amanhã"
                        className="quick-textarea"
                      />
                      <div className="quick-box-footer">
                        <span className="quick-hint">
                          <kbd>Enter</kbd> salvar · <kbd>Esc</kbd> cancelar
                        </span>
                        <div className="quick-btns">
                          <button
                            type="button"
                            className="secondary-button btn-xs"
                            onClick={() => setQuickAddColumnId(null)}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="primary-button btn-xs"
                            disabled={!quickAddText.trim()}
                            onClick={() => void handleQuickAdd(column.id)}
                          >
                            Adicionar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lista de Cartões da Coluna */}
                  <div className="personal-col-cards">
                    {colActivities.map((activity) => {
                      const pCfg = PRIORITY_CONFIG[activity.priority || 'medium']
                      const dueStatus = getDueStatus(activity)
                      const isCompleted = isActivityCompleted(activity)
                      const ckTotal = activity.checklistTotal ?? 0
                      const ckDone = activity.checklistDone ?? 0

                      return (
                        <article
                          key={activity.id}
                          className={`personal-card ${isCompleted ? 'is-completed' : ''} ${
                            draggedActivityId === activity.id ? 'is-dragging' : ''
                          }`}
                          style={{ borderLeft: `3px solid ${pCfg.color}` }}
                          draggable={isOwnBoard}
                          onDragStart={(e) => {
                            if (!isOwnBoard) return
                            setDraggedActivityId(activity.id)
                            e.dataTransfer.setData('text/plain', String(activity.id))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragEnd={() => {
                            setDraggedActivityId(null)
                            setDragOverColumnId(null)
                          }}
                          onMouseDown={(e) => {
                            if ((e.target as HTMLElement).closest('button, input, select, textarea, a, .card-check-circle')) return
                            cardClickRef.current = { id: activity.id, x: e.clientX, y: e.clientY }
                          }}
                          onMouseUp={(e) => {
                            const start = cardClickRef.current
                            cardClickRef.current = null
                            if (!start || start.id !== activity.id) return
                            const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
                            if (dist < 8 && !(e.target as HTMLElement).closest('button, input, select, textarea, a, .card-check-circle')) {
                              openActivity(activity)
                            }
                          }}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, input, select, textarea, a, .card-check-circle')) return
                            openActivity(activity)
                          }}
                        >
                          {/* Tags em barras horizontais (estilo kanban_prototipo.html) */}
                          {activity.tags && activity.tags.length > 0 && (
                            <div className="card-tags-row">
                              {activity.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="card-tag-bar"
                                  title={tag}
                                  style={{
                                    backgroundColor: getTagColor(tag),
                                  }}
                                />
                              ))}
                            </div>
                          )}

                          {/* Título & Círculo de Conclusão */}
                          <div className="card-main-row">
                            <button
                              type="button"
                              className={`card-check-circle ${isCompleted ? 'is-checked' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void toggleComplete(activity)
                              }}
                              title={isCompleted ? 'Reabrir tarefa' : 'Concluir tarefa'}
                              aria-label={isCompleted ? 'Reabrir tarefa' : 'Concluir tarefa'}
                            >
                              {isCompleted && <Check size={11} strokeWidth={3} />}
                            </button>
                            <h3 className={`card-title ${isCompleted ? 'is-line-through' : ''}`}>
                              {activity.title}
                            </h3>
                          </div>

                          {/* Rodapé com badges compactos */}
                          <div className="card-footer-badges">
                            {activity.dueDate && (
                              <span
                                className={`card-badge-due ${
                                  dueStatus === 'late'
                                    ? 'is-late'
                                    : dueStatus === 'today'
                                    ? 'is-today'
                                    : isCompleted
                                    ? 'is-done'
                                    : ''
                                }`}
                              >
                                <Calendar size={11} />
                                {isCompleted ? `✓ ${formatDateDisplay(activity.dueDate)}` : (
                                  dueStatus === 'late' ? `Atrasada · ${formatDateDisplay(activity.dueDate)}` :
                                  dueStatus === 'today' ? `Hoje · ${formatDateDisplay(activity.dueDate)}` :
                                  formatDateDisplay(activity.dueDate)
                                )}
                              </span>
                            )}

                            {ckTotal > 0 && (
                              <span
                                className={`card-badge-checklist ${ckDone === ckTotal ? 'is-all-done' : ''}`}
                                title={`Checklist: ${ckDone} de ${ckTotal} concluídos`}
                              >
                                <CheckSquare size={11} />
                                {ckDone}/{ckTotal}
                              </span>
                            )}

                            {(activity.commentsCount ?? 0) > 0 && (
                              <span className="card-badge-counter" title={`${activity.commentsCount} comentários`}>
                                <MessageCircle size={11} />
                                {activity.commentsCount}
                              </span>
                            )}

                            {(activity.attachmentsCount ?? 0) > 0 && (
                              <span className="card-badge-counter" title={`${activity.attachmentsCount} anexos`}>
                                <Paperclip size={11} />
                                {activity.attachmentsCount}
                              </span>
                            )}

                            <span
                              className="card-priority-flag"
                              style={{ color: pCfg.color }}
                              title={`Prioridade ${pCfg.label}`}
                            >
                              {pCfg.icon}
                            </span>
                          </div>
                        </article>
                      )
                    })}

                    {colActivities.length === 0 && (
                      <div className="col-empty-zone">
                        <span>Nenhuma tarefa aqui</span>
                      </div>
                    )}
                  </div>

                  {/* Botão de Adicionar no pé da coluna */}
                  {isOwnBoard && (
                    <button
                      type="button"
                      className="col-add-bottom-btn"
                      onClick={() => {
                        setQuickAddColumnId(column.id)
                        setQuickAddText('')
                      }}
                    >
                      <Plus size={14} /> Adicionar tarefa
                    </button>
                  )}
                </section>
              )
            })}

            {isOwnBoard && (
              <form className="personal-new-col-form" onSubmit={(e) => void createColumn(e)}>
                <input
                  type="text"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="+ Nova coluna..."
                  maxLength={60}
                />
                <button type="submit" disabled={!newColumnName.trim()}>
                  <Plus size={14} />
                </button>
              </form>
            )}
          </div>
        </div>
      ) : viewMode === 'list' ? (
        /* VISÃO EM LISTA (LIST VIEW) */
        <div className="personal-list-view">
          {columns.map((column) => {
            const list = filteredActivities.filter((a) => a.columnId === column.id)
            const isDoneCol = /conclu/i.test(column.name)
            return (
              <section key={column.id} className="list-group-card">
                <header className="list-group-header">
                  <span className="col-indicator-dot" style={{ backgroundColor: isDoneCol ? '#10b981' : '#0f3b99' }} />
                  <h3>{column.name}</h3>
                  <span className="list-group-count">{list.length}</span>
                </header>

                <div className="list-items-table">
                  {list.map((activity) => {
                    const pCfg = PRIORITY_CONFIG[activity.priority || 'medium']
                    const dueStatus = getDueStatus(activity)
                    const isCompleted = isActivityCompleted(activity)

                    return (
                      <div
                        key={activity.id}
                        className={`list-item-row ${isCompleted ? 'is-completed' : ''}`}
                        onClick={() => void openActivity(activity)}
                      >
                        <button
                          type="button"
                          className={`card-check-circle ${isCompleted ? 'is-checked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void toggleComplete(activity)
                          }}
                        >
                          {isCompleted && <Check size={11} />}
                        </button>
                        <span className={`list-item-title ${isCompleted ? 'is-line-through' : ''}`}>
                          {activity.title}
                        </span>

                        <div className="list-item-tags">
                          {activity.tags?.map((t) => (
                            <span
                              key={t}
                              className="card-tag-pill"
                              style={{ backgroundColor: `${getTagColor(t)}15`, color: getTagColor(t) }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>

                        <span className="list-item-prio" style={{ color: pCfg.color }}>
                          {pCfg.icon} {pCfg.label}
                        </span>

                        <span
                          className={`list-item-date ${
                            dueStatus === 'late' ? 'is-late' : dueStatus === 'today' ? 'is-today' : ''
                          }`}
                        >
                          {activity.dueDate ? formatDateDisplay(activity.dueDate) : '—'}
                        </span>
                      </div>
                    )
                  })}
                  {list.length === 0 && <p className="list-empty-msg">Nenhuma tarefa nesta etapa.</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        /* VISÃO MINHA SEMANA (AGENDA 7 DIAS) */
        <div className="personal-week-view">
          <div className="week-grid">
            {/* Coluna Atrasadas */}
            <div className="week-col is-late-col">
              <header className="week-col-header">
                <AlertTriangle size={13} />
                <span>Atrasadas</span>
                <span className="week-col-count">{lateCount}</span>
              </header>
              <div className="week-col-cards">
                {activities
                  .filter((a) => getDueStatus(a) === 'late')
                  .map((activity) => (
                    <div
                      key={activity.id}
                      className="week-mini-card"
                      style={{ borderLeftColor: PRIORITY_CONFIG[activity.priority || 'medium'].color }}
                      onClick={() => void openActivity(activity)}
                    >
                      <strong>{activity.title}</strong>
                      <small>Prazo: {formatDateDisplay(activity.dueDate)}</small>
                    </div>
                  ))}
                {lateCount === 0 && <span className="week-col-empty">Nenhum atraso</span>}
              </div>
            </div>

            {/* Coluna Sem Prazo */}
            <div className="week-col is-nodate-col">
              <header className="week-col-header">
                <CalendarDays size={13} />
                <span>Sem prazo</span>
                <span className="week-col-count">
                  {activities.filter((a) => !a.dueDate && !isActivityCompleted(a)).length}
                </span>
              </header>
              <div className="week-col-cards">
                {activities
                  .filter((a) => !a.dueDate && !isActivityCompleted(a))
                  .map((activity) => (
                    <div
                      key={activity.id}
                      className="week-mini-card"
                      style={{ borderLeftColor: PRIORITY_CONFIG[activity.priority || 'medium'].color }}
                      onClick={() => void openActivity(activity)}
                    >
                      <strong>{activity.title}</strong>
                    </div>
                  ))}
              </div>
            </div>

            {/* 7 Dias da Semana */}
            {weekDays.map((day) => {
              const dayTasks = activities.filter((a) => a.dueDate === day.iso && !isActivityCompleted(a))
              return (
                <div key={day.iso} className={`week-col ${day.isToday ? 'is-today-col' : ''}`}>
                  <header className="week-col-header">
                    <span>{day.label}</span>
                    <span className="week-col-count">{dayTasks.length}</span>
                  </header>
                  <div className="week-col-cards">
                    {dayTasks.map((activity) => (
                      <div
                        key={activity.id}
                        className="week-mini-card"
                        style={{ borderLeftColor: PRIORITY_CONFIG[activity.priority || 'medium'].color }}
                        onClick={() => void openActivity(activity)}
                      >
                        <strong>{activity.title}</strong>
                        {activity.tags && activity.tags.length > 0 && (
                          <small>{activity.tags.join(', ')}</small>
                        )}
                      </div>
                    ))}
                    {dayTasks.length === 0 && <span className="week-col-empty">Livre</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. MODAL / CARD SHEET (ESTILO TRELLO & CLICKUP EM 2 COLUNAS) */}
      {draft &&
        createPortal(
          <div
            className={`personal-sheet-backdrop ${isModalFullscreen ? 'is-fullscreen' : ''}`}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeActivityEditor()
            }}
          >
            <section
              className="personal-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={draft.title || 'Detalhes da atividade'}
            >
            {/* Topo do Sheet */}
            <header className="sheet-header">
              <div className="sheet-breadcrumbs">
                <span className="sheet-crumb-board">Quadro de {ownerName}</span>
                <span className="sheet-crumb-sep">/</span>
                <span className="sheet-crumb-col">
                  {columns.find((c) => c.id === draft.columnId)?.name || 'Coluna'}
                </span>
                <span className="sheet-autosave-tag">
                  {saving
                    ? 'Salvando...'
                    : draft.id === null && !draft.title.trim()
                    ? 'Digite o título para salvar'
                    : draftSaveFailed
                    ? 'Erro ao salvar'
                    : draftDirty
                    ? 'Salvando alterações...'
                    : '✓ Salvo automaticamente'}
                </span>
              </div>

              <div className="sheet-header-actions">
                {/* Navegação entre tarefas */}
                {draft.id !== null && filteredActivities.length > 1 && (
                  <div className="sheet-card-switcher">
                    <button
                      type="button"
                      className="sheet-icon-btn"
                      disabled={!prevActivity}
                      onClick={() => prevActivity && void openActivity(prevActivity)}
                      title={prevActivity ? `Anterior: ${prevActivity.title}` : 'Início'}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="switcher-counter">
                      {currentCardIndex + 1} de {filteredActivities.length}
                    </span>
                    <button
                      type="button"
                      className="sheet-icon-btn"
                      disabled={!nextActivity}
                      onClick={() => nextActivity && void openActivity(nextActivity)}
                      title={nextActivity ? `Próxima: ${nextActivity.title}` : 'Fim'}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}

                {/* Botão de Concluir / Reabrir */}
                {draft.id !== null && (
                  <button
                    type="button"
                    className={`secondary-button btn-complete-sheet ${
                      isColumnCompleted(draft.columnId) ? 'is-completed' : ''
                    }`}
                    onClick={() => {
                      const act = activities.find((a) => a.id === draft.id)
                      if (act) void toggleComplete(act)
                    }}
                  >
                    {isColumnCompleted(draft.columnId) ? (
                      <>
                        <RotateCcw size={13} /> Reabrir tarefa
                      </>
                    ) : (
                      <>
                        <Check size={14} /> Concluir tarefa
                      </>
                    )}
                  </button>
                )}

                {/* Alternar tela cheia */}
                <button
                  type="button"
                  className="sheet-icon-btn"
                  onClick={() => setIsModalFullscreen((f) => !f)}
                  title={isModalFullscreen ? 'Restaurar tamanho' : 'Expandir para tela cheia'}
                >
                  {isModalFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>

                {/* Fechar */}
                <button
                  type="button"
                  className="sheet-icon-btn is-close"
                  onClick={closeActivityEditor}
                  title="Fechar (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* Corpo Dividido em Duas Colunas (Notion / ClickUp) */}
            <div className="sheet-split-body">
              {/* Lado Esquerdo (65%): Conteúdo Principal */}
              <div className="sheet-main-column">
                <input
                  type="text"
                  className="sheet-title-input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Nome da atividade ou tarefa..."
                  disabled={!isOwnBoard}
                  autoFocus
                />

                {/* Propriedades Compactas em Grid (Notion / ClickUp style) */}
                <div className="sheet-props-grid">
                  <div className="sheet-prop-row">
                    <span className="prop-label">
                      <LayoutGrid size={14} /> Coluna / Status:
                    </span>
                    <select
                      className="prop-select"
                      value={draft.columnId}
                      onChange={(e) => setDraft({ ...draft, columnId: Number(e.target.value) })}
                      disabled={!isOwnBoard}
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sheet-prop-row">
                    <span className="prop-label">
                      <Tag size={14} /> Prioridade:
                    </span>
                    <div className="prop-priority-buttons">
                      {(['urgent', 'high', 'medium', 'low'] as const).map((pKey) => {
                        const pCfg = PRIORITY_CONFIG[pKey]
                        const isSelected = draft.priority === pKey
                        return (
                          <button
                            key={pKey}
                            type="button"
                            className={`prop-prio-btn ${isSelected ? 'is-selected' : ''}`}
                            style={{
                              borderColor: isSelected ? pCfg.color : '#e2e8f0',
                              background: isSelected ? pCfg.color : '#fff',
                              color: isSelected ? '#fff' : pCfg.color,
                            }}
                            onClick={() => isOwnBoard && setDraft({ ...draft, priority: pKey })}
                            disabled={!isOwnBoard}
                          >
                            <span>{pCfg.icon}</span>
                            <span>{pCfg.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="sheet-prop-row">
                    <span className="prop-label">
                      <CalendarDays size={14} /> Início:
                    </span>
                    <input
                      type="date"
                      className="prop-date-input"
                      value={draft.startDate}
                      onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                      disabled={!isOwnBoard}
                    />
                  </div>

                  <div className="sheet-prop-row">
                    <span className="prop-label">
                      <Calendar size={14} /> Prazo Final:
                    </span>
                    <input
                      type="date"
                      className={`prop-date-input ${
                        draft.dueDate && draft.dueDate < dateFilterBounds.todayIso ? 'is-late' : ''
                      }`}
                      value={draft.dueDate}
                      onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                      disabled={!isOwnBoard}
                    />
                  </div>

                  <div className="sheet-prop-row is-full-width">
                    <span className="prop-label">
                      <Tag size={14} /> Etiquetas:
                    </span>
                    <div className="prop-tags-wrap">
                      {draft.tags.map((t) => (
                        <span
                          key={t}
                          className="sheet-tag-pill"
                          style={{ backgroundColor: `${getTagColor(t)}18`, color: getTagColor(t) }}
                        >
                          #{t}
                          {isOwnBoard && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextTags = draft.tags.filter((x) => x !== t)
                                setDraft({ ...draft, tags: nextTags })
                              }}
                              title="Remover etiqueta"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      ))}

                      {isOwnBoard && (
                        <div className="sheet-tag-add-dropdown">
                          <button
                            type="button"
                            className="sheet-tag-add-trigger"
                            onClick={() => setTagPickerOpen((o) => !o)}
                          >
                            + Etiqueta
                          </button>
                          {tagPickerOpen && (
                            <div className="sheet-tag-menu">
                              <div className="tag-menu-header">
                                <strong>Adicionar etiqueta</strong>
                                <button type="button" onClick={() => setTagPickerOpen(false)}>
                                  <X size={13} />
                                </button>
                              </div>
                              <div className="tag-menu-list">
                                {tags.map((t) => {
                                  const has = draft.tags.some((x) => normalizeTagName(x) === normalizeTagName(t.name))
                                  return (
                                    <label key={t.id} className="tag-menu-option">
                                      <input
                                        type="checkbox"
                                        checked={has}
                                        onChange={() => {
                                          const next = has
                                            ? draft.tags.filter((x) => normalizeTagName(x) !== normalizeTagName(t.name))
                                            : [...draft.tags, t.name].slice(0, 20)
                                          setDraft({ ...draft, tags: next })
                                        }}
                                      />
                                      <span style={{ color: getTagColor(t.name) }}>{t.name}</span>
                                    </label>
                                  )
                                })}
                              </div>
                              <div className="tag-menu-create">
                                <input
                                  type="text"
                                  value={activityTagName}
                                  onChange={(e) => setActivityTagName(e.target.value)}
                                  placeholder="Nova etiqueta..."
                                  maxLength={30}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void createTag(activityTagName)
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="secondary-button btn-xs"
                                  disabled={!activityTagName.trim()}
                                  onClick={() => void createTag(activityTagName)}
                                >
                                  Criar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Descrição Detalhada */}
                <div className="sheet-section">
                  <div className="sheet-section-title">
                    <FileText size={15} />
                    <h3>Descrição</h3>
                  </div>
                  <textarea
                    rows={4}
                    className="sheet-desc-textarea"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Adicione informações, orientações ou links para a realização desta atividade..."
                    disabled={!isOwnBoard}
                  />
                </div>

                {/* Checklist de Subtarefas */}
                {draft.id !== null && (
                  <div className="sheet-section">
                    <div className="sheet-section-title">
                      <CheckSquare size={15} />
                      <div className="checklist-heading-info">
                        <h3>Checklist & Subtarefas</h3>
                        <span className="checklist-subtext">
                          {modalChecklistTotal === 0
                            ? 'Nenhuma subtarefa'
                            : `${modalChecklistDone} de ${modalChecklistTotal} concluídos (${modalChecklistPct}%)`}
                        </span>
                      </div>
                    </div>

                    {modalChecklistTotal > 0 && (
                      <div className="sheet-checklist-bar">
                        <div
                          className="sheet-checklist-fill"
                          style={{
                            width: `${modalChecklistPct}%`,
                            backgroundColor: modalChecklistPct === 100 ? '#10b981' : '#0f3b99',
                          }}
                        />
                      </div>
                    )}

                    <ul className="sheet-checklist-items">
                      {checklist.map((item) => (
                        <li key={item.id} className={`checklist-item-row ${item.isDone ? 'is-done' : ''}`}>
                          <GripVertical size={13} className="item-drag-icon" />
                          <button
                            type="button"
                            className={`card-check-circle ${item.isDone ? 'is-checked' : ''}`}
                            onClick={() => void toggleChecklistItem(item)}
                            disabled={!isOwnBoard}
                          >
                            {item.isDone && <Check size={11} />}
                          </button>
                          <span className={`checklist-item-text ${item.isDone ? 'is-line-through' : ''}`}>
                            {item.title}
                          </span>
                          {isOwnBoard && (
                            <button
                              type="button"
                              className="item-delete-btn"
                              onClick={() => void deleteChecklistItem(item)}
                              title="Remover item"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>

                    {isOwnBoard && (
                      <form className="sheet-add-checklist-form" onSubmit={(e) => void addChecklistItem(e)}>
                        <input
                          type="text"
                          value={newChecklistItemTitle}
                          onChange={(e) => setNewChecklistItemTitle(e.target.value)}
                          placeholder="+ Adicionar item ao checklist (Enter para salvar)..."
                          maxLength={240}
                          disabled={busyChecklist}
                        />
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Lado Direito (35%): Linha do Tempo / Comentários & Anexos */}
              <aside className="sheet-aside-column">
                <div className="sheet-aside-tabs">
                  <button
                    type="button"
                    className={`aside-tab-btn ${sheetRightTab === 'activity' ? 'is-active' : ''}`}
                    onClick={() => setSheetRightTab('activity')}
                  >
                    <MessageCircle size={14} />
                    <span>Atividade ({comments.length})</span>
                  </button>
                  <button
                    type="button"
                    className={`aside-tab-btn ${sheetRightTab === 'files' ? 'is-active' : ''}`}
                    onClick={() => setSheetRightTab('files')}
                  >
                    <Paperclip size={14} />
                    <span>Anexos ({attachments.length})</span>
                  </button>
                </div>

                {sheetRightTab === 'activity' ? (
                  <div className="sheet-activity-pane">
                    <div className="sheet-comments-list">
                      {loadingDetails ? (
                        <p className="aside-empty-hint">Carregando comentários...</p>
                      ) : comments.length ? (
                        comments.map((comment) => (
                          <div key={comment.id} className="sheet-comment-card">
                            <div className="comment-header">
                              <span className="comment-avatar">
                                {comment.authorName[0]?.toUpperCase() || 'U'}
                              </span>
                              <strong>{comment.authorName}</strong>
                              <time>
                                {new Date(comment.createdAt).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                              {isOwnBoard && (
                                <button
                                  type="button"
                                  className="comment-del-btn"
                                  onClick={() => void deleteComment(comment)}
                                  title="Excluir comentário"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            <p className="comment-body">{comment.body}</p>
                          </div>
                        ))
                      ) : (
                        <p className="aside-empty-hint">Nenhum comentário nesta atividade.</p>
                      )}
                    </div>

                    {isOwnBoard && (
                      <form className="sheet-comment-box" onSubmit={(e) => void postComment(e)}>
                        <textarea
                          rows={2}
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                          placeholder="Escreva uma anotação ou comentário..."
                          required
                        />
                        <div className="comment-box-footer">
                          <button
                            type="submit"
                            className="primary-button btn-xs"
                            disabled={busyComment || !commentBody.trim()}
                          >
                            {busyComment ? 'Enviando...' : 'Comentar'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="sheet-files-pane">
                    {isOwnBoard && (
                      <label className={`sheet-drop-zone ${uploading ? 'is-uploading' : ''}`}>
                        <Paperclip size={18} />
                        <span>{uploading ? 'Enviando...' : 'Clique para selecionar ou arraste arquivos aqui'}</span>
                        <small>PDF, imagens, TXT, CSV · até 5 MiB</small>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv"
                          disabled={uploading}
                          onChange={(e) => void uploadAttachment(e)}
                        />
                      </label>
                    )}

                    <div className="sheet-attachments-list">
                      {attachments.map((att) => (
                        <div key={att.id} className="sheet-attachment-card">
                          <FileText size={18} className="file-icon" />
                          <div className="file-info">
                            <strong>{att.fileName}</strong>
                            <small>
                              {Math.ceil(att.fileSize / 1024)} KB · {att.uploadedByName}
                            </small>
                          </div>
                          <div className="file-actions">
                            <button
                              type="button"
                              className="file-btn"
                              onClick={() => void downloadAttachment(att)}
                              title="Baixar arquivo"
                            >
                              <Download size={14} />
                            </button>
                            {isOwnBoard && (
                              <button
                                type="button"
                                className="file-btn is-del"
                                onClick={() => void deleteAttachment(att)}
                                title="Excluir arquivo"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {attachments.length === 0 && (
                        <p className="aside-empty-hint">Nenhum anexo nesta tarefa.</p>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </main>
  )
}
