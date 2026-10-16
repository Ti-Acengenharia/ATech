import { useEffect, useRef, useState, type PointerEvent, type FormEvent } from 'react'
import { ArrowLeft, Download, FileSignature, KeyRound, PenLine, RotateCcw, X } from 'lucide-react'
import { apiRequest } from '../api/client'
import type { TicketSummary } from './types'
import { createCompletionTermPdf } from './completion-term-pdf'

function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function SignaturePad({ label, onChange }: { label: string; onChange: (signature: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const ink = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    }
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const position = point(event)
    if (!canvas || !context || !position) return
    canvas.setPointerCapture(event.pointerId)
    context.beginPath()
    context.moveTo(position.x, position.y)
    drawing.current = true
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    const position = point(event)
    if (!context || !position) return
    context.lineWidth = 2.5
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#183f70'
    context.lineTo(position.x, position.y)
    context.stroke()
    ink.current = true
  }

  function stopDrawing() {
    drawing.current = false
    if (!ink.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    setHasInk(true)
    onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    ink.current = false
    setHasInk(false)
    onChange('')
  }

  return (
    <div className="completion-signature-pad">
      <div className="completion-signature-heading"><strong>{label}</strong><button type="button" className="text-action-btn" onClick={clear}><RotateCcw size={13} /> Limpar</button></div>
      <canvas
        ref={canvasRef}
        width={720}
        height={180}
        aria-label={`Assinatura de ${label}`}
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <small>{hasInk ? 'Assinatura desenhada' : 'Assine com o mouse ou toque nesta área'}</small>
    </div>
  )
}

export default function CompletionTermModal({
  ticket,
  currentUserName,
  onClose,
  onSaveSignedPdf,
}: {
  ticket: TicketSummary
  currentUserName: string
  onClose: () => void
  onSaveSignedPdf: (bytes: Uint8Array, fileName: string) => Promise<void>
}) {
  const [stage, setStage] = useState<'details' | 'pin' | 'sign'>('details')
  const [serviceStartDate, setServiceStartDate] = useState(localDate)
  const [activities, setActivities] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientDocument, setClientDocument] = useState('')
  const [profile, setProfile] = useState<{ hasPin: boolean; hasSignature: boolean } | null>(null)
  const [pin, setPin] = useState('')
  const [profileSignature, setProfileSignature] = useState<string | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [clientSignature, setClientSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiRequest<{ hasPin: boolean; hasSignature: boolean }>('/api/profile')
      .then((profile) => {
        if (!cancelled) setProfile(profile)
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a assinatura do perfil.')
      })
      .finally(() => { if (!cancelled) setProfileLoaded(true) })
    return () => { cancelled = true }
  }, [])

  function saveSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileLoaded || !profile) {
      setError('Aguarde o carregamento das configurações da assinatura.')
      return
    }
    if (!profile.hasPin || !profile.hasSignature) {
      setError('Cadastre um PIN e uma assinatura no seu perfil antes de gerar um documento assinado.')
      return
    }
    setError('')
    setStage('pin')
  }

  async function unlockForSigning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ signatureBase64: string | null }>('/api/profile/signature/unlock', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      })
      if (!result.signatureBase64) {
        throw new Error('Não há assinatura salva. Cadastre uma assinatura no seu perfil.')
      }
      setProfileSignature(result.signatureBase64)
      setStage('sign')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível validar o PIN.')
    } finally {
      setBusy(false)
    }
  }

  async function createPdf(signed: boolean) {
    setBusy(true)
    setError('')
    let openedWindow: Window | null = null
    if (signed) openedWindow = window.open('', '_blank')
    try {
      const bytes = await createCompletionTermPdf(ticket, {
        serviceStartDate,
        activities: activities.trim(),
        clientName: clientName.trim(),
        clientDocument: clientDocument.trim(),
        ...(signed ? {
          engineeringSignature: `data:image/png;base64,${profileSignature}`,
          clientSignature,
        } : {}),
      })
      const output = new Uint8Array(bytes.length)
      output.set(bytes)
      const blob = new Blob([output.buffer], { type: 'application/pdf' })
      const fileName = `termo-finalizacao-${ticket.protocol}${signed ? '-assinado' : ''}.pdf`
      if (signed) await onSaveSignedPdf(output, fileName)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      if (signed && openedWindow) openedWindow.location.href = url
      else if (signed) window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      onClose()
    } catch (requestError) {
      openedWindow?.close()
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível gerar o termo de finalização.')
    } finally {
      setBusy(false)
    }
  }

  const signaturesReady = Boolean(profileSignature && clientSignature)

  return (
    <div className="completion-term-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="completion-term-modal" role="dialog" aria-modal="true" aria-labelledby="completion-term-heading">
        <header className="completion-term-header">
          <div><span className="eyebrow">PROTOCOLO #{ticket.protocol}</span><h2 id="completion-term-heading">{stage === 'details' ? 'Termo de finalização' : 'Assinar documento'}</h2><p>{ticket.enterprise || 'Empreendimento não informado'}{ticket.block ? ` · Bloco ${ticket.block}` : ''}{ticket.unit ? ` · Unidade ${ticket.unit}` : ''}</p></div>
          <button type="button" className="close-modal-btn" onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </header>
        {stage === 'details' ? (
          <form className="completion-term-form" onSubmit={saveSignature}>
            <div className="completion-term-auto-fields"><span><small>Empreendimento</small><strong>{ticket.enterprise || 'Não informado'}</strong></span><span><small>Bloco</small><strong>{ticket.block || 'Não informado'}</strong></span><span><small>Unidade</small><strong>{ticket.unit || 'Não informado'}</strong></span><span><small>Protocolo</small><strong>{ticket.protocol}</strong></span></div>
            <label className="ticket-form-field"><span>Data do início do serviço</span><input type="date" value={serviceStartDate} onChange={(event) => setServiceStartDate(event.target.value)} required /></label>
            <label className="ticket-form-field"><span>Atividades realizadas</span><textarea value={activities} onChange={(event) => setActivities(event.target.value)} maxLength={2500} rows={6} placeholder="Descreva os serviços executados" required /></label>
            <div className="completion-term-client-fields">
              <label className="ticket-form-field"><span>Nome do cliente</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={160} placeholder="Nome completo" required /></label>
              <label className="ticket-form-field"><span>RG/CPF do cliente</span><input value={clientDocument} onChange={(event) => setClientDocument(event.target.value)} maxLength={32} placeholder="Documento" required /></label>
            </div>
            {profileLoaded && (!profile?.hasPin || !profile?.hasSignature) && <p className="completion-profile-hint">Para assinar digitalmente, feche este formulário e cadastre uma assinatura protegida por PIN clicando no seu nome no menu lateral. Ela aparecerá no documento como AC Engenharia.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <footer className="completion-term-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="button" className="secondary-button" disabled={busy || !serviceStartDate || !activities.trim() || !clientName.trim() || !clientDocument.trim()} onClick={() => void createPdf(false)}><Download size={15} /> {busy ? 'Gerando...' : 'Baixar Termo'}</button>
              <button type="submit" className="primary-button" disabled={busy || !serviceStartDate || !activities.trim() || !clientName.trim() || !clientDocument.trim() || !profileLoaded}><FileSignature size={15} /> Assinar documento</button>
            </footer>
          </form>
        ) : stage === 'pin' ? (
          <form className="completion-term-form" onSubmit={(event) => void unlockForSigning(event)}>
            <button type="button" className="completion-back-button" onClick={() => { setStage('details'); setPin('') }}><ArrowLeft size={14} /> Voltar aos dados do termo</button>
            <p className="completion-sign-intro"><PenLine size={15} /> Confirme seu PIN para usar a assinatura protegida de {currentUserName} no campo AC Engenharia.</p>
            <label className="ticket-form-field"><span>PIN da assinatura</span><input type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6,12}" maxLength={12} value={pin} onChange={(event) => setPin(event.target.value)} required autoFocus /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <footer className="completion-term-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={busy || !/^\d{6,12}$/.test(pin)}><KeyRound size={14} /> {busy ? 'Verificando PIN...' : 'Desbloquear assinatura'}</button>
            </footer>
          </form>
        ) : (
          <form className="completion-term-form" onSubmit={(event) => { event.preventDefault(); void createPdf(true) }}>
            <button type="button" className="completion-back-button" onClick={() => setStage('details')}><ArrowLeft size={14} /> Voltar aos dados do termo</button>
            <p className="completion-sign-intro"><PenLine size={15} /> A assinatura salva no perfil de {currentUserName} será aplicada como assinatura da AC Engenharia. Agora, colete a assinatura do cliente.</p>
            <div className="completion-sign-grid completion-sign-grid-client">
              <section className="completion-signer">
                <h3>Cliente · {clientName} · RG/CPF {clientDocument}</h3>
                <SignaturePad label="Assinatura do cliente" onChange={setClientSignature} />
              </section>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <footer className="completion-term-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={busy || !signaturesReady || !clientName.trim() || !clientDocument.trim()}><FileSignature size={15} /> {busy ? 'Gerando documento...' : 'Gerar documento assinado'}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
