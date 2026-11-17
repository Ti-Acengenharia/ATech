import { useEffect, useState } from 'react'
import { Check, CircleAlert, Database, Loader2, Save, ShieldCheck, TestTube2 } from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './SiengeSettings.css'

interface SiengeSettingsData {
  dailyRequestLimit: number
  issueDocumentId: string
  issueMovementTypeId: number | null
  epiDocumentId: string
  epiMovementTypeId: number | null
  uniformDocumentId: string
  uniformMovementTypeId: number | null
  transferDocumentId: string
  transferMovementTypeId: number | null
  mappedCostCenterCount: number
  firstCostCenterId: number | null
  requestCountToday: number
  usageDate: string
  isConfigured: boolean
  updatedAt: string | null
  updatedByName: string | null
}

const DEFAULT_SETTINGS: SiengeSettingsData = {
  dailyRequestLimit: 100,
  issueDocumentId: '',
  issueMovementTypeId: null,
  epiDocumentId: '',
  epiMovementTypeId: null,
  uniformDocumentId: '',
  uniformMovementTypeId: null,
  transferDocumentId: '',
  transferMovementTypeId: null,
  mappedCostCenterCount: 0,
  firstCostCenterId: null,
  requestCountToday: 0,
  usageDate: '',
  isConfigured: false,
  updatedAt: null,
  updatedByName: null,
}

