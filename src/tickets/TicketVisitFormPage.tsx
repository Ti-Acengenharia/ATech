import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, CheckCircle2, Loader2, PenTool, Trash2, AlertTriangle } from 'lucide-react'
import { apiRequest } from '../api/client'
import { ATechLoading } from '../ATechLoading'
import type { TicketSummary } from './types'
import {
  generateVisitDeclarationPdf,
  generateVisitReportPdf,
  type VisitFormData,
  type VisitPhotoItem,
} from './visit-pdf'
import './TicketVisitFormPage.css'

export interface TicketVisitRecord extends VisitFormData {
  id: string
  ticketId: string
  protocol: string
  status: 'draft' | 'finalized'
  clientName: string | null
  clientDocument: string | null
  visitDate: string | null
  declarationAttachmentId: string | null
  reportAttachmentId: string | null
  cvcrmDeclarationStatus: string
  cvcrmDeclarationError: string | null
  cvcrmReportStatus: string
  cvcrmReportError: string | null
  createdByName: string | null
  finalizedByName: string | null
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
}

interface Props {
  ticket: TicketSummary
  currentUserName: string
  onBack: () => void
  onFinalized: (visit: TicketVisitRecord) => void
  onNotice: (notice: { kind: 'success' | 'error'; text: string }) => void
}

