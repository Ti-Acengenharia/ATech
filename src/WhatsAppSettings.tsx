import { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Code2,
  Copy,
  Info,
  Key,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Power,
  Radio,
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
  lastAutoDispatchDate: string | null
}

const ENV_SNIPPET = `# Integração Evolution API (WhatsApp Gateway para Programação)
EVOLUTION_API_URL=https://evo.seu-dominio.com
EVOLUTION_API_KEY=sua_chave_aqui
EVOLUTION_INSTANCE_NAME=atech-whatsapp
EVOLUTION_PROGRAMMING_GROUP_JID=120363000000000000@g.us
EVOLUTION_FOREMAN_PHONE_NUMBER=5582999999999
EVOLUTION_AUTO_DISPATCH_ENABLED=true`

export default function WhatsAppSettings() {
  const [data, setData] = useState<WhatsAppSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [updatingAutoDispatch, setUpdatingAutoDispatch] = useState(false)
  const [showTestSend, setShowTestSend] = useState(false)
  const [testTarget, setTestTarget] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [connectionState, setConnectionState] = useState<string | null>(null)
  const [copiedEnv, setCopiedEnv] = useState(false)

  const loadSettings = async () => {
    try {
      const res = await apiRequest<WhatsAppSettingsData>('/api/settings/whatsapp')
      setData(res)
    } catch {
      // Ignora erro caso não consiga carregar inicialmente
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

  const handleToggleAutoDispatch = async (enabled: boolean) => {
    setUpdatingAutoDispatch(true)
    setNotice(null)
    try {
      await apiRequest<{ success: boolean; autoDispatchEnabled: boolean }>(
        '/api/settings/whatsapp/auto-dispatch',
        {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        },
      )
      setData((prev) => (prev ? { ...prev, autoDispatchEnabled: enabled } : prev))
      setNotice({
        kind: 'success',
        text: enabled
          ? 'Envio automático das 17h ATIVADO com sucesso!'
          : 'Envio automático das 17h PAUSADO / DESATIVADO com sucesso.',
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao alterar o status do envio automático.',
      })
    } finally {
      setUpdatingAutoDispatch(false)
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

  const handleCopyEnv = async () => {
    try {
      await navigator.clipboard.writeText(ENV_SNIPPET)
      setCopiedEnv(true)
      setTimeout(() => setCopiedEnv(false), 2000)
    } catch {
      // Falha silenciosa de clipboard
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
              Envio automatizado e manual de programações diárias em PDF para grupo de campo e encarregados.
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
                  <CheckCircle2 size={13} /> Configurado no .env ({data?.instanceName})
                </>
              )}
            </span>
          ) : (
            <span className="whatsapp-status-badge unconfigured">
              <XCircle size={13} /> Pendente de configuração no .env
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className={`whatsapp-notice notice-${notice.kind}`} role="status">
          {notice.kind === 'success' ? (
            <Check size={16} />
          ) : notice.kind === 'info' ? (
            <Info size={16} />
          ) : (
            <CircleAlert size={16} />
          )}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      {/* Bloco de Controle do Envio Automático das 17h */}
      <div className={`whatsapp-dispatch-card ${data?.autoDispatchEnabled ? 'is-enabled' : 'is-disabled'}`}>
        <div className="whatsapp-dispatch-content">
          <div className="whatsapp-dispatch-header">
            <span className={`whatsapp-dispatch-indicator ${data?.autoDispatchEnabled ? 'online' : 'offline'}`} />
            <strong>Envio Automático às 17:00 (America/Maceio)</strong>
            <span className={`whatsapp-dispatch-pill ${data?.autoDispatchEnabled ? 'pill-active' : 'pill-paused'}`}>
              {data?.autoDispatchEnabled ? 'ATIVO' : 'PAUSADO'}
            </span>
          </div>
          <p className="whatsapp-dispatch-desc">
            Dispara automaticamente a programação do próximo dia útil (considerando feriados e compensações de sábado) para o grupo de WhatsApp e para os encarregados.
          </p>
          <div className="whatsapp-dispatch-meta">
            {data?.lastAutoDispatchDate ? (
              <span>Último envio automático executado em: <strong>{data.lastAutoDispatchDate}</strong></span>
            ) : (
              <span>Nenhum envio automático registrado hoje ainda.</span>
            )}
            <span>· Controlável por este botão ou por <code>EVOLUTION_AUTO_DISPATCH_ENABLED</code> no <code>.env</code></span>
          </div>
        </div>

        <button
          type="button"
          className={`whatsapp-toggle-action-btn ${data?.autoDispatchEnabled ? 'btn-pause' : 'btn-activate'}`}
          disabled={updatingAutoDispatch}
          onClick={() => handleToggleAutoDispatch(!data?.autoDispatchEnabled)}
          title={data?.autoDispatchEnabled ? 'Pausar o envio automático das 17h' : 'Ativar o envio automático das 17h'}
        >
          {updatingAutoDispatch ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Power size={14} />
          )}
          {data?.autoDispatchEnabled ? 'Pausar Envio das 17h' : 'Ativar Envio das 17h'}
        </button>
      </div>

      {/* Grade de Parâmetros do .env */}
      <div className="whatsapp-readonly-grid">
        <div className="whatsapp-readonly-item">
          <span className="whatsapp-readonly-label">
            <LinkIcon size={13} /> URL da Evolution API
          </span>
          <strong className="whatsapp-readonly-val">
            {data?.apiUrl || <em className="whatsapp-val-missing">Não definida no .env</em>}
          </strong>
          <small>Variável EVOLUTION_API_URL</small>
        </div>

        <div className="whatsapp-readonly-item">
          <span className="whatsapp-readonly-label">
            <Key size={13} /> Chave de Autenticação (API Key)
          </span>
          <strong className="whatsapp-readonly-val">
            {data?.hasApiKey ? (
              <span className="whatsapp-val-present">
                <CheckCircle2 size={13} /> Configurada no .env
              </span>
            ) : (
              <em className="whatsapp-val-missing">Não definida no .env</em>
            )}
          </strong>
          <small>Variável EVOLUTION_API_KEY (segura, não gravada no banco)</small>
        </div>

        <div className="whatsapp-readonly-item">
          <span className="whatsapp-readonly-label">
            <MessageSquare size={13} /> Nome da Instância
          </span>
          <strong className="whatsapp-readonly-val">
            {data?.instanceName || <em className="whatsapp-val-missing">Não definida no .env</em>}
          </strong>
          <small>Variável EVOLUTION_INSTANCE_NAME</small>
        </div>

        <div className="whatsapp-readonly-item">
          <span className="whatsapp-readonly-label">
            <Users size={13} /> Grupo da Programação Geral
          </span>
          <strong className="whatsapp-readonly-val">
            {data?.programmingGroupJid || <em className="whatsapp-val-missing">Não definido no .env</em>}
          </strong>
          <small>Variável EVOLUTION_PROGRAMMING_GROUP_JID</small>
        </div>
      </div>

      {/* Regras e Envio para Encarregados */}
      <div className="whatsapp-flow-explanation">
        <div className="whatsapp-flow-row">
          <div className="whatsapp-flow-icon">
            <Users size={16} />
          </div>
          <div>
            <strong>Programação Geral</strong>
            <p>
              Enviada diretamente para o grupo oficial cadastrado em <code>EVOLUTION_PROGRAMMING_GROUP_JID</code>.
            </p>
          </div>
        </div>

        <div className="whatsapp-flow-row">
          <div className="whatsapp-flow-icon">
            <MessageSquare size={16} />
          </div>
          <div>
            <strong>Programação dos Encarregados</strong>
            <p>
              Cada encarregado com programação para o dia recebe individualmente a sua agenda personalizada no seu próprio número de WhatsApp cadastrado na tela de Colaboradores.
            </p>
          </div>
        </div>

        <div className="whatsapp-flow-row">
          <div className="whatsapp-flow-icon">
            <Radio size={16} />
          </div>
          <div>
            <strong>Reemissões e Disparo Manual</strong>
            <p>
              Na tela de Programação, você pode clicar nos botões de envio a qualquer momento sem limites diários.
            </p>
          </div>
        </div>
      </div>

      {/* Caixa Informativa com o Modelo do .env */}
      <div className="whatsapp-env-box">
        <div className="whatsapp-env-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Code2 size={15} />
            <strong>Configuração no arquivo .env da VPS</strong>
          </div>
          <button
            type="button"
            className="whatsapp-btn-copy"
            onClick={handleCopyEnv}
            title="Copiar variáveis para área de transferência"
          >
            {copiedEnv ? <Check size={13} /> : <Copy size={13} />}
            {copiedEnv ? 'Copiado!' : 'Copiar modelo'}
          </button>
        </div>
        <pre className="whatsapp-env-snippet">{ENV_SNIPPET}</pre>
        <p className="whatsapp-env-tip">
          Nenhuma credencial ou chave sensível é gravada no banco de dados. Todas as credenciais são lidas diretamente do arquivo de ambiente (.env) do servidor.
        </p>
      </div>

      {showTestSend && (
        <div className="whatsapp-test-dialog">
          <strong style={{ fontSize: 13, color: '#1e293b' }}>Envio de Mensagem de Teste</strong>
          <div className="whatsapp-test-inputs">
            <input
              type="text"
              placeholder="Número (ex: 5582999999999) ou JID do Grupo"
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
          <span>Status do sistema e testes de conexão</span>
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
            className="whatsapp-btn whatsapp-btn-primary"
            disabled={testSending || !isConfigured}
            onClick={() => {
              setShowTestSend((prev) => !prev)
              if (!testTarget) {
                setTestTarget(data?.programmingGroupJid || '')
              }
            }}
            title="Enviar mensagem de texto de teste para validar o canal"
          >
            <Send size={14} /> Mensagem de teste
          </button>
        </div>
      </footer>
    </section>
  )
}