export default function SiengeSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [savedSettings, setSavedSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function loadSettings() {
    try {
      const result = await apiRequest<SiengeSettingsData>('/api/settings/sienge')
      setSettings(result)
      setSavedSettings(result)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível carregar as configurações do Sienge.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useLiveSync(['settings'], () => {
    void loadSettings()
  })

  const hasChanges = settings.dailyRequestLimit !== savedSettings.dailyRequestLimit ||
    settings.issueDocumentId !== savedSettings.issueDocumentId ||
    settings.issueMovementTypeId !== savedSettings.issueMovementTypeId ||
    settings.epiDocumentId !== savedSettings.epiDocumentId ||
    settings.epiMovementTypeId !== savedSettings.epiMovementTypeId ||
    settings.uniformDocumentId !== savedSettings.uniformDocumentId ||
    settings.uniformMovementTypeId !== savedSettings.uniformMovementTypeId ||
    settings.transferDocumentId !== savedSettings.transferDocumentId ||
    settings.transferMovementTypeId !== savedSettings.transferMovementTypeId

  async function saveSettings() {
    setSaving(true)
    setNotice(null)
    try {
      const result = await apiRequest<SiengeSettingsData & { success: boolean }>('/api/settings/sienge', {
        method: 'PUT',
        body: JSON.stringify({
          dailyRequestLimit: settings.dailyRequestLimit,
          issueDocumentId: settings.issueDocumentId.trim(),
          issueMovementTypeId: settings.issueMovementTypeId,
          epiDocumentId: settings.epiDocumentId.trim(),
          epiMovementTypeId: settings.epiMovementTypeId,
          uniformDocumentId: settings.uniformDocumentId.trim(),
          uniformMovementTypeId: settings.uniformMovementTypeId,
          transferDocumentId: settings.transferDocumentId.trim(),
          transferMovementTypeId: settings.transferMovementTypeId,
        }),
      })
      setSettings(result)
      setSavedSettings(result)
      setNotice({ kind: 'success', text: 'Configurações do Sienge salvas.' })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível salvar as configurações do Sienge.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setNotice(null)
    try {
      const result = await apiRequest<{
        costCenterId: number
        returnedItems: number
        requestCountToday: number
      }>('/api/settings/sienge/test-connection', { method: 'POST' })
      setSettings((current) => ({ ...current, requestCountToday: result.requestCountToday }))
      setNotice({
        kind: 'success',
        text: `Consulta autorizada no centro de custo ${result.costCenterId}. O Sienge retornou ${result.returnedItems} item(ns) na amostra e a requisição foi contabilizada.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível testar a conexão com o Sienge.',
      })
      await loadSettings()
    } finally {
      setTesting(false)
    }
  }

  const remaining = Math.max(0, settings.dailyRequestLimit - settings.requestCountToday)

  return (
    <section className="sienge-settings-card" aria-labelledby="sienge-settings-heading">
      <header className="sienge-settings-header">
        <div className="sienge-settings-title">
          <span className="sienge-settings-icon"><Database size={20} /></span>
          <div>
            <h2 id="sienge-settings-heading">Estoque Sienge · limites e movimentos</h2>
            <p>Controle o consumo diário da API e configure documentos e tipos de movimento para baixa, entrega de EPI e transferência.</p>
          </div>
        </div>
        <span className={`sienge-config-status ${settings.isConfigured ? 'is-configured' : ''}`}>
          <ShieldCheck size={14} /> {settings.isConfigured ? 'Credenciais no backend' : 'Credenciais pendentes no .env'}
        </span>
      </header>

      {notice && (
        <div className={`sienge-settings-notice notice-${notice.kind}`} role="status">
          {notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button>
        </div>
      )}

      {loading ? (
        <p className="sienge-settings-loading"><Loader2 className="sienge-spin" size={16} /> Carregando configurações...</p>
      ) : (
        <>
          <div className="sienge-settings-grid">
            <label>
              <span>Limite de requisições por dia</span>
              <input
                type="number"
                min="1"
                max="200000"
                step="1"
                value={settings.dailyRequestLimit}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  dailyRequestLimit: Number(event.target.value),
                }))}
              />
              <small>Padrão inicial: 100. A contagem reinicia à meia-noite no fuso de Maceió.</small>
            </label>
            <label>
              <span>Documento para baixa geral</span>
              <input
                value={settings.issueDocumentId}
                maxLength={20}
                onChange={(event) => setSettings((current) => ({ ...current, issueDocumentId: event.target.value }))}
                placeholder="Código cadastrado no Sienge"
              />
              <small>Documento ativo cadastrado no Sienge; obrigatório para enviar saídas gerais.</small>
            </label>
            <label>
              <span>Tipo de movimento para baixa geral</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.issueMovementTypeId ?? ''}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  issueMovementTypeId: event.target.value ? Number(event.target.value) : null,
                }))}
                placeholder="Código numérico"
              />
              <small>O tipo precisa ser ativo e configurado como exclusivamente de saída no Sienge.</small>
            </label>
            <label>
              <span>Documento para entrega de EPI</span>
              <input
                value={settings.epiDocumentId}
                maxLength={20}
                onChange={(event) => setSettings((current) => ({ ...current, epiDocumentId: event.target.value }))}
                placeholder="Código cadastrado no Sienge"
              />
            </label>
            <label>
              <span>Tipo de movimento para EPI</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.epiMovementTypeId ?? ''}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  epiMovementTypeId: event.target.value ? Number(event.target.value) : null,
                }))}
                placeholder="Código numérico"
              />
              <small>Tipo ativo, exclusivamente de saída, cadastrado no Sienge.</small>
            </label>
            <label>
              <span>Documento para entrega de fardamento</span>
              <input
                value={settings.uniformDocumentId}
                maxLength={20}
                onChange={(event) => setSettings((current) => ({ ...current, uniformDocumentId: event.target.value }))}
                placeholder="Código cadastrado no Sienge"
              />
            </label>
            <label>
              <span>Tipo de movimento para fardamento</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.uniformMovementTypeId ?? ''}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  uniformMovementTypeId: event.target.value ? Number(event.target.value) : null,
                }))}
                placeholder="Código numérico"
              />
              <small>Tipo ativo, exclusivamente de saída, cadastrado no Sienge.</small>
            </label>
            <label>
              <span>Documento para transferência</span>
              <input
                value={settings.transferDocumentId}
                maxLength={20}
                onChange={(event) => setSettings((current) => ({ ...current, transferDocumentId: event.target.value }))}
                placeholder="Código cadastrado no Sienge"
              />
            </label>
            <label>
              <span>Tipo de movimento para transferência</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.transferMovementTypeId ?? ''}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  transferMovementTypeId: event.target.value ? Number(event.target.value) : null,
                }))}
                placeholder="Código numérico"
              />
              <small>Use o tipo de movimento específico de transferência entre centros de custo.</small>
            </label>
          </div>

          <div className="sienge-usage-row">
            <div>
              <strong>Consumo de hoje: {settings.requestCountToday} / {settings.dailyRequestLimit}</strong>
              <span>{remaining} requisição(ões) restante(s) · {settings.mappedCostCenterCount} centro(s) associado(s) a locais · data local {settings.usageDate || '—'}</span>
            </div>
            {settings.updatedByName && (
              <small>Configuração atualizada por {settings.updatedByName}{settings.updatedAt ? ` em ${new Date(settings.updatedAt).toLocaleString('pt-BR')}` : ''}.</small>
            )}
          </div>

          <div className="sienge-settings-actions">
            <button type="button" className="secondary-button" onClick={() => void testConnection()}
              disabled={!settings.isConfigured || settings.mappedCostCenterCount < 1 || testing || saving}>
              {testing ? <Loader2 className="sienge-spin" size={15} /> : <TestTube2 size={15} />}
              {testing ? 'Testando...' : 'Testar primeira obra'}
            </button>
            <button type="button" className="primary-button" onClick={() => void saveSettings()}
              disabled={saving || testing || !hasChanges || !Number.isInteger(settings.dailyRequestLimit) || settings.dailyRequestLimit < 1 || settings.dailyRequestLimit > 200000 || (settings.issueMovementTypeId !== null && !Number.isInteger(settings.issueMovementTypeId)) || (settings.epiMovementTypeId !== null && !Number.isInteger(settings.epiMovementTypeId)) || (settings.uniformMovementTypeId !== null && !Number.isInteger(settings.uniformMovementTypeId)) || (settings.transferMovementTypeId !== null && !Number.isInteger(settings.transferMovementTypeId))}>
              {saving ? <Loader2 className="sienge-spin" size={15} /> : <Save size={15} />}
              {saving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
          <p className="sienge-settings-footnote">
            Associe os centros de custo aos locais na tela de estoque. O teste consulta apenas um centro, solicita no máximo um item e consome uma requisição da cota. Cada página sincronizada e cada movimento enviado também consome uma requisição.
          </p>
        </>
      )}
    </section>
  )
}