async function compressVisitPhoto(file: File): Promise<VisitPhotoItem> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Imagem inválida.'))
    image.src = dataUrl
  })

  const maxSide = 1280
  let targetW = img.width
  let targetH = img.height
  if (targetW > maxSide || targetH > maxSide) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxSide) / targetW)
      targetW = maxSide
    } else {
      targetW = Math.round((targetW * maxSide) / targetH)
      targetH = maxSide
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Falha ao processar imagem.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(img, 0, 0, targetW, targetH)

  const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.72)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || 'foto.jpg',
    dataUrl: compressedDataUrl,
    size: Math.round((compressedDataUrl.length * 3) / 4),
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function formatDateBr(value: string | Date | null | undefined): string {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export default function TicketVisitFormPage({
  ticket,
  currentUserName,
  onBack,
  onFinalized,
  onNotice,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [visitId, setVisitId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null)
  const [form, setForm] = useState<VisitFormData>({
    inspectedEnvironments: '',
    hasFurniture: '',
    needsClearance: '',
    damagedFurniture: '',
    needsMaterialPurchase: '',
    materialPurchaseDetails: '',
    estimatedExecutionDays: null,
    standardDeliveryColor: '',
    observations: '',
    photos: {},
  })

  const [compressingField, setCompressingField] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Finalization modal state
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false)
  const [internalSigBase64, setInternalSigBase64] = useState<string | null>(null)
  const [missingInternalSig, setMissingInternalSig] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientDocument, setClientDocument] = useState('')
  const [hasClientSignature, setHasClientSignature] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)
  const autoSaveTimerRef = useRef<number | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    let active = true
    async function loadOrCreateDraft() {
      try {
        setLoading(true)
        const res = await apiRequest<{ visit: TicketVisitRecord }>(
          `/api/tickets/${encodeURIComponent(ticket.id)}/visits/draft`,
          { method: 'POST' },
        )
        if (!active) return
        const v = res.visit
        setVisitId(v.id)
        setForm({
          inspectedEnvironments: v.inspectedEnvironments || '',
          hasFurniture: v.hasFurniture || '',
          needsClearance: v.needsClearance || '',
          damagedFurniture: v.damagedFurniture || '',
          needsMaterialPurchase: v.needsMaterialPurchase || '',
          materialPurchaseDetails: v.materialPurchaseDetails || '',
          estimatedExecutionDays: v.estimatedExecutionDays ?? null,
          standardDeliveryColor: v.standardDeliveryColor || '',
          observations: v.observations || '',
          photos: (v.photos && typeof v.photos === 'object' ? v.photos : {}) as Record<string, VisitPhotoItem[]>,
        })
        setSaveState('saved')
        setLastSavedTime(new Date(v.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      } catch (err) {
        if (!active) return
        onNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao abrir rascunho da visita.' })
      } finally {
        if (active) {
          setLoading(false)
          window.setTimeout(() => {
            isInitialLoadRef.current = false
          }, 100)
        }
      }
    }
    void loadOrCreateDraft()
    return () => {
      active = false
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    }
  }, [ticket.id, onNotice])

  const persistDraft = useCallback(
    async (nextForm: VisitFormData, targetVisitId: string) => {
      try {
        setSaveState('saving')
        await apiRequest(`/api/tickets/${encodeURIComponent(ticket.id)}/visits/${encodeURIComponent(targetVisitId)}/draft`, {
          method: 'PUT',
          body: JSON.stringify(nextForm),
        })
        setSaveState('saved')
        setLastSavedTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      } catch {
        setSaveState('error')
      }
    },
    [ticket.id],
  )

  useEffect(() => {
    if (isInitialLoadRef.current || !visitId) return
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    setSaveState('saving')
    autoSaveTimerRef.current = window.setTimeout(() => {
      void persistDraft(form, visitId)
    }, 650)
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    }
  }, [form, visitId, persistDraft])

  const handlePhotoUpload = async (fieldKey: string, files: FileList | null) => {
    if (!files || files.length === 0) return
    setCompressingField(fieldKey)
    try {
      const compressed: VisitPhotoItem[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        compressed.push(await compressVisitPhoto(file))
      }
      if (compressed.length) {
        setForm((prev) => ({
          ...prev,
          photos: {
            ...prev.photos,
            [fieldKey]: [...(prev.photos[fieldKey] || []), ...compressed].slice(0, 10),
          },
        }))
      }
    } catch (err) {
      onNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao comprimir foto.' })
    } finally {
      setCompressingField(null)
    }
  }

  const removePhoto = (fieldKey: string, photoId: string) => {
    setForm((prev) => ({
      ...prev,
      photos: {
        ...prev.photos,
        [fieldKey]: (prev.photos[fieldKey] || []).filter((p) => p.id !== photoId),
      },
    }))
  }

  const renderPhotoPicker = (fieldKey: string) => {
    const items = form.photos[fieldKey] || []
    return (
      <div className="visit-photo-zone">
        <label className="visit-photo-trigger">
          <Camera size={14} />
          <span>{compressingField === fieldKey ? 'Comprimindo foto...' : 'Adicionar foto (opcional)'}</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={compressingField === fieldKey}
            onChange={(e) => {
              void handlePhotoUpload(fieldKey, e.target.files)
              e.currentTarget.value = ''
            }}
          />
        </label>
        {items.length > 0 && (
          <div className="visit-photo-grid">
            {items.map((p) => (
              <div className="visit-photo-thumb" key={p.id}>
                <img src={p.dataUrl} alt={p.name} />
                <button
                  type="button"
                  className="visit-photo-remove"
                  onClick={() => removePhoto(fieldKey, p.id)}
                  title="Remover foto"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const validateFields = (): string | null => {
    if (!form.inspectedEnvironments.trim()) return 'Informe quais foram os ambientes vistoriados.'
    if (!form.hasFurniture) return 'Informe se há móvel no local.'
    if (!form.needsClearance) return 'Informe se há necessidade de desobstrução.'
    if (!form.damagedFurniture) return 'Informe se há algum móvel danificado.'
    if (!form.needsMaterialPurchase) return 'Informe se há necessidade de compra de material.'
    if (form.needsMaterialPurchase === 'sim' && !form.materialPurchaseDetails.trim()) {
      return 'Informe quais materiais precisam ser comprados.'
    }
    if (form.estimatedExecutionDays === null || Number.isNaN(form.estimatedExecutionDays) || form.estimatedExecutionDays < 0) {
      return 'Informe o tempo estimado para execução do serviço (em dias).'
    }
    if (!form.standardDeliveryColor) return 'Informe se o ambiente está na cor padrão da entrega.'
    if (!form.observations.trim()) return 'Informe as observações e causas da visita.'
    return null
  }

  const handleOpenFinalize = async () => {
    const err = validateFields()
    if (err) {
      setValidationError(err)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setValidationError(null)

    try {
      const sigRes = await apiRequest<{ hasSignature: boolean; signatureBase64: string | null }>('/api/tickets/visits/my-signature')
      if (!sigRes.hasSignature || !sigRes.signatureBase64) {
        setMissingInternalSig(true)
        return
      }
      setMissingInternalSig(false)
      setInternalSigBase64(sigRes.signatureBase64)
      setClientName((prev) => prev || ticket.customerName || '')
      setFinalizeModalOpen(true)
    } catch (e) {
      onNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Erro ao verificar assinatura do perfil.' })
    }
  }

  // Canvas signature helpers
  const clearSignature = () => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasClientSignature(false)
  }

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const handleSigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pt = getCanvasPoint(e)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(pt.x, pt.y)
    isDrawingRef.current = true
  }

  const handleSigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !sigCanvasRef.current) return
    const ctx = sigCanvasRef.current.getContext('2d')
    if (!ctx) return
    const pt = getCanvasPoint(e)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    setHasClientSignature(true)
  }

  const handleSigPointerUp = () => {
    isDrawingRef.current = false
  }

  const handleConfirmFinalize = async () => {
    if (!visitId || !internalSigBase64) return
    if (!clientName.trim()) {
      onNotice({ kind: 'error', text: 'Informe o nome do cliente que acompanhou a visita.' })
      return
    }
    if (!clientDocument.trim()) {
      onNotice({ kind: 'error', text: 'Informe o número do documento do cliente.' })
      return
    }
    if (!hasClientSignature || !sigCanvasRef.current) {
      onNotice({ kind: 'error', text: 'Colete a assinatura digital do cliente na tela.' })
      return
    }

    setSubmitting(true)
    try {
      const clientSignatureDataUrl = sigCanvasRef.current.toDataURL('image/png')
      const now = new Date()
      const visitDateBr = formatDateBr(now)
      const openedDateBr = formatDateBr(ticket.openedAt) || visitDateBr

      const [declarationBytes, reportBytes] = await Promise.all([
        generateVisitDeclarationPdf({
          isTemplate: false,
          ticket,
          clientName: clientName.trim(),
          clientDocument: clientDocument.trim(),
          clientSignatureDataUrl,
          visitDateBr,
          openedDateBr,
        }),
        generateVisitReportPdf({
          ticket,
          visitData: form,
          visitDateBr,
          openedDateBr,
          clientName: clientName.trim(),
          clientDocument: clientDocument.trim(),
          clientSignatureDataUrl,
          internalUserName: currentUserName,
          internalSignatureBase64: internalSigBase64,
        }),
      ])

      const res = await apiRequest<{ visit: TicketVisitRecord }>(
        `/api/tickets/${encodeURIComponent(ticket.id)}/visits/${encodeURIComponent(visitId)}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...form,
            clientName: clientName.trim(),
            clientDocument: clientDocument.trim(),
            clientSignatureData: clientSignatureDataUrl,
            declarationPdfBase64: uint8ToBase64(declarationBytes),
            reportPdfBase64: uint8ToBase64(reportBytes),
          }),
        },
      )

      setFinalizeModalOpen(false)
      onFinalized(res.visit)
    } catch (err) {
      onNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao finalizar visita.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <ATechLoading message="Carregando formulário de visita..." />
  }

  return (
    <section className="visit-form-page">
      <div className="visit-form-topbar">
        <button type="button" className="secondary-button" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar ao chamado
        </button>

        <div className={`visit-autosave-pill ${saveState === 'saving' ? 'is-saving' : saveState === 'error' ? 'is-error' : ''}`}>
          {saveState === 'saving' ? (
            <><Loader2 size={13} className="spin" /> Salvando rascunho...</>
          ) : saveState === 'error' ? (
            <><AlertTriangle size={13} /> Erro ao salvar rascunho</>
          ) : (
            <><CheckCircle2 size={13} /> Rascunho salvo{lastSavedTime ? ` às ${lastSavedTime}` : ''}</>
          )}
        </div>
      </div>

      <div className="visit-form-header-card">
        <span className="eyebrow">CADASTRO DE VISITA TÉCNICA</span>
        <h1>Protocolo #{ticket.protocol}</h1>
        <div className="visit-form-ticket-meta">
          <span><strong>Empreendimento:</strong> {ticket.enterprise || 'Não informado'}</span>
          {ticket.block && <span><strong>Bloco:</strong> {ticket.block}</span>}
          {ticket.unit && <span><strong>Unidade:</strong> {ticket.unit}</span>}
          <span><strong>Cliente:</strong> {ticket.customerName || 'Não informado'}</span>
        </div>
      </div>

      {validationError && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={16} />
          <span>{validationError}</span>
        </div>
      )}

      {missingInternalSig && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={16} />
          <span>
            Sua assinatura digital interna não está configurada. Acesse seu <strong>Perfil</strong> (canto superior direito) para cadastrar sua assinatura antes de finalizar a visita.
          </span>
        </div>
      )}

      {/* 1 */}
      <div className="visit-question-card">
        <label className="visit-question-label">
          1. Quais foram os ambientes vistoriados? <span className="visit-required-star">*</span>
        </label>
        <textarea
          value={form.inspectedEnvironments}
          onChange={(e) => setForm((p) => ({ ...p, inspectedEnvironments: e.target.value }))}
          placeholder="Descreva os ambientes vistoriados..."
        />
        {renderPhotoPicker('inspectedEnvironments')}
      </div>

      {/* 2 */}
      <div className="visit-question-card">
        <span className="visit-question-label">
          2. Tem móvel no local? <span className="visit-required-star">*</span>
        </span>
        <div className="visit-radio-group">
          {([['sim', 'Sim'], ['nao', 'Não']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`visit-radio-option ${form.hasFurniture === val ? 'is-selected' : ''}`}
              onClick={() => setForm((p) => ({ ...p, hasFurniture: val }))}
            >
              {label}
            </button>
          ))}
        </div>
        {renderPhotoPicker('hasFurniture')}
      </div>

      {/* 3 */}
      <div className="visit-question-card">
        <span className="visit-question-label">
          3. Há necessidade de desobstrução? <span className="visit-required-star">*</span>
        </span>
        <div className="visit-radio-group">
          {([['sim', 'Sim'], ['nao', 'Não'], ['nao_se_aplica', 'Não se aplica']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`visit-radio-option ${form.needsClearance === val ? 'is-selected' : ''}`}
              onClick={() => setForm((p) => ({ ...p, needsClearance: val }))}
            >
              {label}
            </button>
          ))}
        </div>
        {renderPhotoPicker('needsClearance')}
      </div>

      {/* 4 */}
      <div className="visit-question-card">
        <span className="visit-question-label">
          4. Algum móvel danificado? <span className="visit-required-star">*</span>
        </span>
        <div className="visit-radio-group">
          {([['sim', 'Sim'], ['nao', 'Não'], ['nao_se_aplica', 'Não se aplica']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`visit-radio-option ${form.damagedFurniture === val ? 'is-selected' : ''}`}
              onClick={() => setForm((p) => ({ ...p, damagedFurniture: val }))}
            >
              {label}
            </button>
          ))}
        </div>
        {renderPhotoPicker('damagedFurniture')}
      </div>

      {/* 5 */}
      <div className="visit-question-card">
        <span className="visit-question-label">
          5. Necessidade de compra de material? <span className="visit-required-star">*</span>
        </span>
        <div className="visit-radio-group">
          {([['sim', 'Sim'], ['nao', 'Não']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`visit-radio-option ${form.needsMaterialPurchase === val ? 'is-selected' : ''}`}
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  needsMaterialPurchase: val,
                  materialPurchaseDetails: val === 'nao' ? '' : p.materialPurchaseDetails,
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
        {renderPhotoPicker('needsMaterialPurchase')}
      </div>

      {/* 6 */}
      <div className="visit-question-card">
        <label className="visit-question-label">
          6. Se sim, quais? {form.needsMaterialPurchase === 'sim' && <span className="visit-required-star">*</span>}
        </label>
        <textarea
          value={form.materialPurchaseDetails}
          disabled={form.needsMaterialPurchase === 'nao'}
          onChange={(e) => setForm((p) => ({ ...p, materialPurchaseDetails: e.target.value }))}
          placeholder={
            form.needsMaterialPurchase === 'nao'
              ? 'Não se aplica (sem necessidade de compra de material)'
              : 'Liste os materiais necessários...'
          }
        />
        {renderPhotoPicker('materialPurchaseDetails')}
      </div>

      {/* 7 */}
      <div className="visit-question-card">
        <label className="visit-question-label">
          7. Qual o tempo estimado para execução do serviço? (Número de dias) <span className="visit-required-star">*</span>
        </label>
        <input
          type="number"
          min={0}
          max={3650}
          value={form.estimatedExecutionDays ?? ''}
          onChange={(e) =>
            setForm((p) => ({
              ...p,
              estimatedExecutionDays: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10)),
            }))
          }
          placeholder="Ex.: 2"
        />
        {renderPhotoPicker('estimatedExecutionDays')}
      </div>

      {/* 8 */}
      <div className="visit-question-card">
        <span className="visit-question-label">
          8. O ambiente está na cor padrão da entrega? <span className="visit-required-star">*</span>
        </span>
        <div className="visit-radio-group">
          {([['sim', 'Sim'], ['nao', 'Não'], ['nao_se_aplica', 'Não se aplica']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`visit-radio-option ${form.standardDeliveryColor === val ? 'is-selected' : ''}`}
              onClick={() => setForm((p) => ({ ...p, standardDeliveryColor: val }))}
            >
              {label}
            </button>
          ))}
        </div>
        {renderPhotoPicker('standardDeliveryColor')}
      </div>

      {/* 9 */}
      <div className="visit-question-card">
        <label className="visit-question-label">
          9. Observações, causas da visita, etc. <span className="visit-required-star">*</span>
        </label>
        <textarea
          value={form.observations}
          onChange={(e) => setForm((p) => ({ ...p, observations: e.target.value }))}
          placeholder="Descreva as causas identificadas, observações técnicas e encaminhamentos..."
        />
        {renderPhotoPicker('observations')}
      </div>

      <div className="visit-form-actions">
        <button type="button" className="secondary-button" onClick={onBack}>
          Voltar (manter rascunho)
        </button>
        <button type="button" className="primary-button" onClick={() => void handleOpenFinalize()}>
          <PenTool size={16} /> Finalizar Visita e Coletar Assinatura
        </button>
      </div>

      {finalizeModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Finalizar Visita Técnica">
          <div className="modal" style={{ maxWidth: '520px', width: '100%' }}>
            <header className="dialog-header">
              <div>
                <h2>Finalizar Visita Técnica</h2>
                <p>Informe os dados do cliente que acompanhou a visita para gerar a Declaração (AT001) e o Relatório de Vistoria (AT002).</p>
              </div>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              <label className="ticket-form-field">
                <span>Nome do cliente que acompanhou a visita *</span>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome completo do cliente"
                />
              </label>
              <label className="ticket-form-field">
                <span>Número do documento (RG ou CPF) *</span>
                <input
                  type="text"
                  value={clientDocument}
                  onChange={(e) => setClientDocument(e.target.value)}
                  placeholder="Ex.: 000.000.000-00"
                />
              </label>
              <div className="ticket-form-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Assinatura digital do cliente *</span>
                  <button type="button" className="text-action-btn" onClick={clearSignature}>
                    Limpar assinatura
                  </button>
                </div>
                <div className="visit-signature-pad-wrap">
                  <canvas
                    ref={sigCanvasRef}
                    width={460}
                    height={170}
                    className="visit-signature-canvas"
                    onPointerDown={handleSigPointerDown}
                    onPointerMove={handleSigPointerMove}
                    onPointerUp={handleSigPointerUp}
                    onPointerCancel={handleSigPointerUp}
                  />
                </div>
              </div>
            </div>
            <footer className="dialog-footer" style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="secondary-button" disabled={submitting} onClick={() => setFinalizeModalOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="primary-button" disabled={submitting} onClick={() => void handleConfirmFinalize()}>
                {submitting ? 'Gerando PDFs e salvando...' : 'Confirmar e Finalizar Visita'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
