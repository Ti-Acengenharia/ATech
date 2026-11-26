import { useEffect, useState } from 'react'
import { Check, CircleAlert, FileCheck2, Power, Save, Shield } from 'lucide-react'
import { apiRequest } from './api/client'
import './CvcrmProgrammingSyncSettings.css'

type VisitDocumentVisibility = 'private' | 'public'

interface CvcrmVisitSyncSettingsData {
  enabled: boolean
  declarationVisibility: VisitDocumentVisibility
  reportVisibility: VisitDocumentVisibility
}

export default function CvcrmVisitSyncSettings() {
  const [data, setData] = useState<CvcrmVisitSyncSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        setLoading(true)
        const res = await apiRequest<CvcrmVisitSyncSettingsData>('/api/settings/cvcrm-visit-sync')
        if (active) setData(res)
      } catch (err) {
        if (active) {
          setFeedback({
            kind: 'error',
            text: err instanceof Error ? err.message : 'Erro ao carregar configuração de visitas CVCRM.',
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const saveSettings = async (next: CvcrmVisitSyncSettingsData, successMessage: string) => {
    setSaving(true)
    setFeedback(null)
    try {
      const updated = await apiRequest<CvcrmVisitSyncSettingsData & { success: boolean }>(
        '/api/settings/cvcrm-visit-sync',
        {
          method: 'PUT',
          body: JSON.stringify(next),
        },
      )
      setData({
        enabled: updated.enabled,
        declarationVisibility: updated.declarationVisibility,
        reportVisibility: updated.reportVisibility,
      })
      setFeedback({ kind: 'success', text: successMessage })
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao salvar configuração.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading || !data) return null

  return (
    <section className="cvcrm-prog-sync-settings-card" aria-labelledby="cvcrm-visit-sync-heading">
      <div className="cvcrm-prog-sync-header">
        <div className="cvcrm-prog-sync-title-row">
          <div className="cvcrm-prog-sync-icon">
            <FileCheck2 size={19} />
          </div>
          <div>
            <div className="cvcrm-prog-sync-title-badges">
              <h3 id="cvcrm-visit-sync-heading">Envio Automático de Visitas Técnicas no CVCRM</h3>
              <span className={`cvcrm-prog-sync-badge ${data.enabled ? 'is-auto-on' : 'is-auto-off'}`}>
                {data.enabled ? 'Envio Automático Ativo' : 'Envio Automático Pausado'}
              </span>
            </div>
            <p>
              Controla o envio automático da Declaração de Visita Técnica (AT001) e do Relatório de Vistoria (AT002)
              em comentários separados ao Construtor de Vendas quando uma visita é finalizada.
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div className={`cvcrm-prog-sync-notice is-${feedback.kind}`} role="status">
          {feedback.kind === 'success' ? <Check size={15} /> : <CircleAlert size={15} />}
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Fechar">
            ×
          </button>
        </div>
      )}

      <div className="cvcrm-prog-sync-controls-grid">
        <div className={`cvcrm-prog-sync-toggle-box ${data.enabled ? 'is-enabled' : 'is-disabled'}`}>
          <div className="cvcrm-prog-sync-toggle-info">
            <div className="cvcrm-prog-sync-toggle-icon">
              <Power size={18} />
            </div>
            <div>
              <strong>Envio Automático de Visitas</strong>
              <p>
                {data.enabled
                  ? 'Ao finalizar o Cadastro de Visita, o sistema enviará automaticamente os 2 PDFs em comentários separados no chamado correspondente no CVCRM.'
                  : 'O envio automático está desativado. Os PDFs serão salvos apenas no ATech, podendo ser enviados manualmente depois.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`cvcrm-prog-sync-toggle-btn ${data.enabled ? 'is-on' : 'is-off'}`}
            disabled={saving}
            onClick={() =>
              void saveSettings(
                { ...data, enabled: !data.enabled },
                !data.enabled
                  ? 'Envio automático de visitas ao CVCRM ativado.'
                  : 'Envio automático de visitas ao CVCRM desativado.',
              )
            }
          >
            <Power size={14} />
            {data.enabled ? 'Desativar Envio' : 'Ativar Envio'}
          </button>
        </div>

        <div className="cvcrm-prog-sync-time-box" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', fontSize: '12.5px', fontWeight: 700 }}>
            <Shield size={15} />
            <span>Visibilidade dos Comentários no CVCRM</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
            <label className="ticket-form-field" style={{ margin: 0 }}>
              <span>Declaração de Visita (AT001)</span>
              <select
                value={data.declarationVisibility}
                disabled={saving}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, declarationVisibility: e.target.value === 'public' ? 'public' : 'private' } : prev,
                  )
                }
              >
                <option value="private">Privado (Interno)</option>
                <option value="public">Público (Cliente vê)</option>
              </select>
            </label>

            <label className="ticket-form-field" style={{ margin: 0 }}>
              <span>Relatório de Vistoria (AT002)</span>
              <select
                value={data.reportVisibility}
                disabled={saving}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, reportVisibility: e.target.value === 'public' ? 'public' : 'private' } : prev,
                  )
                }
              >
                <option value="private">Privado (Interno)</option>
                <option value="public">Público (Cliente vê)</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="primary-button"
              style={{ minHeight: '34px', fontSize: '12px' }}
              disabled={saving}
              onClick={() => void saveSettings(data, 'Visibilidade dos documentos de visita salva com sucesso.')}
            >
              <Save size={14} /> {saving ? 'Salvando...' : 'Salvar visibilidade'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
