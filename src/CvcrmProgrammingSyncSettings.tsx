import { useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Info,
  Loader2,
  MessageSquareShare,
  Power,
  Save,
  Send,
  XCircle,
} from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './CvcrmProgrammingSyncSettings.css'

interface CvcrmProgrammingSyncSettingsData {
  enabled: boolean
  dispatchTime: string
  lastRunAt: string | null
  lastRunDate: string | null
  lastRunTrigger: 'auto' | 'manual' | null
  lastRunSuccess: boolean | null
  lastRunTicketsCount: number
  lastRunItemsCount: number
  lastRunMessage: string | null
  cvcrmConfigured: boolean
  pendingTicketsCount: number
  pendingItemsCount: number
}

export default function CvcrmProgrammingSyncSettings() {
  const [data, setData] = useState<CvcrmProgrammingSyncSettingsData | null>(null)
  const [dispatchTimeInput, setDispatchTimeInput] = useState('17:40')
  const [loading, setLoading] = useState(true)
  const [updatingEnabled, setUpdatingEnabled] = useState(false)
  const [savingTime, setSavingTime] = useState(false)
  const [runningManual, setRunningManual] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  const loadSettings = async () => {
    try {
      const res = await apiRequest<CvcrmProgrammingSyncSettingsData>('/api/settings/cvcrm-programming-sync')
      setData(res)
      setDispatchTimeInput(res.dispatchTime || '17:40')
    } catch {
      // ignore initial error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  useLiveSync(['settings', 'programming'], () => {
    void loadSettings()
  })

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    setUpdatingEnabled(true)
    setNotice(null)
    try {
      const updated = await apiRequest<CvcrmProgrammingSyncSettingsData & { success: boolean }>(
        '/api/settings/cvcrm-programming-sync',
        {
          method: 'PUT',
          body: JSON.stringify({ enabled: nextEnabled }),
        },
      )
      setData(updated)
      setNotice({
        kind: 'success',
        text: nextEnabled
          ? `Sincronização automática de comentários com o CVCRM ATIVADA (programada para ${updated.dispatchTime})!`
          : 'Sincronização automática de comentários com o CVCRM PAUSADA / DESATIVADA.',
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao alterar o status da sincronização CVCRM.',
      })
    } finally {
      setUpdatingEnabled(false)
    }
  }

  const handleSaveDispatchTime = async () => {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(dispatchTimeInput)) {
      setNotice({
        kind: 'error',
        text: 'Informe um horário válido no formato HH:MM (ex: 17:40).',
      })
      return
    }
    setSavingTime(true)
    setNotice(null)
    try {
      const updated = await apiRequest<CvcrmProgrammingSyncSettingsData & { success: boolean }>(
        '/api/settings/cvcrm-programming-sync',
        {
          method: 'PUT',
          body: JSON.stringify({ dispatchTime: dispatchTimeInput }),
        },
      )
      setData(updated)
      setDispatchTimeInput(updated.dispatchTime)
      setNotice({
        kind: 'success',
        text: `Horário da integração diária com o CVCRM atualizado para ${updated.dispatchTime}!`,
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao salvar o novo horário de integração.',
      })
    } finally {
      setSavingTime(false)
    }
  }

  const handleRunManualSync = async () => {
    setRunningManual(true)
    setNotice(null)
    try {
      const res = await apiRequest<{
        ran: boolean
        ticketsSynced: number
        itemsSynced: number
        ticketsFailed: number
        message: string
      }>('/api/settings/cvcrm-programming-sync/run-now', {
        method: 'POST',
      })
      await loadSettings()
      setNotice({
        kind: res.ticketsFailed > 0 ? 'error' : 'success',
        text: res.message,
      })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha ao executar a sincronização de comentários com o CVCRM.',
      })
    } finally {
      setRunningManual(false)
    }
  }

  if (loading || !data) return null

  const timeChanged = dispatchTimeInput !== data.dispatchTime

  return (
    <section className="cvcrm-prog-sync-settings-card" aria-label="Integração de Comentários da Programação com CVCRM">
      <div className="cvcrm-prog-sync-header">
        <div className="cvcrm-prog-sync-title-row">
          <div className="cvcrm-prog-sync-icon">
            <MessageSquareShare size={19} />
          </div>
          <div>
            <div className="cvcrm-prog-sync-title-badges">
              <h3>Comentários Internos da Programação no CVCRM</h3>
              <span className={`cvcrm-prog-sync-badge ${data.cvcrmConfigured ? 'is-ready' : 'is-pending'}`}>
                {data.cvcrmConfigured ? (
                  <>
                    <CheckCircle2 size={12} /> API CVCRM Conectada
                  </>
                ) : (
                  <>
                    <XCircle size={12} /> Credenciais CVCRM Pendentes (.env)
                  </>
                )}
              </span>
              <span className={`cvcrm-prog-sync-badge ${data.enabled ? 'is-auto-on' : 'is-auto-off'}`}>
                {data.enabled ? `Disparo Diário Ativo (${data.dispatchTime})` : 'Disparo Automático Pausado'}
              </span>
            </div>
            <p>
              Consolida todas as novas programações, ajustes de horário/equipe e cancelamentos do dia e
              insere um comentário interno (invisível ao cliente) em cada chamado correspondente no CVCRM.
            </p>
          </div>
        </div>

        <div className="cvcrm-prog-sync-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!data.cvcrmConfigured || runningManual}
            onClick={() => void handleRunManualSync()}
            title="Enviar imediatamente todos os comentários pendentes de programação para o CVCRM"
          >
            {runningManual ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {runningManual
              ? 'Sincronizando...'
              : data.pendingTicketsCount > 0
                ? `Sincronizar agora (${data.pendingTicketsCount} chamado${data.pendingTicketsCount === 1 ? '' : 's'})`
                : 'Sincronizar agora'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`cvcrm-prog-sync-notice is-${notice.kind}`} role="status">
          {notice.kind === 'success' ? <Check size={15} /> : <CircleAlert size={15} />}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar">
            ×
          </button>
        </div>
      )}

      {/* Controle de Ativação e Horário da Integração */}
      <div className="cvcrm-prog-sync-controls-grid">
        <div className={`cvcrm-prog-sync-toggle-box ${data.enabled ? 'is-enabled' : 'is-disabled'}`}>
          <div className="cvcrm-prog-sync-toggle-info">
            <div className="cvcrm-prog-sync-toggle-icon">
              <Power size={18} />
            </div>
            <div>
              <strong>Sincronização Diária Automática</strong>
              <p>
                {data.enabled
                  ? `O servidor verificará diariamente às ${data.dispatchTime} (fuso de Maceió) todas as programações novas, alteradas ou canceladas e publicará o resumo interno em cada chamado no CVCRM.`
                  : 'A sincronização automática diária está desativada. Os comentários só serão enviados ao clicar no botão de sincronização manual.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className={`cvcrm-prog-sync-switch-btn ${data.enabled ? 'is-on' : 'is-off'}`}
            disabled={updatingEnabled}
            onClick={() => void handleToggleEnabled(!data.enabled)}
          >
            {updatingEnabled ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Power size={15} />
            )}
            <span>{data.enabled ? 'Desativar Sincronização' : 'Ativar Sincronização'}</span>
          </button>
        </div>

        <div className="cvcrm-prog-sync-time-box">
          <div className="cvcrm-prog-sync-time-label">
            <Clock3 size={16} />
            <div>
              <strong>Horário da Integração Diária</strong>
              <small>Horário padrão sugerido: 17:40 (final do expediente)</small>
            </div>
          </div>

          <div className="cvcrm-prog-sync-time-input-row">
            <input
              type="time"
              value={dispatchTimeInput}
              onChange={(e) => setDispatchTimeInput(e.target.value)}
              className="cvcrm-prog-sync-time-input"
              aria-label="Horário da integração com o CVCRM"
            />
            <button
              type="button"
              className="primary-button"
              disabled={savingTime || !timeChanged}
              onClick={() => void handleSaveDispatchTime()}
            >
              {savingTime ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Salvar horário</span>
            </button>
          </div>
        </div>
      </div>

      {/* Resumo de Pendências e Última Execução */}
      <div className="cvcrm-prog-sync-status-bar">
        <div className="cvcrm-prog-sync-stat">
          <span className="stat-label">Pendências na Fila Atual</span>
          <strong className={data.pendingTicketsCount > 0 ? 'has-pending' : ''}>
            {data.pendingTicketsCount === 0
              ? 'Nenhuma pendência (tudo sincronizado)'
              : `${data.pendingTicketsCount} chamado(s) (${data.pendingItemsCount} programação(ões) aguardando envio)`}
          </strong>
        </div>

        <div className="cvcrm-prog-sync-stat">
          <span className="stat-label">Última Execução</span>
          <strong>
            {data.lastRunAt
              ? `${new Date(data.lastRunAt).toLocaleString('pt-BR')} (${data.lastRunTrigger === 'auto' ? 'Automática' : 'Manual'})`
              : 'Ainda não executada'}
          </strong>
          {data.lastRunMessage && <small>{data.lastRunMessage}</small>}
        </div>
      </div>

      <div className="cvcrm-prog-sync-hint">
        <Info size={14} />
        <span>
          <strong>Como funciona o agrupamento:</strong> O sistema consolida todas as programações novas
          do chamado em um único comentário (mesmo em dias não seguidos), agrupa colaboradores escalados
          no mesmo dia e horário e detalha exatamente o que foi ajustado ou cancelado sem repetir
          mensagens já enviadas.
        </span>
      </div>
    </section>
  )
}
