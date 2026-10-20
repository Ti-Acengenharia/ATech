import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, ChevronLeft, ChevronRight, Download, FileText, ListTodo, MessageCircle, Paperclip, Pencil, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { apiRequest } from './api/client'
import SearchableMultiSelect from './SearchableMultiSelect'
import './PersonalActivitiesPage.css'

interface ActivityColumn {
  id: number
  name: string
  position: number
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

function emptyDraft(columnId: number): ActivityDraft {
  return { id: null, columnId, title: '', description: '', startDate: '', dueDate: '', tags: [] }
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
  const [activities, setActivities] = useState<PersonalActivity[]>([])
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
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
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
    setDraft({ ...activity, startDate: activity.startDate ?? '', dueDate: activity.dueDate ?? '', tags: activity.tags ?? [] })
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
          activities: PersonalActivity[]
        }>(`/api/personal-activities?userId=${ownerId}`)
        if (!cancelled) {
          setColumns(result.columns)
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
  const availableTags = [...new Set(activities.flatMap((activity) => activity.tags ?? []))]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
  const activeFilterCount = Number(Boolean(activitySearch.trim())) + columnFilter.length + tagFilter.length + Number(dueFilter !== 'all')

  function matchesActivityFilters(activity: PersonalActivity) {
    const search = activitySearch.trim().toLocaleLowerCase('pt-BR')
    const matchesSearch = !search || [activity.title, activity.description, ...(activity.tags ?? [])]
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(search))
    const matchesColumn = !columnFilter.length || columnFilter.includes(String(activity.columnId))
    const matchesTags = !tagFilter.length || tagFilter.some((tag) => activity.tags?.includes(tag))
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

  async function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || ownerId !== currentUserId) return
    setSaving(true)
    try {
      const payload = {
        columnId: draft.columnId,
        title: draft.title.trim(),
        description: draft.description,
        startDate: draft.startDate || null,
        dueDate: draft.dueDate || null,
        tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
      }
      if (draft.id === null) {
        const result = await apiRequest<{ activity: PersonalActivity }>('/api/personal-activities/items', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setActivities((current) => [...current, result.activity])
      } else {
        await apiRequest(`/api/personal-activities/items/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        setActivities((current) => current.map((item) => item.id === draft.id
          ? { ...item, ...payload }
          : item))
      }
      setDraft(null)
      setNotice(null)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar a atividade.' })
    } finally {
      setSaving(false)
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
                {columnActivities.map((activity) => <article className="personal-activity-card" key={activity.id}>
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
                {isOwnBoard && <button className="personal-add-activity" type="button" onClick={() => setDraft(emptyDraft(column.id))}><Plus size={15} /> Adicionar atividade</button>}
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

      {draft && <div className="personal-activity-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null) }}>
        <section className="personal-activity-modal">
          <header><div><span className="eyebrow">QUADRO PESSOAL</span><h2>{draft.id === null ? 'Nova atividade' : isOwnBoard ? 'Editar atividade' : 'Detalhes da atividade'}</h2></div><button type="button" onClick={() => setDraft(null)} aria-label="Fechar"><X size={18} /></button></header>
          <form className="personal-activity-editor" onSubmit={(event) => void saveActivity(event)}>
            <label><span>Atividade</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={240} required autoFocus disabled={!isOwnBoard} /></label>
            <label><span>Descrição</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={4} maxLength={6000} disabled={!isOwnBoard} /></label>
            <div className="personal-activity-meta">
              <label><span>Data de início</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} disabled={!isOwnBoard} /></label>
              <label><span>Prazo</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} disabled={!isOwnBoard} /></label>
            </div>
            <label><span>Coluna</span><select value={draft.columnId} onChange={(event) => setDraft({ ...draft, columnId: Number(event.target.value) })} disabled={!isOwnBoard}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
            <label><span>Tags (separe por vírgulas)</span><input value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20) })} maxLength={800} placeholder="Ex.: urgente, cliente, orçamento" disabled={!isOwnBoard} /></label>
            {draft.id === null ? <footer><button type="button" className="personal-secondary" onClick={() => setDraft(null)}>Cancelar</button><button type="submit" className="personal-primary" disabled={saving}>{saving ? 'Salvando...' : 'Criar atividade'}</button></footer>
              : isOwnBoard && <footer><button type="button" className="personal-secondary" onClick={() => setDraft(null)}>Fechar</button><button type="submit" className="personal-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button></footer>}
          </form>
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
    </main>
  )
}
