import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, ChevronLeft, ChevronRight, Download, FileText, ListTodo, MessageCircle, Paperclip, Pencil, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { apiRequest } from './api/client'
import SearchableMultiSelect from './SearchableMultiSelect'
import './PersonalActivitiesPage.css'

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
  startDate: string | null
  dueDate: string | null
  tags: string[]
  commentsCount?: number
  attachmentsCount?: number
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
  startDate: string
  dueDate: string
  tags: string[]
}

function getActivityPayload(draft: ActivityDraft) {
  return {
    columnId: draft.columnId,
    title: draft.title.trim(),
    description: draft.description,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
  }
}

function getDraftSnapshot(draft: ActivityDraft) {
  return JSON.stringify(getActivityPayload(draft))
}

function emptyDraft(columnId: number): ActivityDraft {
  return { id: null, columnId, title: '', description: '', startDate: '', dueDate: '', tags: [] }
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
  const [managingTags, setManagingTags] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [activityTagName, setActivityTagName] = useState('')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editingTagName, setEditingTagName] = useState('')
  const [draft, setDraft] = useState<ActivityDraft | null>(null)
  const [comments, setComments] = useState<ActivityComment[]>([])
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [busyComment, setBusyComment] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  const [columnFilter, setColumnFilter] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'today' | 'next7' | 'no-date'>('all')
  const [saving, setSaving] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaveFailed, setDraftSaveFailed] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const draftSessionRef = useRef(0)
  const draftRef = useRef<ActivityDraft | null>(null)
  const savedDraftSnapshotRef = useRef<string | null>(null)
  const failedDraftSnapshotRef = useRef<string | null>(null)
  const closeRequestedSessionRef = useRef<number | null>(null)
  const [dateFilterBounds] = useState(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)
    const nextWeekIso = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, '0')}-${String(nextWeek.getDate()).padStart(2, '0')}`
    return { todayIso, nextWeekIso }
  })

  async function openActivity(activity: PersonalActivity) {
    const nextDraft = { ...activity, startDate: activity.startDate ?? '', dueDate: activity.dueDate ?? '', tags: activity.tags ?? [] }
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
    setCommentBody('')
    setLoadingDetails(true)
    try {
      const [commentResult, attachmentResult] = await Promise.all([
        apiRequest<{ comments: ActivityComment[] }>(`/api/personal-activities/items/${activity.id}/comments`),
        apiRequest<{ attachments: ActivityAttachment[] }>(`/api/personal-activities/items/${activity.id}/attachments`),
      ])
      setComments(commentResult.comments)
      setAttachments(attachmentResult.attachments)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar comentários e anexos.' })
    } finally {
      setLoadingDetails(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    async function loadBoard() {
      try {
        const result = await apiRequest<{
          userId: number
          userName?: string
          columns: ActivityColumn[]
          tags: ActivityTag[]
          activities: PersonalActivity[]
        }>(`/api/personal-activities?userId=${ownerId}`)
        if (!cancelled) {
          setColumns(result.columns)
          setTags(result.tags)
          setActivities(result.activities)
          setOwnerName(result.userName ?? currentUser.displayName)
        }
      } catch (error) {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar o quadro pessoal.' })
      } finally {
        if (!cancelled) setLoadedOwnerId(ownerId)
      }
    }
    void loadBoard()
    return () => { cancelled = true }
  }, [ownerId, currentUser.displayName])
  const loading = loadedOwnerId !== ownerId

  useEffect(() => {
    if (!canViewOtherActivities) return
    apiRequest<{ users: BoardUser[] }>('/api/personal-activities/users')
      .then((result) => setUsers(result.users))
      .catch((error: unknown) => setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível carregar a lista de usuários.',
      }))
  }, [canViewOtherActivities])

  const isOwnBoard = ownerId === currentUserId
  const availableTags = tags.map((tag) => tag.name)
  const activeFilterCount = Number(Boolean(activitySearch.trim())) + columnFilter.length + tagFilter.length + Number(dueFilter !== 'all')

  function matchesActivityFilters(activity: PersonalActivity) {
    const search = activitySearch.trim().toLocaleLowerCase('pt-BR')
    const matchesSearch = !search || [activity.title, activity.description, ...(activity.tags ?? [])]
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(search))
    const matchesColumn = !columnFilter.length || columnFilter.includes(String(activity.columnId))
    const matchesTags = !tagFilter.length || tagFilter.some((tag) =>
      activity.tags?.some((activityTag) => normalizeTagName(activityTag) === normalizeTagName(tag)))
    const dueDate = activity.dueDate
    const matchesDue = dueFilter === 'all' ||
      (dueFilter === 'no-date' && !dueDate) ||
      (dueFilter === 'overdue' && Boolean(dueDate && dueDate < dateFilterBounds.todayIso)) ||
      (dueFilter === 'today' && dueDate === dateFilterBounds.todayIso) ||
      (dueFilter === 'next7' && Boolean(dueDate && dueDate >= dateFilterBounds.todayIso && dueDate <= dateFilterBounds.nextWeekIso))
    return matchesSearch && matchesColumn && matchesTags && matchesDue
  }

  function clearFilters() {
    setActivitySearch('')
    setColumnFilter([])
    setTagFilter([])
    setDueFilter('all')
  }

  function startNewActivity(columnId: number) {
    draftSessionRef.current += 1
    closeRequestedSessionRef.current = null
    savedDraftSnapshotRef.current = null
    failedDraftSnapshotRef.current = null
    setDraftDirty(false)
    setDraftSaveFailed(false)
    setDraft(emptyDraft(columnId))
  }

  const closeActivityEditor = useCallback(() => {
    const currentDraft = draftRef.current
    if (currentDraft && isOwnBoard) {
      const snapshot = getDraftSnapshot(currentDraft)
      if (snapshot !== savedDraftSnapshotRef.current && (currentDraft.id !== null || currentDraft.title.trim())) {
        if (snapshot === failedDraftSnapshotRef.current) {
          if (!window.confirm('As alterações ainda não foram salvas. Fechar e descartá-las?')) return
        } else {
          closeRequestedSessionRef.current = draftSessionRef.current
          return
        }
      } else if (currentDraft.id === null &&
        (currentDraft.title.trim() || currentDraft.description || currentDraft.startDate || currentDraft.dueDate || currentDraft.tags.length)) {
        if (!window.confirm('Este cartão ainda não tem título e não pode ser salvo. Fechar e descartar as alterações?')) return
      }
    }
    draftSessionRef.current += 1
    closeRequestedSessionRef.current = null
    savedDraftSnapshotRef.current = null
    failedDraftSnapshotRef.current = null
    setDraftDirty(false)
    setDraftSaveFailed(false)
    setDraft(null)
    setTagPickerOpen(false)
  }, [isOwnBoard])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

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
            setActivities((current) => current.some((activity) => activity.id === result.activity.id)
              ? current
              : [...current, result.activity])
            setDraft((current) => current?.id === null ? { ...current, id: result.activity.id } : current)
          } else {
            await apiRequest(`/api/personal-activities/items/${currentDraft.id}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            })
            if (session !== draftSessionRef.current) return
            savedDraftSnapshotRef.current = currentSnapshot
            failedDraftSnapshotRef.current = null
            setDraftSaveFailed(false)
            setActivities((current) => current.map((activity) =>
              activity.id === currentDraft.id ? { ...activity, ...payload } : activity))
          }
          setNotice(null)
          const latestDraft = draftRef.current
          if (closeRequestedSessionRef.current === session && latestDraft &&
            getDraftSnapshot(latestDraft) === savedDraftSnapshotRef.current) {
            closeActivityEditor()
          }
        } catch (error) {
          if (session === draftSessionRef.current) {
            failedDraftSnapshotRef.current = currentSnapshot
            setDraftSaveFailed(true)
            setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar as alterações do cartão.' })
          }
        } finally {
          setSaving(false)
        }
      })()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draft, isOwnBoard, saving, closeActivityEditor])

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newTagName.trim()
    if (!isOwnBoard || !name) return
    try {
      const result = await apiRequest<{ tag: ActivityTag }>('/api/personal-activities/tags', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setTags((current) => [...current, result.tag].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')))
      setNewTagName('')
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar a tag.' })
    }
  }

  async function saveDraftTags(nextTags: string[]) {
    if (!draft || !isOwnBoard) return
    setDraft({ ...draft, tags: nextTags })
    setActivities((current) => current.map((activity) =>
      activity.id === draft.id ? { ...activity, tags: nextTags } : activity))
  }

  async function createActivityTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = activityTagName.trim()
    if (!isOwnBoard || !draft || !name) return
    const existingTag = tags.find((tag) => normalizeTagName(tag.name) === normalizeTagName(name))
    try {
      let tag: ActivityTag
      if (existingTag) {
        tag = existingTag
      } else {
        const result = await apiRequest<{ tag: ActivityTag }>('/api/personal-activities/tags', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        tag = result.tag
        setTags((current) => [...current, tag].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')))
      }
      setActivityTagName('')
      setTagPickerOpen(true)
      if (!draft.tags.some((value) => normalizeTagName(value) === normalizeTagName(tag.name))) {
        await saveDraftTags([...draft.tags, tag.name].slice(0, 20))
      }
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar ou adicionar a tag.' })
    }
  }

  async function renameTag(tag: ActivityTag) {
    const name = editingTagName.trim()
    if (!isOwnBoard || !name || name === tag.name) {
      setEditingTagId(null)
      return
    }
    try {
      const result = await apiRequest<{ tag: ActivityTag }>(`/api/personal-activities/tags/${tag.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setTags((current) => current.map((item) => item.id === tag.id ? result.tag : item)
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')))
      setActivities((current) => current.map((activity) => ({
        ...activity,
        tags: activity.tags.map((activityTag) =>
          normalizeTagName(activityTag) === normalizeTagName(tag.name) ? result.tag.name : activityTag),
      })))
      setTagFilter((current) => current.map((value) =>
        normalizeTagName(value) === normalizeTagName(tag.name) ? result.tag.name : value))
      setEditingTagId(null)
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível renomear a tag.' })
    }
  }

  async function deleteTag(tag: ActivityTag) {
    if (!isOwnBoard || !window.confirm(`Excluir a tag "${tag.name}"? Ela também será removida das atividades que a utilizam.`)) return
    try {
      await apiRequest(`/api/personal-activities/tags/${tag.id}`, { method: 'DELETE' })
      setTags((current) => current.filter((item) => item.id !== tag.id))
      setActivities((current) => current.map((activity) => ({
        ...activity,
        tags: activity.tags.filter((activityTag) =>
          normalizeTagName(activityTag) !== normalizeTagName(tag.name)),
      })))
      setTagFilter((current) => current.filter((value) =>
        normalizeTagName(value) !== normalizeTagName(tag.name)))
      setEditingTagId(null)
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir a tag.' })
    }
  }

  async function createColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (ownerId !== currentUserId || !newColumnName.trim()) return
    try {
      const result = await apiRequest<{ column: ActivityColumn }>('/api/personal-activities/columns', {
        method: 'POST',
        body: JSON.stringify({ name: newColumnName }),
      })
      setColumns((current) => [...current, result.column])
      setNewColumnName('')
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar a coluna.' })
    }
  }

  async function renameColumn(column: ActivityColumn) {
    if (ownerId !== currentUserId) return
    const name = window.prompt('Nome da coluna', column.name)?.trim()
    if (!name || name === column.name) return
    try {
      await apiRequest(`/api/personal-activities/columns/${column.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setColumns((current) => current.map((item) => item.id === column.id ? { ...item, name } : item))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível renomear a coluna.' })
    }
  }

  async function deleteColumn(column: ActivityColumn) {
    if (ownerId !== currentUserId || !window.confirm(`Excluir a coluna "${column.name}"?`)) return
    try {
      await apiRequest(`/api/personal-activities/columns/${column.id}`, { method: 'DELETE' })
      setColumns((current) => current.filter((item) => item.id !== column.id))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir a coluna.' })
    }
  }

  async function moveColumn(index: number, offset: -1 | 1) {
    const nextIndex = index + offset
    if (ownerId !== currentUserId || nextIndex < 0 || nextIndex >= columns.length) return
    const reordered = [...columns]
    const [column] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, column)
    try {
      await apiRequest('/api/personal-activities/columns/order', {
        method: 'PATCH',
        body: JSON.stringify({ ids: reordered.map((item) => item.id) }),
      })
      setColumns(reordered.map((item, position) => ({ ...item, position })))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível reordenar as colunas.' })
    }
  }

  async function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft?.id || !isOwnBoard || !commentBody.trim()) return
    setBusyComment(true)
    try {
      const result = await apiRequest<{ comment: ActivityComment }>(`/api/personal-activities/items/${draft.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      })
      setComments((current) => [...current, result.comment])
      setCommentBody('')
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível adicionar o comentário.' })
    } finally {
      setBusyComment(false)
    }
  }

  async function deleteComment(comment: ActivityComment) {
    if (!draft?.id || !isOwnBoard || !window.confirm('Excluir este comentário?')) return
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/comments/${comment.id}`, { method: 'DELETE' })
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o comentário.' })
    }
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!draft?.id || !isOwnBoard || !file) return
    if (file.size > 5 * 1024 * 1024) {
      setNotice({ kind: 'error', text: 'O arquivo não pode ultrapassar 5 MiB.' })
      return
    }
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler o arquivo.'))
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
        reader.readAsDataURL(file)
      })
      await apiRequest(`/api/personal-activities/items/${draft.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream', contentBase64: dataUrl.split(',')[1] }),
      })
      const result = await apiRequest<{ attachments: ActivityAttachment[] }>(`/api/personal-activities/items/${draft.id}/attachments`)
      setAttachments(result.attachments)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível enviar o anexo.' })
    } finally {
      setUploading(false)
    }
  }

  async function downloadAttachment(attachment: ActivityAttachment) {
    if (!draft?.id) return
    try {
      const response = await fetch(`/api/personal-activities/items/${draft.id}/attachments/${attachment.id}`, { credentials: 'include' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? 'Não foi possível baixar o anexo.')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível baixar o anexo.' })
    }
  }

  async function deleteAttachment(attachment: ActivityAttachment) {
    if (!draft?.id || !isOwnBoard || !window.confirm(`Excluir o anexo "${attachment.fileName}"?`)) return
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/attachments/${attachment.id}`, { method: 'DELETE' })
      setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o anexo.' })
    }
  }

  async function moveActivity(activity: PersonalActivity, columnId: number | undefined) {
    if (ownerId !== currentUserId || columnId === undefined || columnId === activity.columnId) return
    try {
      await apiRequest(`/api/personal-activities/items/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ columnId }),
      })
      setActivities((current) => current.map((item) => item.id === activity.id ? { ...item, columnId } : item))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível mover a atividade.' })
    }
  }

  async function deleteActivity(activity: PersonalActivity) {
    if (ownerId !== currentUserId || !window.confirm(`Excluir "${activity.title}"?`)) return
    try {
      await apiRequest(`/api/personal-activities/items/${activity.id}`, { method: 'DELETE' })
      setActivities((current) => current.filter((item) => item.id !== activity.id))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir a atividade.' })
    }
  }

  return (
    <main className="personal-activities-page">
      <header className="personal-activities-heading">
        <div>
          <span className="eyebrow">ORGANIZAÇÃO PESSOAL</span>
          <h1>Atividades pessoais</h1>
          <p>Organize tarefas e acompanhe o que precisa ser feito.</p>
        </div>
        {canViewOtherActivities && <label className="personal-board-selector">
          <span>Quadro exibido</span>
          <select value={ownerId} onChange={(event) => setOwnerId(Number(event.target.value))}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.id === currentUserId ? 'Meu quadro' : user.displayName}</option>)}
          </select>
        </label>}
      </header>

      {!isOwnBoard && <div className="personal-board-viewing"><ListTodo size={16} /> Visualizando o quadro de <strong>{ownerName}</strong> em modo somente leitura.</div>}
      {notice && <div className={`personal-activities-notice notice-${notice.kind}`} role="status"><CircleAlert size={16} />{notice.text}<button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={16} /></button></div>}

      {loading ? <div className="personal-activities-loading">Carregando quadro...</div> : (
        <>
        <section className="personal-activity-filters" aria-label="Filtros das atividades">
          <label className="personal-activity-search"><span>Pesquisar atividades</span><div><Search size={15} /><input type="search" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Título, descrição ou tag" /></div></label>
          <SearchableMultiSelect label="Colunas" options={columns.map((column) => ({ value: String(column.id), label: column.name }))} value={columnFilter} onChange={setColumnFilter} />
          <SearchableMultiSelect label="Tags" options={availableTags} value={tagFilter} onChange={setTagFilter} emptyLabel="Nenhuma tag cadastrada." />
          {isOwnBoard && <button className="personal-filter-clear personal-tags-manage-button" type="button" onClick={() => setManagingTags(true)}><Tag size={13} /> Gerenciar tags</button>}
          <label className="personal-activity-due-filter"><span>Prazo</span><select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as typeof dueFilter)}>
            <option value="all">Todos os prazos</option>
            <option value="overdue">Atrasadas</option>
            <option value="today">Vencem hoje</option>
            <option value="next7">Próximos 7 dias</option>
            <option value="no-date">Sem prazo</option>
          </select></label>
          <button className="personal-filter-clear" type="button" onClick={clearFilters} disabled={!activeFilterCount}>Limpar filtros</button>
          <span className="personal-filter-result">{activities.filter(matchesActivityFilters).length} de {activities.length} atividades</span>
        </section>
        <div className="personal-board" aria-label={`Quadro de atividades de ${ownerName}`}>
          {columns.map((column, index) => {
            const columnActivities = activities.filter((activity) => activity.columnId === column.id && matchesActivityFilters(activity))
            const totalColumnActivities = activities.filter((activity) => activity.columnId === column.id).length
            return <section className="personal-column" key={column.id}>
              <header>
                <span className="personal-column-indicator" />
                <h2>{column.name}</h2>
                <span className="personal-column-count" title={activeFilterCount ? `${columnActivities.length} exibidas de ${totalColumnActivities}` : undefined}>{activeFilterCount ? `${columnActivities.length}/${totalColumnActivities}` : columnActivities.length}</span>
                {isOwnBoard && <div className="personal-column-actions">
                  <button type="button" disabled={index === 0} onClick={() => void moveColumn(index, -1)} aria-label="Mover coluna para a esquerda" title="Mover para a esquerda"><ChevronLeft size={14} /></button>
                  <button type="button" disabled={index === columns.length - 1} onClick={() => void moveColumn(index, 1)} aria-label="Mover coluna para a direita" title="Mover para a direita"><ChevronRight size={14} /></button>
                  <button type="button" onClick={() => void renameColumn(column)} aria-label={`Renomear ${column.name}`} title="Renomear coluna"><Pencil size={14} /></button>
                  <button type="button" disabled={columns.length <= 1} onClick={() => void deleteColumn(column)} aria-label={`Excluir ${column.name}`} title={columns.length <= 1 ? 'O quadro precisa manter uma coluna' : 'Excluir coluna'}><Trash2 size={14} /></button>
                </div>}
              </header>
              <div className="personal-column-body">
                {columnActivities.map((activity) => <article
                  className="personal-activity-card"
                  key={activity.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir atividade ${activity.title}`}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
                    void openActivity(activity)
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                    event.preventDefault()
                    void openActivity(activity)
                  }}
                >
                  <div className="personal-activity-title-row"><h3><button type="button" className="personal-activity-open" onClick={() => void openActivity(activity)}>{activity.title}</button></h3>{isOwnBoard && <button type="button" onClick={() => void openActivity(activity)} aria-label={`Editar ${activity.title}`}><Pencil size={14} /></button>}</div>
                  {activity.description && <p>{activity.description}</p>}
                  {(activity.startDate || activity.dueDate) && <small className="personal-activity-date"><CalendarDays size={13} />{activity.startDate ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${activity.startDate}T00:00:00Z`)) : 'Sem início'}{activity.dueDate ? ` – ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${activity.dueDate}T00:00:00Z`))}` : ''}</small>}
                  {!!activity.tags?.length && <div className="personal-activity-tags">{activity.tags.map((tag) => <span key={tag}><Tag size={11} />{tag}</span>)}</div>}
                  {((activity.commentsCount ?? 0) > 0 || (activity.attachmentsCount ?? 0) > 0) && <div className="personal-activity-counts">{(activity.commentsCount ?? 0) > 0 && <span><MessageCircle size={12} />{activity.commentsCount}</span>}{(activity.attachmentsCount ?? 0) > 0 && <span><Paperclip size={12} />{activity.attachmentsCount}</span>}</div>}
                  {isOwnBoard && <footer>
                    <button type="button" disabled={index === 0} onClick={() => void moveActivity(activity, columns[index - 1]?.id)} aria-label="Mover para a coluna anterior"><ArrowLeft size={14} /></button>
                    <button type="button" disabled={index === columns.length - 1} onClick={() => void moveActivity(activity, columns[index + 1]?.id)} aria-label="Mover para a próxima coluna"><ArrowRight size={14} /></button>
                    <button type="button" className="personal-delete-activity" onClick={() => void deleteActivity(activity)} aria-label={`Excluir ${activity.title}`}><Trash2 size={14} /></button>
                  </footer>}
                </article>)}
                {!columnActivities.length && <div className="personal-column-empty">{activeFilterCount ? 'Nenhuma atividade corresponde aos filtros.' : isOwnBoard ? 'Nenhuma atividade nesta coluna.' : 'Sem atividades.'}</div>}
                {isOwnBoard && <button className="personal-add-activity" type="button" onClick={() => { setTagPickerOpen(false); startNewActivity(column.id) }}><Plus size={15} /> Adicionar atividade</button>}
              </div>
            </section>
          })}
          {isOwnBoard && <form className="personal-new-column" onSubmit={(event) => void createColumn(event)}>
            <label htmlFor="personal-new-column">Nova coluna</label>
            <input id="personal-new-column" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} placeholder="Ex.: Aguardando" maxLength={80} />
            <button type="submit" disabled={!newColumnName.trim() || columns.length >= 30}><Plus size={15} />{columns.length >= 30 ? 'Limite de colunas' : 'Criar coluna'}</button>
          </form>}
          {!columns.length && <div className="personal-board-empty">Este quadro ainda não tem colunas.</div>}
        </div>
        </>
      )}

      {draft && <div className="personal-activity-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeActivityEditor() }}>
        <section className="personal-activity-modal">
          <header><div><span className="eyebrow">QUADRO PESSOAL</span><h2>{draft.id === null ? 'Nova atividade' : isOwnBoard ? 'Editar atividade' : 'Detalhes da atividade'}</h2>{isOwnBoard && <span className="personal-autosave-status">{saving ? 'Salvando alterações...' : draft.id === null && !draft.title.trim() ? 'Preencha o título para iniciar o salvamento automático.' : draftSaveFailed ? 'Não foi possível salvar. Altere um campo para tentar novamente.' : draftDirty ? 'Salvando automaticamente...' : 'Alterações salvas automaticamente.'}</span>}</div><button type="button" onClick={closeActivityEditor} aria-label="Fechar"><X size={18} /></button></header>
          <div className="personal-activity-editor">
            <label><span>Atividade</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={240} required autoFocus disabled={!isOwnBoard} /></label>
            <label><span>Descrição</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={4} maxLength={6000} disabled={!isOwnBoard} /></label>
            <div className="personal-activity-meta">
              <label><span>Data de início</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} disabled={!isOwnBoard} /></label>
              <label><span>Prazo</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} disabled={!isOwnBoard} /></label>
            </div>
            <label><span>Coluna</span><select value={draft.columnId} onChange={(event) => setDraft({ ...draft, columnId: Number(event.target.value) })} disabled={!isOwnBoard}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
            <div className="personal-activity-tag-picker">
              <span>Tags {saving && <small>Salvando...</small>}</span>
              <button type="button" className="personal-tag-picker-trigger" onClick={() => setTagPickerOpen((open) => !open)} disabled={!isOwnBoard}>
                <Tag size={14} />
                {draft.tags.length ? `${draft.tags.length} selecionada(s)` : 'Selecionar tags'}
                <ChevronRight size={14} className={tagPickerOpen ? 'is-open' : ''} />
              </button>
              {draft.tags.length > 0 && <div className="personal-tag-suggestions" aria-label="Tags selecionadas">{draft.tags.map((tag) => <span key={tag}><Tag size={11} />{tag}</span>)}</div>}
              {tagPickerOpen && isOwnBoard && <div className="personal-tag-picker-menu">
                <div className="personal-tag-picker-heading"><strong>Tags do quadro</strong><button type="button" onClick={() => setTagPickerOpen(false)} aria-label="Fechar lista de tags"><X size={15} /></button></div>
                <div className="personal-tag-picker-options">
                  {!tags.length && <p className="personal-detail-empty">Nenhuma tag cadastrada. Crie uma abaixo.</p>}
                  {tags.map((tag) => {
                    const selected = draft.tags.some((value) => normalizeTagName(value) === normalizeTagName(tag.name))
                    return <label key={tag.id}>
                      <input type="checkbox" checked={selected} disabled={saving || draft.tags.length >= 20 && !selected} onChange={() => {
                        const nextTags = selected
                          ? draft.tags.filter((value) => normalizeTagName(value) !== normalizeTagName(tag.name))
                          : [...draft.tags, tag.name].slice(0, 20)
                        void saveDraftTags(nextTags)
                      }} />
                      <span>{tag.name}</span>
                    </label>
                  })}
                </div>
                <form className="personal-tag-create" onSubmit={(event) => void createActivityTag(event)}>
                  <input value={activityTagName} onChange={(event) => setActivityTagName(event.target.value)} maxLength={40} placeholder="Criar nova tag" aria-label="Criar nova tag" />
                  <button type="submit" className="personal-primary" disabled={!activityTagName.trim() || saving}><Plus size={15} /> Criar</button>
                </form>
              </div>}
            </div>
          </div>
          {draft.id !== null && <div className="personal-activity-details">
            <section className="personal-activity-comments">
              <header><div><h3>Comentários</h3><p>{comments.length} comentário(s)</p></div><MessageCircle size={17} /></header>
              {loadingDetails ? <p className="personal-detail-empty">Carregando comentários e anexos...</p> : comments.length ? <ul>{comments.map((comment) => <li key={comment.id}><div><strong>{comment.authorName}</strong><time>{new Date(comment.createdAt).toLocaleString('pt-BR')}{comment.updatedAt !== comment.createdAt ? ' · editado' : ''}</time></div><p>{comment.body}</p>{isOwnBoard && <button type="button" className="personal-detail-delete" onClick={() => void deleteComment(comment)} title="Excluir comentário"><Trash2 size={13} /></button>}</li>)}</ul> : <p className="personal-detail-empty">Ainda não há comentários.</p>}
              {isOwnBoard && <form className="personal-comment-form" onSubmit={(event) => void postComment(event)}><textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={3} maxLength={6000} placeholder="Escreva um comentário..." required /><button type="submit" className="personal-primary" disabled={busyComment || !commentBody.trim()}>{busyComment ? 'Enviando...' : 'Comentar'}</button></form>}
            </section>
            <section className="personal-activity-attachments">
              <header><div><h3>Anexos</h3><p>{attachments.length} arquivo(s) · máximo de 5 MiB por arquivo</p></div><Paperclip size={17} /></header>
              {attachments.length ? <ul>{attachments.map((attachment) => <li key={attachment.id}><FileText size={15} /><span><strong>{attachment.fileName}</strong><small>{Math.ceil(attachment.fileSize / 1024)} KB · {attachment.uploadedByName}</small></span><button type="button" onClick={() => void downloadAttachment(attachment)} title={`Baixar ${attachment.fileName}`}><Download size={14} /></button>{isOwnBoard && <button type="button" className="personal-detail-delete" onClick={() => void deleteAttachment(attachment)} title="Excluir anexo"><Trash2 size={13} /></button>}</li>)}</ul> : <p className="personal-detail-empty">Nenhum anexo nesta atividade.</p>}
              {isOwnBoard && <label className={`personal-attachment-upload ${uploading ? 'is-disabled' : ''}`}><Paperclip size={14} />{uploading ? 'Enviando...' : 'Adicionar anexo'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv" disabled={uploading} onChange={(event) => void uploadAttachment(event)} /></label>}
            </section>
          </div>}
        </section>
      </div>}
      {managingTags && isOwnBoard && <div className="personal-activity-backdrop personal-tag-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManagingTags(false) }}>
        <section className="personal-activity-modal personal-tag-modal" aria-labelledby="personal-tag-modal-title">
          <header><div><span className="eyebrow">QUADRO PESSOAL</span><h2 id="personal-tag-modal-title">Gerenciar tags</h2></div><button type="button" onClick={() => setManagingTags(false)} aria-label="Fechar"><X size={18} /></button></header>
          <p className="personal-tag-help">As tags ficam salvas no seu quadro e podem ser reutilizadas em qualquer atividade.</p>
          <form className="personal-tag-create" onSubmit={(event) => void createTag(event)}>
            <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={40} placeholder="Nome da nova tag" aria-label="Nome da nova tag" />
            <button type="submit" className="personal-primary" disabled={!newTagName.trim()}><Plus size={15} /> Criar</button>
          </form>
          <div className="personal-tag-list">
            {!tags.length && <p className="personal-detail-empty">Nenhuma tag cadastrada neste quadro.</p>}
            {tags.map((tag) => <div className="personal-tag-row" key={tag.id}>
              {editingTagId === tag.id
                ? <form onSubmit={(event) => { event.preventDefault(); void renameTag(tag) }}>
                    <input autoFocus value={editingTagName} onChange={(event) => setEditingTagName(event.target.value)} maxLength={40} aria-label={`Novo nome para ${tag.name}`} />
                    <button type="submit" aria-label="Salvar nome da tag" disabled={!editingTagName.trim()}><Plus size={15} /></button>
                    <button type="button" onClick={() => setEditingTagId(null)} aria-label="Cancelar edição"><X size={15} /></button>
                  </form>
                : <><span><Tag size={13} />{tag.name}</span><div>
                    <button type="button" onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name) }} aria-label={`Renomear ${tag.name}`} title="Renomear"><Pencil size={14} /></button>
                    <button type="button" onClick={() => void deleteTag(tag)} aria-label={`Excluir ${tag.name}`} title="Excluir"><Trash2 size={14} /></button>
                  </div></>}
            </div>)}
          </div>
          <footer><button type="button" className="personal-secondary" onClick={() => setManagingTags(false)}>Concluir</button></footer>
        </section>
      </div>}
    </main>
  )
}
