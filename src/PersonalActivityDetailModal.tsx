import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  BriefcaseBusiness,
  Calendar,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  LayoutGrid,
  Maximize2,
  MessageCircle,
  Minimize2,
  Paperclip,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { apiRequest } from './api/client'
import './PersonalActivitiesPage.css'

export type ActivityPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface ActivityColumn {
  id: number
  name: string
  position: number
}

export interface ActivityTag {
  id: number
  name: string
}

export interface PersonalActivityItem {
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
  ticketId?: string | null
  ticketProtocol?: string | null
  legalProcessId?: number | null
  legalProcessTitle?: string | null
  legalProcessNumber?: string | null
}

interface ActivityChecklistItem {
  id: number
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

export const PRIORITY_CONFIG: Record<
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

export function getTagColor(tagName: string): string {
  const norm = tagName.trim().toLowerCase()
  if (PRESET_TAG_COLORS[norm]) return PRESET_TAG_COLORS[norm]
  if (norm.startsWith('chamado')) return '#0f3b99'
  let hash = 0
  for (let i = 0; i < norm.length; i++) {
    hash = norm.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 42%)`
}

function normalizeTagName(name: string) {
  return name.trim().toLocaleLowerCase('pt-BR')
}

interface DraftState {
  id: number
  columnId: number
  title: string
  description: string
  priority: ActivityPriority
  startDate: string
  dueDate: string
  tags: string[]
  ticketId?: string | null
  ticketProtocol?: string | null
  legalProcessId?: number | null
  legalProcessTitle?: string | null
  legalProcessNumber?: string | null
}

function getPayloadFromDraft(draft: DraftState) {
  const safeTags = Array.isArray(draft.tags)
    ? draft.tags.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : []
  return {
    columnId: Number(draft.columnId) || 1,
    title: draft.title.trim(),
    description: draft.description || '',
    priority: draft.priority || 'medium',
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    tags: [...new Set(safeTags)].slice(0, 20),
  }
}

export default function PersonalActivityDetailModal({
  activityId,
  onClose,
  onChanged,
  onDelete,
  navigation,
}: {
  activityId: number
  onClose: () => void
  onChanged?: (updated?: Partial<PersonalActivityItem> & { isCompleted?: boolean }) => void
  onDelete?: (deletedId: number) => void
  navigation?: {
    currentIndex: number
    total: number
    onPrev?: () => void
    onNext?: () => void
  }
}) {
  const [ownerName, setOwnerName] = useState('Colaborador')
  const [canEdit, setCanEdit] = useState(true)
  const [columns, setColumns] = useState<ActivityColumn[]>([])
  const [tags, setTags] = useState<ActivityTag[]>([])
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [rightTab, setRightTab] = useState<'activity' | 'files'>('activity')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  const [checklist, setChecklist] = useState<ActivityChecklistItem[]>([])
  const [newChecklistTitle, setNewChecklistTitle] = useState('')
  const [comments, setComments] = useState<ActivityComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([])

  const [busyChecklist, setBusyChecklist] = useState(false)
  const [busyComment, setBusyComment] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [modalNotice, setModalNotice] = useState<string | null>(null)

  const savedSnapshotRef = useRef<string | null>(null)
  const draftRef = useRef<DraftState | null>(null)
  const todayIso = useRef(new Date().toISOString().slice(0, 10)).current

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const loadFullActivity = useCallback(async (targetId: number) => {
    setLoadingActivity(true)
    setLoadError('')
    setModalNotice(null)
    try {
      const [detailRes, commentsRes, attachmentsRes, checklistRes] = await Promise.all([
        apiRequest<{
          ownerId: number
          ownerName: string
          canEdit: boolean
          columns: ActivityColumn[]
          tags: ActivityTag[]
          activity: PersonalActivityItem
        }>(`/api/personal-activities/items/${targetId}`),
        apiRequest<{ comments: ActivityComment[] }>(`/api/personal-activities/items/${targetId}/comments`),
        apiRequest<{ attachments: ActivityAttachment[] }>(`/api/personal-activities/items/${targetId}/attachments`),
        apiRequest<{ items: ActivityChecklistItem[] }>(`/api/personal-activities/items/${targetId}/checklist`),
      ])

      const act = detailRes.activity
      const nextDraft: DraftState = {
        id: act.id,
        columnId: act.columnId,
        title: act.title || '',
        description: act.description || '',
        priority: act.priority || 'medium',
        startDate: act.startDate ?? '',
        dueDate: act.dueDate ?? '',
        tags: Array.isArray(act.tags) ? act.tags : [],
        ticketId: act.ticketId,
        ticketProtocol: act.ticketProtocol,
        legalProcessId: act.legalProcessId,
        legalProcessTitle: act.legalProcessTitle,
        legalProcessNumber: act.legalProcessNumber,
      }
      savedSnapshotRef.current = JSON.stringify(getPayloadFromDraft(nextDraft))
      setOwnerName(detailRes.ownerName)
      setCanEdit(detailRes.canEdit)
      setColumns(detailRes.columns)
      setTags(detailRes.tags)
      setDraft(nextDraft)
      setComments(commentsRes.comments ?? [])
      setAttachments(attachmentsRes.attachments ?? [])
      setChecklist(checklistRes.items ?? [])
      setDirty(false)
      setSaveFailed(false)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os detalhes desta tarefa.')
    } finally {
      setLoadingActivity(false)
    }
  }, [])

  useEffect(() => {
    void loadFullActivity(activityId)
  }, [activityId, loadFullActivity])

  const isColumnCompleted = useCallback(
    (colId: number) => {
      const col = columns.find((c) => c.id === colId)
      return Boolean(col && /conclu/i.test(col.name))
    },
    [columns],
  )

  // Autosave
  useEffect(() => {
    if (!draft || !canEdit || saving) return
    const payload = getPayloadFromDraft(draft)
    if (!payload.title) return
    const snapshot = JSON.stringify(payload)
    if (snapshot === savedSnapshotRef.current) {
      setDirty(false)
      return
    }
    setDirty(true)
    const timer = window.setTimeout(async () => {
      const current = draftRef.current
      if (!current) return
      const currentPayload = getPayloadFromDraft(current)
      if (!currentPayload.title) return
      const currentSnapshot = JSON.stringify(currentPayload)
      if (currentSnapshot === savedSnapshotRef.current) return

      setSaving(true)
      setSaveFailed(false)
      try {
        await apiRequest(`/api/personal-activities/items/${current.id}`, {
          method: 'PATCH',
          body: JSON.stringify(currentPayload),
        })
        savedSnapshotRef.current = currentSnapshot
        setDirty(false)
        setSaveFailed(false)
        onChanged?.({
          id: current.id,
          ...currentPayload,
          isCompleted: isColumnCompleted(currentPayload.columnId),
        })
      } catch (err) {
        setSaveFailed(true)
        setModalNotice(err instanceof Error ? err.message : 'Erro ao salvar alterações.')
      } finally {
        setSaving(false)
      }
    }, 400)

    return () => window.clearTimeout(timer)
  }, [draft, canEdit, saving, onChanged, isColumnCompleted])

  // Fechar com Esc (captura antes de listeners da página pai)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (tagPickerOpen) {
        setTagPickerOpen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [tagPickerOpen, onClose])

  async function toggleComplete() {
    if (!draft || !canEdit || !columns.length) return
    const doneCol = [...columns].reverse().find((c) => /conclu/i.test(c.name)) ?? columns[columns.length - 1]
    const initialCol = columns[0]
    if (!doneCol || !initialCol) return
    const currentlyDone = isColumnCompleted(draft.columnId)
    const nextColId = currentlyDone ? initialCol.id : doneCol.id
    setDraft({ ...draft, columnId: nextColId })
  }

  async function handleDeleteTask() {
    if (!draft || !canEdit) return
    if (!window.confirm(`Excluir a tarefa "${draft.title}"? Ela será removida de todos os quadros vinculados.`)) return
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}`, { method: 'DELETE' })
      onDelete?.(draft.id)
      onChanged?.()
      onClose()
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Não foi possível excluir a tarefa.')
    }
  }

  async function createTag(name: string) {
    const clean = name.trim()
    if (!clean || !canEdit || !draft) return
    try {
      const res = await apiRequest<{ tag: ActivityTag }>('/api/personal-activities/tags', {
        method: 'POST',
        body: JSON.stringify({ name: clean }),
      }).catch(() => ({ tag: { id: Date.now(), name: clean } }))
      setTags((prev) =>
        prev.some((t) => normalizeTagName(t.name) === normalizeTagName(clean))
          ? prev
          : [...prev, res.tag].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      )
      setNewTagName('')
      if (!draft.tags.some((t) => normalizeTagName(t) === normalizeTagName(clean))) {
        setDraft({ ...draft, tags: [...draft.tags, clean].slice(0, 20) })
      }
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Erro ao criar etiqueta.')
    }
  }

  async function toggleChecklistItem(item: ActivityChecklistItem) {
    if (!draft || !canEdit) return
    const nextDone = !item.isDone
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, isDone: nextDone } : i)))
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/checklist/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: nextDone }),
      })
      onChanged?.({
        id: draft.id,
        checklistTotal: checklist.length,
        checklistDone: checklist.filter((i) => (i.id === item.id ? nextDone : i.isDone)).length,
      })
    } catch {
      setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, isDone: !nextDone } : i)))
    }
  }

  async function addChecklistItem(e: FormEvent) {
    e.preventDefault()
    if (!draft || !canEdit || !newChecklistTitle.trim()) return
    setBusyChecklist(true)
    try {
      const res = await apiRequest<{ item: ActivityChecklistItem }>(
        `/api/personal-activities/items/${draft.id}/checklist`,
        {
          method: 'POST',
          body: JSON.stringify({ title: newChecklistTitle.trim() }),
        },
      )
      const nextList = [...checklist, res.item]
      setChecklist(nextList)
      setNewChecklistTitle('')
      onChanged?.({
        id: draft.id,
        checklistTotal: nextList.length,
        checklistDone: nextList.filter((i) => i.isDone).length,
      })
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Erro ao adicionar item.')
    } finally {
      setBusyChecklist(false)
    }
  }

  async function deleteChecklistItem(item: ActivityChecklistItem) {
    if (!draft || !canEdit) return
    const nextList = checklist.filter((i) => i.id !== item.id)
    setChecklist(nextList)
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/checklist/${item.id}`, {
        method: 'DELETE',
      })
      onChanged?.({
        id: draft.id,
        checklistTotal: nextList.length,
        checklistDone: nextList.filter((i) => i.isDone).length,
      })
    } catch {
      void loadFullActivity(draft.id)
    }
  }

  async function postComment(e: FormEvent) {
    e.preventDefault()
    if (!draft || !canEdit || !commentBody.trim()) return
    setBusyComment(true)
    try {
      const res = await apiRequest<{ comment: ActivityComment }>(
        `/api/personal-activities/items/${draft.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: commentBody.trim() }),
        },
      )
      const nextComments = [...comments, res.comment]
      setComments(nextComments)
      setCommentBody('')
      onChanged?.({ id: draft.id, commentsCount: nextComments.length })
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Erro ao publicar comentário.')
    } finally {
      setBusyComment(false)
    }
  }

  async function deleteComment(comment: ActivityComment) {
    if (!draft || !canEdit || !window.confirm('Excluir este comentário?')) return
    const nextComments = comments.filter((c) => c.id !== comment.id)
    setComments(nextComments)
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/comments/${comment.id}`, {
        method: 'DELETE',
      })
      onChanged?.({ id: draft.id, commentsCount: nextComments.length })
    } catch {
      void loadFullActivity(draft.id)
    }
  }

  async function uploadAttachment(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.currentTarget.value = ''
    if (!draft || !canEdit || !file) return
    if (file.size > 5 * 1024 * 1024) {
      setModalNotice('O arquivo não pode ultrapassar 5 MiB.')
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
      const res = await apiRequest<{ attachments: ActivityAttachment[] }>(
        `/api/personal-activities/items/${draft.id}/attachments`,
      )
      setAttachments(res.attachments)
      onChanged?.({ id: draft.id, attachmentsCount: res.attachments.length })
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Erro ao enviar anexo.')
    } finally {
      setUploading(false)
    }
  }

  async function downloadAttachment(att: ActivityAttachment) {
    if (!draft) return
    try {
      const res = await fetch(`/api/personal-activities/items/${draft.id}/attachments/${att.id}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Falha ao baixar arquivo.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = att.fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setModalNotice(err instanceof Error ? err.message : 'Erro ao baixar arquivo.')
    }
  }

  async function deleteAttachment(att: ActivityAttachment) {
    if (!draft || !canEdit || !window.confirm(`Excluir o anexo "${att.fileName}"?`)) return
    const nextAttachments = attachments.filter((a) => a.id !== att.id)
    setAttachments(nextAttachments)
    try {
      await apiRequest(`/api/personal-activities/items/${draft.id}/attachments/${att.id}`, {
        method: 'DELETE',
      })
      onChanged?.({ id: draft.id, attachmentsCount: nextAttachments.length })
    } catch {
      void loadFullActivity(draft.id)
    }
  }

  const checklistTotal = checklist.length
  const checklistDone = checklist.filter((i) => i.isDone).length
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0

  return createPortal(
    <div
      className={`personal-sheet-backdrop ${isFullscreen ? 'is-fullscreen' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        className="personal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={draft?.title || 'Detalhes da tarefa'}
      >
        <header className="sheet-header">
          <div className="sheet-breadcrumbs">
            <span className="sheet-crumb-board">Quadro de {ownerName}</span>
            {draft && (
              <>
                <span className="sheet-crumb-sep">/</span>
                <span className="sheet-crumb-col">
                  {columns.find((c) => c.id === draft.columnId)?.name || 'Coluna'}
                </span>
              </>
            )}
            <span className="sheet-autosave-tag">
              {loadingActivity
                ? 'Carregando...'
                : saving
                ? 'Salvando...'
                : saveFailed
                ? 'Erro ao salvar'
                : dirty
                ? 'Salvando alterações...'
                : '✓ Salvo automaticamente'}
            </span>
          </div>

          <div className="sheet-header-actions">
            {navigation && navigation.total > 1 && (
              <div className="sheet-card-switcher">
                <button
                  type="button"
                  className="sheet-icon-btn"
                  disabled={!navigation.onPrev}
                  onClick={navigation.onPrev}
                  title="Tarefa anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="switcher-counter">
                  {navigation.currentIndex + 1} de {navigation.total}
                </span>
                <button
                  type="button"
                  className="sheet-icon-btn"
                  disabled={!navigation.onNext}
                  onClick={navigation.onNext}
                  title="Próxima tarefa"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {draft && canEdit && (
              <button
                type="button"
                className={`secondary-button btn-complete-sheet ${
                  isColumnCompleted(draft.columnId) ? 'is-completed' : ''
                }`}
                onClick={() => void toggleComplete()}
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

            {draft && canEdit && (
              <button
                type="button"
                className="sheet-icon-btn"
                onClick={() => void handleDeleteTask()}
                title="Excluir tarefa"
              >
                <Trash2 size={16} />
              </button>
            )}

            <button
              type="button"
              className="sheet-icon-btn"
              onClick={() => setIsFullscreen((f) => !f)}
              title={isFullscreen ? 'Restaurar tamanho' : 'Expandir para tela cheia'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            <button
              type="button"
              className="sheet-icon-btn is-close"
              onClick={onClose}
              title="Fechar (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {modalNotice && (
          <div className="notice notice-error" style={{ margin: '12px 20px 0' }} role="alert">
            <CircleAlert size={16} />
            <span>{modalNotice}</span>
            <button type="button" onClick={() => setModalNotice(null)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}

        {loadingActivity ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
            Carregando detalhes da tarefa...
          </div>
        ) : loadError || !draft ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#dc2626' }}>
            {loadError || 'Tarefa não encontrada.'}
          </div>
        ) : (
          <div className="sheet-split-body">
            {/* Lado Esquerdo (65%): Conteúdo Principal */}
            <div className="sheet-main-column">
              {/* Vínculo de origem (Chamado ou Processo Jurídico) */}
              {(draft.ticketId || draft.legalProcessId) && (
                <div className="sheet-origin-badges" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  {draft.ticketId && (
                    <a
                      href={`?page=tickets&ticketId=${encodeURIComponent(draft.ticketId)}`}
                      className="sheet-origin-badge"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        color: '#0f3b99',
                        border: '1px solid #bfdbfe',
                        textDecoration: 'none',
                      }}
                      title="Tarefa vinculada a este chamado"
                    >
                      <ClipboardList size={13} />
                      <span>
                        Chamado {draft.ticketProtocol ? `#${draft.ticketProtocol}` : `ID ${draft.ticketId}`}
                      </span>
                      <ExternalLink size={11} />
                    </a>
                  )}
                  {draft.legalProcessId && (
                    <a
                      href={`?page=legal-processes&processId=${encodeURIComponent(String(draft.legalProcessId))}`}
                      className="sheet-origin-badge"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        backgroundColor: '#fffbeb',
                        color: '#b45309',
                        border: '1px solid #fde68a',
                        textDecoration: 'none',
                      }}
                      title="Tarefa vinculada a este processo jurídico"
                    >
                      <BriefcaseBusiness size={13} />
                      <span>
                        Processo Jurídico #{draft.legalProcessId}
                        {draft.legalProcessTitle ? ` · ${draft.legalProcessTitle}` : ''}
                      </span>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}

              <input
                type="text"
                className="sheet-title-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Nome da atividade ou tarefa..."
                disabled={!canEdit}
              />

              {/* Propriedades Compactas em Grid */}
              <div className="sheet-props-grid">
                <div className="sheet-prop-row">
                  <span className="prop-label">
                    <LayoutGrid size={14} /> Coluna / Status:
                  </span>
                  <select
                    className="prop-select"
                    value={draft.columnId}
                    onChange={(e) => setDraft({ ...draft, columnId: Number(e.target.value) })}
                    disabled={!canEdit}
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
                          onClick={() => canEdit && setDraft({ ...draft, priority: pKey })}
                          disabled={!canEdit}
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
                    disabled={!canEdit}
                  />
                </div>

                <div className="sheet-prop-row">
                  <span className="prop-label">
                    <Calendar size={14} /> Prazo Final:
                  </span>
                  <input
                    type="date"
                    className={`prop-date-input ${
                      draft.dueDate && draft.dueDate < todayIso ? 'is-late' : ''
                    }`}
                    value={draft.dueDate}
                    onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                    disabled={!canEdit}
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
                        {canEdit && (
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

                    {canEdit && (
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
                                const has = draft.tags.some(
                                  (x) => normalizeTagName(x) === normalizeTagName(t.name),
                                )
                                return (
                                  <label key={t.id} className="tag-menu-option">
                                    <input
                                      type="checkbox"
                                      checked={has}
                                      onChange={() => {
                                        const next = has
                                          ? draft.tags.filter(
                                              (x) => normalizeTagName(x) !== normalizeTagName(t.name),
                                            )
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
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                placeholder="Nova etiqueta..."
                                maxLength={30}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void createTag(newTagName)
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="secondary-button btn-xs"
                                disabled={!newTagName.trim()}
                                onClick={() => void createTag(newTagName)}
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
                  placeholder="Adicione informações, orientações ou links para a realização desta tarefa..."
                  disabled={!canEdit}
                />
              </div>

              {/* Checklist interno da tarefa */}
              <div className="sheet-section">
                <div className="sheet-section-title">
                  <CheckSquare size={15} />
                  <div className="checklist-heading-info">
                    <h3>Checklist da Tarefa</h3>
                    <span className="checklist-subtext">
                      {checklistTotal === 0
                        ? 'Nenhum item no checklist'
                        : `${checklistDone} de ${checklistTotal} concluídos (${checklistPct}%)`}
                    </span>
                  </div>
                </div>

                {checklistTotal > 0 && (
                  <div className="sheet-checklist-bar">
                    <div
                      className="sheet-checklist-fill"
                      style={{
                        width: `${checklistPct}%`,
                        backgroundColor: checklistPct === 100 ? '#10b981' : '#0f3b99',
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
                        disabled={!canEdit}
                      >
                        {item.isDone && <Check size={11} />}
                      </button>
                      <span className={`checklist-item-text ${item.isDone ? 'is-line-through' : ''}`}>
                        {item.title}
                      </span>
                      {canEdit && (
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

                {canEdit && (
                  <form className="sheet-add-checklist-form" onSubmit={(e) => void addChecklistItem(e)}>
                    <input
                      type="text"
                      value={newChecklistTitle}
                      onChange={(e) => setNewChecklistTitle(e.target.value)}
                      placeholder="+ Adicionar item ao checklist (Enter para salvar)..."
                      maxLength={240}
                      disabled={busyChecklist}
                    />
                  </form>
                )}
              </div>
            </div>

            {/* Lado Direito (35%): Comentários & Anexos */}
            <aside className="sheet-aside-column">
              <div className="sheet-aside-tabs">
                <button
                  type="button"
                  className={`aside-tab-btn ${rightTab === 'activity' ? 'is-active' : ''}`}
                  onClick={() => setRightTab('activity')}
                >
                  <MessageCircle size={14} />
                  <span>Comentários ({comments.length})</span>
                </button>
                <button
                  type="button"
                  className={`aside-tab-btn ${rightTab === 'files' ? 'is-active' : ''}`}
                  onClick={() => setRightTab('files')}
                >
                  <Paperclip size={14} />
                  <span>Anexos ({attachments.length})</span>
                </button>
              </div>

              {rightTab === 'activity' ? (
                <div className="sheet-activity-pane">
                  <div className="sheet-comments-list">
                    {comments.length ? (
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
                            {canEdit && (
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
                      <p className="aside-empty-hint">Nenhum comentário nesta tarefa.</p>
                    )}
                  </div>

                  {canEdit && (
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
                  {canEdit && (
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
                          {canEdit && (
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
        )}
      </section>
    </div>,
    document.body,
  )
}
