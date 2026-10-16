import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { KeyRound, LogOut, RotateCcw, Save, ShieldCheck, X } from 'lucide-react'
import { apiRequest } from './api/client'

interface UserProfile {
  displayName: string
  jobTitle: string
  hasSignature: boolean
  hasPin: boolean
}

export default function UserProfileModal({
  onClose,
  onSaved,
  onSignOut,
}: {
  onClose: () => void
  onSaved: (displayName: string) => void
  onSignOut: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const ink = useRef(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [signatureBase64, setSignatureBase64] = useState<string | null>(null)
  const [signatureAuthorized, setSignatureAuthorized] = useState(false)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingSignature, setSavingSignature] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiRequest<UserProfile>('/api/profile')
      .then((result) => {
        if (cancelled) return
        setProfile(result)
        setDisplayName(result.displayName)
        setJobTitle(result.jobTitle)
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar seu perfil.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    if (!signatureAuthorized || !signatureBase64) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    const image = new Image()
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height)
    image.onerror = () => setError('Não foi possível carregar a assinatura salva.')
    image.src = `data:image/png;base64,${signatureBase64}`
  }, [signatureAuthorized, signatureBase64])

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
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.beginPath()
    context.moveTo(position.x, position.y)
    setSignatureBase64(null)
    drawing.current = true
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    const position = point(event)
    if (!context || !position) return
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#183f70'
    context.lineTo(position.x, position.y)
    context.stroke()
    ink.current = true
  }

  function stopDrawing() {
    if (!drawing.current) return
    drawing.current = false
    if (!ink.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    setSignatureBase64(canvas.toDataURL('image/png').split(',')[1] ?? null)
    ink.current = false
  }

  function clearSignature() {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, 720, 180)
    ink.current = false
    setSignatureBase64(null)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    setSavingProfile(true)
    setError('')
    try {
      const result = await apiRequest<{ displayName: string }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, jobTitle }),
      })
      onSaved(result.displayName)
      setProfile((current) => current ? { ...current, displayName: result.displayName, jobTitle } : current)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar seu perfil.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function unlockSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    setSavingSignature(true)
    setError('')
    try {
      if (!profile.hasPin) {
        if (!/^\d{6,12}$/.test(newPin) || newPin !== confirmPin) {
          throw new Error('Crie e confirme um PIN numérico de 6 a 12 dígitos.')
        }
        await apiRequest('/api/profile/signature', {
          method: 'PUT',
          body: JSON.stringify({ newPin, signatureBase64: null }),
        })
        setProfile((current) => current ? { ...current, hasPin: true } : current)
        setPin(newPin)
      }

      const result = await apiRequest<{ signatureBase64: string | null }>('/api/profile/signature/unlock', {
        method: 'POST',
        body: JSON.stringify({ pin: profile.hasPin ? pin : newPin }),
      })
      setSignatureBase64(result.signatureBase64)
      setSignatureAuthorized(true)
      setPin(profile.hasPin ? pin : newPin)
      setNewPin('')
      setConfirmPin('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível desbloquear sua assinatura.')
    } finally {
      setSavingSignature(false)
    }
  }

  async function saveSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !signatureAuthorized) return
    if (newPin && (!/^\d{6,12}$/.test(newPin) || newPin !== confirmPin)) {
      setError('O novo PIN deve ter de 6 a 12 números e corresponder à confirmação.')
      return
    }
    if (!signatureBase64 && !window.confirm('Remover a assinatura salva?')) return

    setSavingSignature(true)
    setError('')
    try {
      await apiRequest('/api/profile/signature', {
        method: 'PUT',
        body: JSON.stringify({ pin, newPin: newPin || undefined, signatureBase64 }),
      })
      setProfile((current) => current ? { ...current, hasSignature: Boolean(signatureBase64), hasPin: true } : current)
      setPin(newPin || pin)
      setNewPin('')
      setConfirmPin('')
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar sua assinatura.')
    } finally {
      setSavingSignature(false)
    }
  }

  return (
    <div className="profile-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-heading">
        <header className="profile-modal-header">
          <div><span className="eyebrow">MINHA CONTA</span><h2 id="profile-modal-heading">Editar perfil</h2><p>Seu nome e cargo aparecem no espaço de trabalho.</p></div>
          <button type="button" className="close-modal-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="profile-modal-form">
          {loading ? <p className="profile-modal-loading">Carregando perfil...</p> : <>
            <form className="profile-modal-fields" onSubmit={(event) => void saveProfile(event)}>
              <label className="ticket-form-field"><span>Nome</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} autoComplete="name" required /></label>
              <label className="ticket-form-field"><span>Cargo</span><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={120} placeholder="Ex.: Técnico de assistência" /></label>
              <button type="submit" className="secondary-button profile-save-details" disabled={savingProfile || !displayName.trim()}><Save size={14} /> {savingProfile ? 'Salvando...' : 'Salvar nome e cargo'}</button>
            </form>
            <section className="profile-signature-field">
              <div className="profile-signature-heading"><div><strong>Assinatura protegida</strong><small>O PIN é exigido para visualizar, alterar ou usar a assinatura em um termo.</small></div><ShieldCheck size={17} /></div>
              {!signatureAuthorized ? (
                <form className="profile-pin-form" onSubmit={(event) => void unlockSignature(event)}>
                  {!profile?.hasPin ? <>
                    {profile?.hasSignature && <p className="profile-pin-note">Há uma assinatura salva. Crie um PIN para protegê-la antes de visualizá-la.</p>}
                    <label className="ticket-form-field"><span>Criar PIN numérico (6 a 12 dígitos)</span><input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" maxLength={12} value={newPin} onChange={(event) => setNewPin(event.target.value)} required /></label>
                    <label className="ticket-form-field"><span>Confirmar PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" maxLength={12} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required /></label>
                  </> : <label className="ticket-form-field"><span>PIN da assinatura</span><input type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6,12}" maxLength={12} value={pin} onChange={(event) => setPin(event.target.value)} required /></label>}
                  <button type="submit" className="secondary-button" disabled={savingSignature || (profile?.hasPin ? !pin : !newPin || !confirmPin)}><KeyRound size={14} /> {savingSignature ? 'Verificando...' : profile?.hasPin ? 'Desbloquear assinatura' : 'Criar PIN e continuar'}</button>
                </form>
              ) : (
                <form className="profile-signature-editor" onSubmit={(event) => void saveSignature(event)}>
                  <canvas ref={canvasRef} width={720} height={180} aria-label="Sua assinatura" onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} />
                  <small>{signatureBase64 ? 'Assinatura carregada; desenhe na área para substituí-la.' : 'Assine com o mouse ou toque nesta área.'}</small>
                  <div className="profile-signature-actions"><button type="button" className="text-action-btn danger-action" onClick={clearSignature}><RotateCcw size={13} /> Limpar assinatura</button><button type="button" className="text-action-btn" onClick={() => { setSignatureAuthorized(false); setSignatureBase64(null); setPin('') }}>Bloquear</button></div>
                  <label className="ticket-form-field"><span>Alterar PIN (opcional)</span><input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" maxLength={12} value={newPin} onChange={(event) => setNewPin(event.target.value)} placeholder="De 6 a 12 números" /></label>
                  {newPin && <label className="ticket-form-field"><span>Confirmar novo PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" maxLength={12} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required /></label>}
                  <button type="submit" className="secondary-button" disabled={savingSignature || (Boolean(newPin) && newPin !== confirmPin)}><Save size={14} /> {savingSignature ? 'Salvando...' : 'Salvar assinatura e PIN'}</button>
                </form>
              )}
            </section>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="profile-modal-actions">
            <button type="button" className="secondary-button profile-signout" onClick={onSignOut}><LogOut size={14} /> Sair da conta</button>
            <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
          </footer>
        </div>
      </section>
    </div>
  )
}
