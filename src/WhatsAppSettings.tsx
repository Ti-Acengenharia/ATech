import { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  Key,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Phone,
  Radio,
  Save,
  Send,
  Users,
  XCircle,
} from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './WhatsAppSettings.css'

interface WhatsAppSettingsData {
  apiUrl: string
  hasApiKey: boolean
  instanceName: string
  programmingGroupJid: string
  foremanPhoneNumber: string
  autoDispatchEnabled: boolean
  isConfigured: boolean
  updatedAt: string | null
  updatedByName: string | null
  lastAutoDispatchDate: string | null
}

export default function WhatsAppSettings() {
  const [data, setData] = useState<WhatsAppSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [showTestSend, setShowTestSend] = useState(false)
  const [testTarget, setTestTarget] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [connectionState, setConnectionState] = useState<string | null>(null)

  // Campos do formulário
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [programmingGroupJid, setProgrammingGroupJid] = useState('')
  const [foremanPhoneNumber, setForemanPhoneNumber] = useState('')
  const [autoDispatchEnabled, setAutoDispatchEnabled] = useState(true)

  const loadSettings = async () => {
    try {
      const res = await apiRequest<WhatsAppSettingsData>('/api/settings/whatsapp')
      setData(res)
      setApiUrl(res.apiUrl || '')
      setApiKey('') // Chave fica em branco a menos que o usuário queira trocar
      setInstanceName(res.instanceName || '')
      setProgrammingGroupJid(res.programmingGroupJid || '')
      setForemanPhoneNumber(res.foremanPhoneNumber || '')
      setAutoDispatchEnabled(res.autoDispatchEnabled ?? true)
    } catch {
      // Se não autenticado ou erro na carga inicial
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  useLiveSync(['settings'], () => {
    void loadSettings()
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setNotice(null)

    try {
      const payload: Record<string, unknown> = {
        apiUrl,
        instanceName,
        programmingGroupJid,
        foremanPhoneNumber,
        autoDispatchEnabled,
      }
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim()
      }

      const updated = await apiRequest<WhatsAppSettingsData>('/api/settings/whatsapp', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })

      setData(updated)
      setApiKey('')
      setNotice({
        kind: 'success',
        text: 'Configurações do WhatsApp salvas com sucesso!',
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao salvar configurações do WhatsApp.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setNotice(null)
    try {
      const res = await apiRequest<{ ok: boolean; state?: string; message: string }>(
        '/api/settings/whatsapp/test-connection',
        { method: 'POST' },
      )
      setConnectionState(res.state || (res.ok ? 'open' : 'disconnected'))
      setNotice({
        kind: res.ok ? 'success' : 'error',
        text: res.message,
      })
    } catch (err) {
      setConnectionState('error')
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao testar conexão com a Evolution API.',
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleTestSend = async () => {
    if (!testTarget.trim()) {
      setNotice({ kind: 'error', text: 'Informe o número ou ID do grupo para o teste de envio.' })
      return
    }

    setTestSending(true)
    setNotice(null)
    try {
      const res = await apiRequest<{ success: boolean; message: string }>('/api/settings/whatsapp/test-send', {
        method: 'POST',
        body: JSON.stringify({
          target: testTarget.trim(),
          message: testMessage.trim() || 'Teste de envio pelo ATech via Evolution API',
        }),
      })
      setNotice({ kind: 'success', text: res.message })
      setShowTestSend(false)
      setTestMessage('')
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao enviar mensagem de teste.',
      })
    } finally {
      setTestSending(false)
    }
  }

  if (loading) {
    return (
      <div className="whatsapp-settings-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
          <Loader2 className="animate-spin" size={16} /> Carregando integração do WhatsApp...
        </div>
      </div>
    )
  }

  const isConfigured = Boolean(data?.apiUrl && data?.hasApiKey && data?.instanceName)

  return (
    <section className="whatsapp-settings-card" aria-labelledby="whatsapp-settings-heading">
      <header className="whatsapp-settings-header">
        <div className="whatsapp-settings-title-group">
          <span className="whatsapp-settings-icon">
            <MessageSquare size={20} />
          </span>
          <div>
            <h2 id="whatsapp-settings-heading">
              Integração WhatsApp · Evolution API
            </h2>
            <p>
              Envio automatizado de programações em PDF para grupo de campo e encarregados via Gateway Evolution API.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isConfigured ? (
            <span
              className={`whatsapp-status-badge ${
                connectionState === 'open'
                  ? 'connected'
                  : connectionState
                    ? 'disconnected'
                    : 'connected'
              }`}
            >
              {connectionState === 'open' ? (
                <>
                  <CheckCircle2 size={13} /> Conectado ({data?.instanceName})
                </>
              ) : connectionState ? (
                <>
                  <Radio size={13} /> Status: {connectionState}
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> Configurado
                </>
              )}
            </span>
          ) : (
            <span className="whatsapp-status-badge unconfigured">
              <XCircle size={13} /> Não configurado
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className={`whatsapp-notice notice-${notice.kind}`} role="status">
          {notice.kind === 'success' ? (
            <Check size={16} />
          ) : notice.kind === 'info' ? (
            <Clock size={16} />
          ) : (
            <CircleAlert size={16} />
          )}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="whatsapp-form-grid">
          <div className="whatsapp-field">
            <label htmlFor="evo-api-url">
              <LinkIcon size={14} /> URL da Evolution API
            </label>
            <input
              id="evo-api-url"
              type="url"
              placeholder="https://evo.seu-dominio.com"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
            <small>URL base onde a VPS do Evolution API está hospedada.</small>
          </div>

          <div className="whatsapp-field">
            <label htmlFor="evo-api-key">
              <Key size={14} /> Chave de API (Global ou de Instância)
            </label>
            <input
              id="evo-api-key"
              type="password"
              placeholder={data?.hasApiKey ? '•••••••••••••••• (configurada)' : 'Digite a chave'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small>
              {data?.hasApiKey
                ? 'Deixe em branco para manter a chave salva atualmente.'
                : 'Chave de autenticação apikey configurada na Evolution API.'}
            </small>
          </div>

          <div className="whatsapp-field">
            <label htmlFor="evo-instance">
              <MessageSquare size={14} /> Nome da Instância
            </label>
            <input
              id="evo-instance"
              type="text"
              placeholder="ex: atech-whatsapp"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
            />
            <small>Identificador da instância criada no Evolution API.</small>
          </div>

          <div className="whatsapp-field">
            <label htmlFor="evo-group-jid">
              <Users size={14} /> JID do Grupo de Programação Geral
            </label>
            <input
              id="evo-group-jid"
              type="text"
              placeholder="ex: 120363000000000000@g.us"
              value={programmingGroupJid}
              onChange={(e) => setProgrammingGroupJid(e.target.value)}
            />
            <small>ID do grupo de WhatsApp para envio automático e manual da Programação Geral.</small>
          </div>

          <div className="whatsapp-field">
            <label htmlFor="evo-foreman-phone">
              <Phone size={14} /> Telefone do Encarregado
            </label>
            <input
              id="evo-foreman-phone"
              type="text"
              placeholder="ex: 5582999999999 ou (82) 99999-9999"
              value={foremanPhoneNumber}
              onChange={(e) => setForemanPhoneNumber(e.target.value)}
            />
            <small>Número de WhatsApp específico para receber a programação de encarregados.</small>
          </div>
        </div>

        <div className="whatsapp-checkbox-row">
          <input
            id="evo-auto-dispatch"
            type="checkbox"
            checked={autoDispatchEnabled}
            onChange={(e) => setAutoDispatchEnabled(e.target.checked)}
          />
          <label htmlFor="evo-auto-dispatch" className="whatsapp-checkbox-label">
            <strong>Disparo automático às 17:00 (America/Maceio)</strong>
            <span>
              Envia diariamente a programação em PDF do próximo dia útil (considerando feriados e compensações) para o grupo e para o encarregado.
            </span>
          </label>
        </div>

        {showTestSend && (
          <div className="whatsapp-test-dialog">
            <strong style={{ fontSize: 13, color: '#1e293b' }}>Envio de Mensagem de Teste</strong>
            <div className="whatsapp-test-inputs">
              <input
                type="text"
                placeholder="Número (5582999999999) ou JID do Grupo"
                value={testTarget}
                onChange={(e) => setTestTarget(e.target.value)}
              />
              <input
                type="text"
                placeholder="Mensagem opcional"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
              <button
                type="button"
                className="whatsapp-btn whatsapp-btn-primary"
                disabled={testSending || !testTarget}
                onClick={handleTestSend}
              >
                {testSending ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Enviar
              </button>
              <button
                type="button"
                className="whatsapp-btn whatsapp-btn-secondary"
                onClick={() => setShowTestSend(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <footer className="whatsapp-actions-row">
          <div className="whatsapp-meta-info">
            {data?.updatedAt && (
              <span>
                Última alteração: {new Date(data.updatedAt).toLocaleString('pt-BR')}
                {data.updatedByName ? ` por ${data.updatedByName}` : ''}
              </span>
            )}
            {data?.lastAutoDispatchDate && (
              <span>
                Último envio automático realizado em: {data.lastAutoDispatchDate}
              </span>
            )}
          </div>

          <div className="whatsapp-btn-group">
            <button
              type="button"
              className="whatsapp-btn whatsapp-btn-secondary"
              disabled={testingConnection || !isConfigured}
              onClick={handleTestConnection}
              title="Testa o estado da instância na Evolution API"
            >
              {testingConnection ? <Loader2 className="animate-spin" size={14} /> : <Radio size={14} />}
              Testar conexão
            </button>

            <button
              type="button"
              className="whatsapp-btn whatsapp-btn-secondary"
              disabled={testSending || !isConfigured}
              onClick={() => {
                setShowTestSend((prev) => !prev)
                if (!testTarget) {
                  setTestTarget(programmingGroupJid || foremanPhoneNumber || '')
                }
              }}
              title="Enviar mensagem de texto de teste para validar o canal"
            >
              <Send size={14} /> Mensagem de teste
            </button>

            <button
              type="submit"
              className="whatsapp-btn whatsapp-btn-primary"
              disabled={saving}
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Salvar configurações
            </button>
          </div>
        </footer>
      </form>
    </section>
  )
}
