import { useEffect, useState } from 'react'
import { Check, CircleAlert, Clock, Save, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './SessionTimeoutSettings.css'

interface TimeoutResponse {
  timeoutMinutes: number
  updatedAt: string | null
  updatedByName: string | null
}

const PRESET_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora (padrão)' },
  { value: 120, label: '2 horas' },
  { value: 240, label: '4 horas' },
  { value: 480, label: '8 horas' },
]

export default function SessionTimeoutSettings() {
  const [currentTimeout, setCurrentTimeout] = useState(60)
  const [selectedTimeout, setSelectedTimeout] = useState(60)
  const [isCustom, setIsCustom] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [updatedByName, setUpdatedByName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiRequest<TimeoutResponse>('/api/settings/session-timeout')
      .then((data) => {
        if (cancelled) return
        setCurrentTimeout(data.timeoutMinutes)
        setSelectedTimeout(data.timeoutMinutes)
        setUpdatedAt(data.updatedAt)
        setUpdatedByName(data.updatedByName)

        const isPreset = PRESET_OPTIONS.some((opt) => opt.value === data.timeoutMinutes)
        if (isPreset) {
          setIsCustom(false)
          setCustomValue('')
        } else {
          setIsCustom(true)
          setCustomValue(String(data.timeoutMinutes))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useLiveSync(['settings'], () => {
    setRefreshKey((k) => k + 1)
  })

  const handleSelectPreset = (minutes: number) => {
    setIsCustom(false)
    setSelectedTimeout(minutes)
    setNotice(null)
  }

  const handleCustomChange = (value: string) => {
    setCustomValue(value)
    const num = Number.parseInt(value, 10)
    if (!Number.isNaN(num) && num >= 15 && num <= 10080) {
      setSelectedTimeout(num)
    }
  }

  const handleSave = async () => {
    let targetMinutes = selectedTimeout
    if (isCustom) {
      const parsed = Number.parseInt(customValue, 10)
      if (Number.isNaN(parsed) || parsed < 15 || parsed > 10080) {
        setNotice({ kind: 'error', text: 'Informe um tempo customizado entre 15 e 10.080 minutos (7 dias).' })
        return
      }
      targetMinutes = parsed
    }

    setSaving(true)
    setNotice(null)

    try {
      const result = await apiRequest<{ success: boolean; timeoutMinutes: number; updatedAt: string; updatedByName: string }>(
        '/api/settings/session-timeout',
        {
          method: 'PUT',
          body: JSON.stringify({ timeoutMinutes: targetMinutes }),
        },
      )
      setCurrentTimeout(result.timeoutMinutes)
      setSelectedTimeout(result.timeoutMinutes)
      setUpdatedAt(result.updatedAt)
      setUpdatedByName(result.updatedByName)
      setNotice({
        kind: 'success',
        text: `Tempo limite de sessão atualizado para ${result.timeoutMinutes} minutos (${Math.round((result.timeoutMinutes / 60) * 10) / 10}h).`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível salvar o tempo de sessão.',
      })
    } finally {
      setSaving(false)
    }
  }

  const formatTimeoutDescription = (mins: number) => {
    if (mins < 60) return `${mins} minutos`
    const hours = mins / 60
    if (Number.isInteger(hours)) return `${hours} ${hours === 1 ? 'hora' : 'horas'}`
    return `${Math.floor(hours)}h ${mins % 60}min`
  }

  const hasChanges = isCustom
    ? Number.parseInt(customValue, 10) !== currentTimeout
    : selectedTimeout !== currentTimeout

  return (
    <section className="session-timeout-card" aria-labelledby="session-timeout-heading">
      <div className="session-timeout-header">
        <div className="session-timeout-title-group">
          <span className="session-timeout-icon">
            <Clock size={18} />
          </span>
          <div>
            <h2 id="session-timeout-heading">Tempo limite de sessão & segurança</h2>
            <p>
              Defina o tempo máximo de inatividade antes de deslogar o usuário e exigir nova autenticação.
            </p>
          </div>
        </div>
        <div className="session-timeout-status-badge">
          <ShieldCheck size={14} />
          <span>Ativo: <strong>{formatTimeoutDescription(currentTimeout)}</strong></span>
        </div>
      </div>

      {notice && (
        <div className={`session-timeout-notice notice-${notice.kind}`} role="status">
          <span className="notice-symbol">
            {notice.kind === 'success' ? <Check size={15} /> : <CircleAlert size={15} />}
          </span>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <div className="session-timeout-body">
        <label className="session-timeout-label">Selecione o intervalo de expiração</label>
        <div className="session-timeout-presets">
          {PRESET_OPTIONS.map((opt) => {
            const isSelected = !isCustom && selectedTimeout === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                className={`session-preset-btn ${isSelected ? 'session-preset-active' : ''}`}
                onClick={() => handleSelectPreset(opt.value)}
                disabled={loading || saving}
              >
                {isSelected && <Check size={13} className="session-preset-check" />}
                {opt.label}
              </button>
            )
          })}
          <button
            type="button"
            className={`session-preset-btn ${isCustom ? 'session-preset-active' : ''}`}
            onClick={() => {
              setIsCustom(true)
              setCustomValue(String(selectedTimeout))
            }}
            disabled={loading || saving}
          >
            {isCustom && <Check size={13} className="session-preset-check" />}
            Personalizado
          </button>
        </div>

        {isCustom && (
          <div className="session-custom-row">
            <label htmlFor="session-custom-input">Minutos de inatividade (15 a 10.080):</label>
            <div className="session-custom-input-wrap">
              <input
                id="session-custom-input"
                type="number"
                min="15"
                max="10080"
                step="5"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="Ex: 90"
              />
              <span className="session-custom-suffix">minutos</span>
            </div>
            {Number.parseInt(customValue, 10) >= 60 && (
              <span className="session-custom-hint">
                ≈ {Math.round((Number.parseInt(customValue, 10) / 60) * 10) / 10} horas
              </span>
            )}
          </div>
        )}
      </div>

      <div className="session-timeout-footer">
        <div className="session-timeout-meta">
          {updatedAt && (
            <span>
              Última alteração em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(updatedAt))}
              {updatedByName ? ` por ${updatedByName}` : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          className="primary-button session-timeout-save"
          onClick={() => void handleSave()}
          disabled={!hasChanges || saving || loading}
        >
          <Save size={15} />
          {saving ? 'Salvando...' : 'Salvar tempo de sessão'}
        </button>
      </div>
    </section>
  )
}
