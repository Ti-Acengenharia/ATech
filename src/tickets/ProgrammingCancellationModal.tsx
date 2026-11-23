import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  Check,
  Clock3,
  Loader2,
  UserX,
  X,
} from 'lucide-react'
import { apiRequest } from '../api/client'
import './ProgrammingCancellationModal.css'

export type CancellationReasonType = 'cliente' | 'remanejamento' | 'ac_engenharia'

export interface ProgrammingTargetForCancellation {
  id: string
  ticket_id?: string | null
  legal_process_id?: string | null
  protocol?: string | null
  subject?: string | null
  legal_process_number?: string | null
  collaborator_id: string | number
  collaborator_name: string
  collaborator_role?: string
  activity_description: string
  starts_at: string
  ends_at: string
  enterprise?: string
  block?: string
  unit?: string
}

interface CollaboratorOption {
  id: string
  name: string
  role: string
  role_label?: string
  is_on_leave?: boolean
}

interface Props {
  appointment: ProgrammingTargetForCancellation
  onClose: () => void
  onCancelled: () => void
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function ProgrammingCancellationModal({
  appointment,
  onClose,
  onCancelled,
}: Props) {
  const [reasonType, setReasonType] = useState<CancellationReasonType | ''>('')
  const [reassignedToCollaboratorId, setReassignedToCollaboratorId] = useState<string>('')
  const [reasonNotes, setReasonNotes] = useState('')
  const [collaborators, setCollaborators] = useState<CollaboratorOption[]>([])
  const [loadingCollabs, setLoadingCollabs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Bloqueia rolagem do body enquanto o modal estiver aberto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Carrega lista de colaboradores para a opção de remanejamento
  useEffect(() => {
    let cancelled = false
    setLoadingCollabs(true)
    apiRequest<{ collaborators: CollaboratorOption[] }>('/api/programming/collaborators')
      .then((data) => {
        if (!cancelled) {
          setCollaborators(data.collaborators ?? [])
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Erro ao carregar colaboradores para remanejamento:', err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCollabs(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Tecla Escape para fechar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Filtra colaboradores ativos disponíveis para remanejamento (excluindo o atual)
  const availableCollaborators = collaborators.filter(
    (c) => String(c.id) !== String(appointment.collaborator_id) && !c.is_on_leave,
  )

  const isFormValid =
    reasonType === 'cliente' ||
    (reasonType === 'remanejamento' && Boolean(reassignedToCollaboratorId)) ||
    (reasonType === 'ac_engenharia' && reasonNotes.trim().length >= 2)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reasonType || !isFormValid || submitting) return

    setSubmitting(true)
    setError('')

    try {
      await apiRequest(`/api/programming/${appointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reasonType,
          reassignedToCollaboratorId:
            reasonType === 'remanejamento' ? Number(reassignedToCollaboratorId) : undefined,
          reasonNotes: reasonNotes.trim() || undefined,
        }),
      })

      onCancelled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cancelar a atividade.')
    } finally {
      setSubmitting(false)
    }
  }

  const titleContext = appointment.protocol
    ? `Protocolo #${appointment.protocol}${appointment.subject ? ` · ${appointment.subject}` : ''}`
    : appointment.legal_process_number
      ? `Processo Jurídico ${appointment.legal_process_number}`
      : 'Atividade avulsa'

  const content = (
    <div
      className="programming-cancel-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="programming-cancel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
      >
        <header className="programming-cancel-header">
          <div className="programming-cancel-title-wrap">
            <span className="programming-cancel-eyebrow">CANCELAMENTO DE ATIVIDADE</span>
            <h2 id="cancel-modal-title">Cancelar Programação</h2>
            <div className="programming-cancel-meta-info">
              <span className="cancel-meta-pill is-time">
                <Clock3 size={12} />
                {formatDate(appointment.starts_at)} das {formatTime(appointment.starts_at)} às{' '}
                {formatTime(appointment.ends_at)}
              </span>
              <span className="cancel-meta-pill is-person">
                Colaborador: <strong>{appointment.collaborator_name}</strong>
              </span>
            </div>
            <p className="programming-cancel-sub">{titleContext}</p>
          </div>
          <button
            type="button"
            className="programming-cancel-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="programming-cancel-body">
          <p className="programming-cancel-instruction">
            Selecione o motivo do cancelamento da atividade:
          </p>

          <div className="programming-drilldown-options">
            {/* Opção 1: Cancelamento por parte do cliente */}
            <div
              className={`programming-drilldown-card ${reasonType === 'cliente' ? 'is-selected' : ''}`}
              onClick={() => {
                setReasonType('cliente')
                setError('')
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'cliente' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <UserX size={16} className="drilldown-icon is-client" />
                    <strong>Cancelamento por parte do cliente</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    O cliente cancelou, desmarcou ou não teve disponibilidade na data e horário.
                  </p>
                </div>
              </div>

              {reasonType === 'cliente' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>Observações do cliente (opcional):</span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Ex: Cliente informou que precisará viajar nesta data; reagendamento a ser alinhado..."
                      rows={3}
                      maxLength={500}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Opção 2: Remanejamento para outro profissional */}
            <div
              className={`programming-drilldown-card ${reasonType === 'remanejamento' ? 'is-selected' : ''}`}
              onClick={() => {
                setReasonType('remanejamento')
                setError('')
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'remanejamento' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <ArrowRightLeft size={16} className="drilldown-icon is-reassign" />
                    <strong>Remanejamento da atividade para outro profissional</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    A atividade permanecerá no histórico como cancelada por remanejamento e uma nova
                    atividade será criada para o novo profissional selecionado.
                  </p>
                </div>
              </div>

              {reasonType === 'remanejamento' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>
                      Selecionar profissional que receberá a atividade{' '}
                      <strong className="text-danger">*</strong>:
                    </span>
                    {loadingCollabs ? (
                      <div className="drilldown-loading">
                        <Loader2 size={16} className="animate-spin" />
                        <span>Carregando profissionais disponíveis...</span>
                      </div>
                    ) : (
                      <select
                        value={reassignedToCollaboratorId}
                        onChange={(e) => setReassignedToCollaboratorId(e.target.value)}
                        required
                        className="drilldown-select"
                      >
                        <option value="">-- Selecione o novo profissional --</option>
                        {availableCollaborators.map((collab) => (
                          <option key={collab.id} value={collab.id}>
                            {collab.name} ({collab.role_label || collab.role})
                          </option>
                        ))}
                      </select>
                    )}
                  </label>

                  <label className="drilldown-field">
                    <span>Observações do remanejamento (opcional):</span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Ex: Transferido devido a redirecionamento de equipe para outro condomínio..."
                      rows={2}
                      maxLength={500}
                    />
                  </label>

                  <div className="drilldown-notice">
                    <AlertTriangle size={14} />
                    <span>
                      O sistema verificará se o novo profissional possui disponibilidade neste mesmo
                      horário. Caso haja conflito de agenda, o sistema notificará para ajuste.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Opção 3: Cancelamento da AC Engenharia */}
            <div
              className={`programming-drilldown-card ${reasonType === 'ac_engenharia' ? 'is-selected' : ''}`}
              onClick={() => {
                setReasonType('ac_engenharia')
                setError('')
              }}
            >
              <div className="drilldown-radio-header">
                <div className="drilldown-radio-indicator">
                  {reasonType === 'ac_engenharia' && <Check size={12} />}
                </div>
                <div className="drilldown-radio-info">
                  <div className="drilldown-radio-title">
                    <Building2 size={16} className="drilldown-icon is-ac" />
                    <strong>Cancelamento da AC Engenharia</strong>
                  </div>
                  <p className="drilldown-radio-desc">
                    Cancelamento por motivos internos da equipe técnica ou construtora (requer
                    especificação do motivo).
                  </p>
                </div>
              </div>

              {reasonType === 'ac_engenharia' && (
                <div className="drilldown-expanded-content" onClick={(e) => e.stopPropagation()}>
                  <label className="drilldown-field">
                    <span>
                      Motivo do cancelamento <strong className="text-danger">*</strong>:
                    </span>
                    <textarea
                      value={reasonNotes}
                      onChange={(e) => setReasonNotes(e.target.value)}
                      placeholder="Descreva obrigatoriamente o motivo (ex: Chuva forte impedindo serviço na fachada, falta de insumo na obra, atraso no fornecedor...)"
                      rows={3}
                      maxLength={600}
                      required
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="programming-cancel-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <footer className="programming-cancel-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={submitting}
            >
              Voltar
            </button>
            <button
              type="submit"
              className="danger-button programming-cancel-confirm-btn"
              disabled={!isFormValid || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <X size={15} />
                  <span>Confirmar Cancelamento</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body)
  }

  return content
}
