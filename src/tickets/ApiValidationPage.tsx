import { useEffect, useState, type ChangeEvent } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  Zap,
} from 'lucide-react'
import Papa from 'papaparse'
import { apiRequest } from '../api/client'
import type { TicketSummary } from './types'

interface IntegrationStatus {
  configured: boolean
  hasToken: boolean
  syncIntervalSeconds: number
  state: {
    api_validated_at: string | null
    baseline_completed: boolean
    auto_sync_enabled: boolean
    last_started_at: string | null
    last_finished_at: string | null
    last_success: boolean | null
    imported_count: number
    error_message: string | null
  }
  stats: {
    totalTickets: number
    activeTickets: number
    stagesCount: number
  }
}

interface ValidationResponse {
  success: boolean
  stages: number
  sampleReturned: number
  totalRecords: number
  totalPages: number
  pagesTested: number
  secondPageReturned: number
  sampleIds: number[]
  validatedAt: string
}

interface ActiveImportResponse {
  totalRecords: number
  totalPages: number
  receivedCount: number
  importedCount: number
  stageCount: number
  baselineCompleted: boolean
}

interface TestProtocolResponse {
  found: boolean
  ticket: Record<string, unknown>
}

interface ImportProtocolResponse {
  ticket: TicketSummary
  raw: Record<string, unknown>
}

interface ImportCsvResponse {
  requestedCount: number
  foundCount: number
  importedCount: number
  baselineCompleted: boolean
  inactiveProtocols: string[]
  missingProtocols: string[]
  importedProtocols: string[]
}

function decodeCsvFile(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3))
    }

    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8
  })
}

export default function ApiValidationPage({ onGoToTickets }: { onGoToTickets?: () => void }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null)

  // Teste de protocolo individual
  const [protocolInput, setProtocolInput] = useState('')
  const [testingProtocol, setTestingProtocol] = useState(false)
  const [testedTicket, setTestedTicket] = useState<Record<string, unknown> | null>(null)
  const [importingSingle, setImportingSingle] = useState(false)
  const [singleImportSuccess, setSingleImportSuccess] = useState<string | null>(null)

  // Upload CSV
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [detectedProtocols, setDetectedProtocols] = useState<string[]>([])
  const [importingCsv, setImportingCsv] = useState(false)
  const [csvResult, setCsvResult] = useState<ImportCsvResponse | null>(null)

  // Sincronização horária
  const [togglingAutoSync, setTogglingAutoSync] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)
  const [importingActive, setImportingActive] = useState(false)

  // Mensagens e alertas
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  function loadStatus() {
    apiRequest<IntegrationStatus>('/api/tickets/integration/status')
      .then((data) => setStatus(data))
      .catch((err) => setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao consultar status da integração.' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadStatus()
  }, [])

  async function handleValidateApi() {
    setValidating(true)
    setNotice(null)
    setValidationResult(null)
    try {
      const res = await apiRequest<ValidationResponse>('/api/tickets/integration/validate', { method: 'POST' })
      setValidationResult(res)
      setNotice({ kind: 'success', text: `API validada: ${res.pagesTested} página(s) testada(s), ${res.totalRecords} registros no total e ${res.stages} etapas de workflow.` })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha na validação com a API do CVCRM.' })
    } finally {
      setValidating(false)
    }
  }

  async function handleTestProtocol() {
    if (!protocolInput.trim()) {
      setNotice({ kind: 'error', text: 'Informe um número de protocolo para testar.' })
      return
    }
    setTestingProtocol(true)
    setNotice(null)
    setTestedTicket(null)
    setSingleImportSuccess(null)
    try {
      const res = await apiRequest<TestProtocolResponse>('/api/tickets/integration/test-protocol', {
        method: 'POST',
        body: JSON.stringify({ protocol: protocolInput.trim() }),
      })
      if (res.found && res.ticket) {
        setTestedTicket(res.ticket)
        setNotice({ kind: 'success', text: `Protocolo "${protocolInput}" localizado com sucesso na base do CVCRM!` })
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao buscar protocolo no CVCRM.' })
    } finally {
      setTestingProtocol(false)
    }
  }

  async function handleImportSingleProtocol() {
    if (!protocolInput.trim()) return
    setImportingSingle(true)
    setNotice(null)
    try {
      const res = await apiRequest<ImportProtocolResponse>('/api/tickets/by-protocol', {
        method: 'POST',
        body: JSON.stringify({ protocol: protocolInput.trim() }),
      })
      setSingleImportSuccess(`Chamado #${res.ticket.protocol || protocolInput} importado e salvo no banco ATech com sucesso!`)
      setNotice({ kind: 'success', text: `Chamado importado com sucesso na situação: ${res.ticket.status}` })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao importar chamado por protocolo.' })
    } finally {
      setImportingSingle(false)
    }
  }

  async function handleCsvFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFile(file)
    setDetectedProtocols([])
    setCsvResult(null)
    setNotice(null)

    try {
      const content = await decodeCsvFile(file)
      const results = Papa.parse<string[]>(content.replace(/^\uFEFF/, ''), {
        header: false,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
      })
      const parseError = results.errors.find((error) => error.code !== 'UndetectableDelimiter')
      if (parseError) {
        setNotice({ kind: 'error', text: `Erro ao ler arquivo CSV: ${parseError.message}` })
        return
      }

      const rows = results.data
      if (!rows.length) {
        setNotice({ kind: 'error', text: 'O arquivo CSV não contém protocolos.' })
        return
      }

      const headerPattern = /protocolo|protocol|chamado|n[uú]mero|c[oó]digo|idatendimento/i
      const protocolIndex = rows[0].findIndex((value) => headerPattern.test(value.trim()))
      const dataRows = protocolIndex >= 0 ? rows.slice(1) : rows
      const unique = [...new Set(dataRows
        .map((row) => (row[protocolIndex >= 0 ? protocolIndex : 0] ?? '').trim())
        .filter(Boolean))]
      if (unique.length > 5000) {
        setNotice({ kind: 'error', text: 'O CSV pode conter no máximo 5.000 protocolos únicos por importação.' })
        return
      }
      if (unique.some((protocol) => protocol.length > 100)) {
        setNotice({ kind: 'error', text: 'Há protocolos com mais de 100 caracteres no CSV.' })
        return
      }
      if (!unique.length) {
        setNotice({
          kind: 'error',
          text: 'Nenhum protocolo detectado. Use um protocolo por linha ou uma coluna chamada "protocolo".',
        })
        return
      }
      setDetectedProtocols(unique)
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `Erro ao ler arquivo CSV: ${err instanceof Error ? err.message : 'formato não suportado.'}`,
      })
    }
  }

  async function handleImportCsvProtocols() {
    if (!detectedProtocols.length) {
      setNotice({ kind: 'error', text: 'Nenhum protocolo detectado no arquivo selecionado.' })
      return
    }
    setImportingCsv(true)
    setNotice(null)
    setCsvResult(null)
    try {
      const res = await apiRequest<ImportCsvResponse>('/api/tickets/import-csv', {
        method: 'POST',
        body: JSON.stringify({ protocols: detectedProtocols }),
      })
      setCsvResult(res)
      setNotice({
        kind: res.baselineCompleted ? 'success' : 'error',
        text: res.baselineCompleted
          ? `Carga concluída! ${res.importedCount} chamados ativos foram importados com sucesso.`
          : 'Nenhum chamado ativo do CSV foi importado. Revise os protocolos; a sincronização automática continua bloqueada.',
      })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha na importação de protocolos via CSV.' })
    } finally {
      setImportingCsv(false)
    }
  }

  async function handleToggleAutoSync() {
    if (!status) return
    const newState = !status.state.auto_sync_enabled
    setTogglingAutoSync(true)
    setNotice(null)
    try {
      await apiRequest('/api/tickets/integration/toggle-auto-sync', {
        method: 'POST',
        body: JSON.stringify({ enabled: newState }),
      })
      setNotice({
        kind: 'success',
        text: newState
          ? 'Sincronização automática a cada 1 hora ativada!'
          : 'Sincronização automática pausada.',
      })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao alternar sincronização automática.' })
    } finally {
      setTogglingAutoSync(false)
    }
  }

  async function handleRunManualSync() {
    setManualSyncing(true)
    setNotice(null)
    try {
      const res = await apiRequest<{ importedCount: number }>('/api/tickets/sync', { method: 'POST' })
      setNotice({
        kind: 'success',
        text: `Sincronização manual concluída! ${res.importedCount} chamados ativos sincronizados.`,
      })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao sincronizar com CVCRM.' })
    } finally {
      setManualSyncing(false)
    }
  }

  async function handleImportAllActive() {
    setImportingActive(true)
    setNotice(null)
    try {
      const result = await apiRequest<ActiveImportResponse>('/api/tickets/integration/import-active', { method: 'POST' })
      setNotice({
        kind: 'success',
        text: `Carga inicial concluída: ${result.importedCount} chamados ativos importados de ${result.receivedCount} registros em ${result.totalPages} páginas. Finalizados e cancelados foram excluídos.`,
      })
      loadStatus()
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao importar chamados ativos do CVCRM.' })
    } finally {
      setImportingActive(false)
    }
  }

  const isConfigured = Boolean(status?.configured)
  const isAutoSyncActive = Boolean(status?.state.auto_sync_enabled)
  const isBaselineDone = Boolean(status?.state.baseline_completed)
  const isValidated = Boolean(status?.state.api_validated_at)

  return (
    <div className="api-validation-page">
      {/* Cabeçalho */}
      <header className="validation-header">
        <div className="validation-title-area">
          <span className="eyebrow validation-eyebrow">INTEGRAÇÃO & SERVIÇOS EXTERNOS</span>
          <h1>Painel de Validação da API CVCRM</h1>
          <p>
            Valide credenciais com segurança sem sobrecarregar a API, teste protocolos individuais,
            importe sua carga inicial via CSV e configure a atualização periódica a cada 1 hora.
          </p>
        </div>
        <div className="validation-quick-actions">
          <button type="button" className="secondary-button" onClick={loadStatus} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
            Atualizar status
          </button>
          {onGoToTickets && (
            <button type="button" className="primary-button" onClick={onGoToTickets}>
              Ver chamados <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Aviso / Notificação */}
      {notice && (
        <div className={`notice notice-${notice.kind}`} role="alert">
          <span className="notice-symbol">
            {notice.kind === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          </span>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar">
            ×
          </button>
        </div>
      )}

      {/* Resumo em métricas */}
      <section className="validation-stats-grid" aria-label="Estatísticas da integração">
        <article className={`validation-stat-card ${isConfigured ? 'status-ok' : 'status-warning'}`}>
          <div className="stat-card-icon">
            <KeyRound size={18} />
          </div>
          <div className="stat-card-copy">
            <span className="stat-label">CREDENCIAS (.ENV)</span>
            <strong>{isConfigured ? 'Configuradas' : 'Incompletas'}</strong>
            <small>{isConfigured ? 'Subdomínio, e-mail e token OK' : 'Preencha subdomínio, e-mail e token'}</small>
          </div>
        </article>

        <article className={`validation-stat-card ${isValidated ? 'status-ok' : 'status-pending'}`}>
          <div className="stat-card-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="stat-card-copy">
            <span className="stat-label">VALIDAÇÃO DA API</span>
            <strong>{isValidated ? 'Validada' : 'Pendente'}</strong>
            <small>{isValidated ? `Etapas ativas: ${status?.stats.stagesCount || 0}` : 'Faça o teste de conexão abaixo'}</small>
          </div>
        </article>

        <article className={`validation-stat-card ${isBaselineDone ? 'status-ok' : 'status-pending'}`}>
          <div className="stat-card-icon">
            <Database size={18} />
          </div>
          <div className="stat-card-copy">
            <span className="stat-label">CARGA INICIAL (CSV)</span>
            <strong>{isBaselineDone ? 'Concluída' : 'Aguardando CSV'}</strong>
            <small>{status?.stats.activeTickets ?? 0} chamados ativos no banco</small>
          </div>
        </article>

        <article className={`validation-stat-card ${isAutoSyncActive ? 'status-active' : 'status-idle'}`}>
          <div className="stat-card-icon">
            <Clock size={18} />
          </div>
          <div className="stat-card-copy">
            <span className="stat-label">SYNC AUTOMÁTICO</span>
            <strong>{isAutoSyncActive ? 'Ativo (1 hora)' : 'Pausado'}</strong>
            <small>Intervalo: 3.600 segundos (60 min)</small>
          </div>
        </article>
      </section>

      {/* Grid de Seções Principais */}
      <div className="validation-sections-grid">
        {/* BLOCO 1: Validação de Conexão e Credenciais */}
        <section className="validation-card">
          <header className="card-header">
            <div>
              <span className="card-step-badge">ETAPA 1</span>
              <h2>Teste de Conexão com a API v1</h2>
              <p>
                Valida as credenciais no endpoint padrão de atendimentos (sem usar o CVDW pago) e carrega as etapas do workflow.
              </p>
            </div>
            <span className={`connection-pill ${isConfigured ? 'is-connected' : 'is-unconfigured'}`}>
              <i />
              {isConfigured ? 'Credenciais configuradas' : 'Pendente de .env'}
            </span>
          </header>

          <div className="card-body">
            <div className="credentials-info-list">
              <div className="info-row">
                <span>Credenciais no servidor:</span>
                <strong>
                  {status?.configured
                    ? 'Subdomínio, e-mail e token configurados'
                    : 'Não configuradas — preencha o .env do servidor'}
                </strong>
              </div>
              <div className="info-row">
                <span>Token de integração:</span>
                <strong>{status?.hasToken ? '••••••••••••••••••••' : 'Não informado'}</strong>
              </div>
              <div className="info-row">
                <span>Última validação com sucesso:</span>
                <strong>
                  {status?.state.api_validated_at
                    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(
                        new Date(status.state.api_validated_at),
                      )
                    : 'Nenhuma validação registrada'}
                </strong>
              </div>
            </div>

            {validationResult && (
              <div className="validation-sample-box">
                <div className="sample-box-header">
                  <CheckCircle2 size={16} />
                  <strong>Retorno da validação:</strong>
                </div>
                <ul>
                  <li>Endpoint de atendimentos: <strong>GET /api/v1/relacionamento/atendimentos/listar</strong></li>
                  <li>Paginação enviada: <strong>pagina + registros_por_pagina=500</strong></li>
                  <li>Páginas testadas: <strong>{validationResult.pagesTested} de {validationResult.totalPages}</strong> · página 1: {validationResult.sampleReturned} registros · página 2: {validationResult.secondPageReturned}</li>
                  <li>IDs de amostra: <strong>{validationResult.sampleIds.join(', ') || 'nenhum'}</strong></li>
                  <li>Etapas do Workflow sincronizadas: <strong>{validationResult.stages}</strong></li>
                  <li>Total de registros informado pelo CVCRM: <strong>{validationResult.totalRecords}</strong></li>
                </ul>
              </div>
            )}

            <footer className="card-footer">
              <button
                type="button"
                className="primary-button"
                onClick={handleValidateApi}
                disabled={validating || !isConfigured}
              >
                <RefreshCw size={15} className={validating ? 'spin-icon' : ''} />
                {validating ? 'Testando conexão...' : 'Validar Conexão com CVCRM'}
              </button>
            </footer>
          </div>
        </section>

        {/* BLOCO 2: Teste de Consulta Individual por Protocolo */}
        <section className="validation-card">
          <header className="card-header">
            <div>
              <span className="card-step-badge">ETAPA 2</span>
              <h2>Consulta & Cadastro por Protocolo</h2>
              <p>
                Consulte um protocolo específico para validar os dados retornados e importe-o
                diretamente como chamado no ATech.
              </p>
            </div>
            <Zap size={18} className="step-icon" />
          </header>

          <div className="card-body">
            <div className="protocol-search-form">
              <label className="ticket-form-field">
                <span>Número de Protocolo CVCRM</span>
                <div className="search-input-group">
                  <Search size={15} />
                  <input
                    type="text"
                    value={protocolInput}
                    onChange={(e) => setProtocolInput(e.target.value)}
                    placeholder="Ex: 2024-00123 ou 12345"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleTestProtocol()
                      }
                    }}
                  />
                </div>
              </label>

              <div className="protocol-action-buttons">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleTestProtocol}
                  disabled={testingProtocol || !protocolInput.trim() || !isConfigured}
                >
                  <Search size={14} />
                  {testingProtocol ? 'Consultando...' : 'Consultar no CVCRM'}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleImportSingleProtocol}
                  disabled={importingSingle || !protocolInput.trim() || !isConfigured}
                >
                  <Download size={14} />
                  {importingSingle ? 'Importando...' : 'Importar como Chamado'}
                </button>
              </div>
            </div>

            {singleImportSuccess && (
              <div className="single-import-success-banner">
                <CheckCircle2 size={16} />
                <span>{singleImportSuccess}</span>
              </div>
            )}

            {testedTicket && (
              <div className="tested-ticket-preview">
                <div className="ticket-preview-header">
                  <strong>Detalhes retornados pelo CVCRM:</strong>
                  <span className={`ticket-active-badge ${testedTicket.ativo === 'S' ? 'is-active' : 'is-inactive'}`}>
                    {testedTicket.ativo === 'S' ? 'Ativo no CV' : 'Inativo no CV'}
                  </span>
                </div>
                <div className="ticket-preview-grid">
                  <div>
                    <span>Protocolo:</span>
                    <strong>{String(testedTicket.protocolo || testedTicket.referencia || '—')}</strong>
                  </div>
                  <div>
                    <span>Situação no CV:</span>
                    <strong>{String(testedTicket.situacao || '—')}</strong>
                  </div>
                  <div>
                    <span>Cliente:</span>
                    <strong>{String(testedTicket.nome_cliente || testedTicket.cliente || '—')}</strong>
                  </div>
                  <div>
                    <span>Empreendimento:</span>
                    <strong>
                      {typeof testedTicket.empreendimento === 'object' && testedTicket.empreendimento !== null
                        ? String((testedTicket.empreendimento as { nome?: string }).nome || '—')
                        : String(testedTicket.empreendimento || '—')}
                    </strong>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span>Assunto / Reclamação:</span>
                    <strong>{String(testedTicket.assunto || 'Sem assunto')}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* BLOCO 3: Upload de CSV para Carga Inicial */}
        <section className="validation-card card-wide">
          <header className="card-header">
            <div>
              <span className="card-step-badge">ETAPA 3</span>
              <h2>Carga Inicial de Protocolos Ativos (CSV)</h2>
              <p>
                Envie uma planilha CSV com os protocolos atualmente ativos. A consulta e a importação
                começam somente depois da validação da API e de você clicar no botão de importação.
                {' '}<a href="/chamados-ativos-exemplo.csv" download>Baixar CSV de exemplo</a>
              </p>
            </div>
            <FileSpreadsheet size={18} className="step-icon" />
          </header>

          <div className="card-body">
            <div className="csv-upload-dropzone">
              <label className="csv-dropzone-label">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileSelected}
                  className="sr-only"
                />
                <UploadCloud size={32} />
                <strong>Clique ou arraste um arquivo CSV com os protocolos</strong>
                <span>Formatos aceitos: coluna com cabeçalho "protocolo" ou primeira coluna com os números.</span>
              </label>
            </div>

            {csvFile && (
              <div className="csv-preview-panel">
                <div className="csv-preview-header">
                  <div className="csv-file-info">
                    <FileText size={16} />
                    <strong>{csvFile.name}</strong>
                    <span>({Math.round(csvFile.size / 1024)} KB)</span>
                  </div>
                  <span className="detected-count-tag">
                    {detectedProtocols.length} {detectedProtocols.length === 1 ? 'protocolo detectado' : 'protocolos detectados'}
                  </span>
                </div>

                {detectedProtocols.length > 0 && (
                  <div className="sample-protocols-strip">
                    <span>Amostra de protocolos:</span>
                    <div className="protocol-pills-list">
                      {detectedProtocols.slice(0, 15).map((p) => (
                        <span key={p} className="protocol-pill">{p}</span>
                      ))}
                      {detectedProtocols.length > 15 && (
                        <span className="protocol-pill-more">+{detectedProtocols.length - 15} outros</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="csv-import-action-row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleImportCsvProtocols}
                    disabled={importingCsv || !detectedProtocols.length || !isValidated}
                  >
                    <Download size={15} />
                    {importingCsv
                      ? 'Processando e buscando no CVCRM...'
                      : `Importar ${detectedProtocols.length} protocolos do CVCRM`}
                  </button>
                  {!isValidated && <small>Valide a conexão com o CVCRM antes de importar a carga inicial.</small>}
                </div>
              </div>
            )}

            {csvResult && (
              <div className="csv-result-report">
                <header className="report-header">
                  <CheckCircle2 size={16} />
                  <strong>Resultado da Importação do CSV:</strong>
                </header>
                <div className="report-metrics-grid">
                  <div className="report-metric">
                    <span>Protocolos no arquivo:</span>
                    <strong>{csvResult.requestedCount}</strong>
                  </div>
                  <div className="report-metric">
                    <span>Localizados no CVCRM:</span>
                    <strong>{csvResult.foundCount}</strong>
                  </div>
                  <div className="report-metric metric-success">
                    <span>Chamados ativos importados:</span>
                    <strong>{csvResult.importedCount}</strong>
                  </div>
                  <div className="report-metric metric-warning">
                    <span>Inativos no CVCRM:</span>
                    <strong>{csvResult.inactiveProtocols.length}</strong>
                  </div>
                  <div className="report-metric metric-danger">
                    <span>Não encontrados:</span>
                    <strong>{csvResult.missingProtocols.length}</strong>
                  </div>
                </div>

                {csvResult.missingProtocols.length > 0 && (
                  <div className="report-details-box">
                    <span>Protocolos não localizados no CVCRM:</span>
                    <div className="protocol-pills-list">
                      {csvResult.missingProtocols.map((p) => (
                        <span key={p} className="protocol-pill missing">{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                {csvResult.inactiveProtocols.length > 0 && (
                  <div className="report-details-box">
                    <span>Protocolos que constam como inativos no CVCRM:</span>
                    <div className="protocol-pills-list">
                      {csvResult.inactiveProtocols.map((p) => (
                        <span key={p} className="protocol-pill inactive">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* BLOCO 4: Sincronização Horária e Atualização Automática */}
        <section className="validation-card card-wide">
          <header className="card-header">
            <div>
              <span className="card-step-badge">ETAPA 4</span>
              <h2>Sincronização Periódica a Cada 1 Hora</h2>
              <p>
                Mantém os campos dos chamados ativos atualizados com o CVCRM e importa automaticamente
                novos atendimentos criados.
              </p>
            </div>
            <Clock size={18} className="step-icon" />
          </header>

          <div className="card-body">
            <div className="auto-sync-toggle-row">
              <div className="toggle-explanation">
                <div className="toggle-heading">
                  <Power size={16} />
                  <strong>Atualização automática a cada 1 hora (3.600s)</strong>
                </div>
                <p>
                  Quando ativada, o servidor consulta o CVCRM a cada 60 minutos, atualizando o status
                  e detalhes dos chamados ativos e trazendo novos chamados para o Kanban da ATech.
                </p>
                {(!isValidated || !isBaselineDone) && (
                  <small>
                    {!isValidated
                      ? 'Valide a conexão com a API antes de ativar.'
                      : 'Importe ao menos um chamado ativo por CSV antes de ativar.'}
                  </small>
                )}
              </div>

              <button
                type="button"
                onClick={handleToggleAutoSync}
                disabled={togglingAutoSync || !isConfigured || (!isAutoSyncActive && (!isValidated || !isBaselineDone))}
                className={`auto-sync-switch-btn ${isAutoSyncActive ? 'is-on' : 'is-off'}`}
                aria-pressed={isAutoSyncActive}
              >
                <span className="switch-knob" />
                <span>{isAutoSyncActive ? 'SINCRONIZAÇÃO ATIVA' : 'PAUSADA'}</span>
              </button>
            </div>

            <div className="sync-history-panel">
              <div className="history-row">
                <span>Último início de sincronização:</span>
                <strong>
                  {status?.state.last_started_at
                    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(
                        new Date(status.state.last_started_at),
                      )
                    : 'Nenhuma sincronização iniciada'}
                </strong>
              </div>
              <div className="history-row">
                <span>Último término:</span>
                <strong>
                  {status?.state.last_finished_at
                    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(
                        new Date(status.state.last_finished_at),
                      )
                    : '—'}
                </strong>
              </div>
              <div className="history-row">
                <span>Status da última sincronização:</span>
                <strong>
                  {status?.state.last_success === true ? (
                    <span className="sync-status-ok"><Check size={14} /> Sucesso</span>
                  ) : status?.state.last_success === false ? (
                    <span className="sync-status-fail"><AlertCircle size={14} /> Falha</span>
                  ) : (
                    'Ainda não executada'
                  )}
                </strong>
              </div>
              <div className="history-row">
                <span>Chamados ativos sincronizados:</span>
                <strong>{status?.state.imported_count ?? 0}</strong>
              </div>
              {status?.state.error_message && (
                <div className="history-error-row">
                  <ShieldAlert size={15} />
                  <span>Erro registrado: {status.state.error_message}</span>
                </div>
              )}
            </div>

            <footer className="card-footer sync-footer">
              <div className="sync-note">
                <Clock size={14} />
                <span>{isBaselineDone ? 'Sincronize a base completa manualmente ou mantenha a atualização automática pausada.' : 'Valide a paginação e carregue a carga inicial de todos os chamados ativos antes de ativar novas sincronizações.'}</span>
              </div>
              {!isBaselineDone && <button
                type="button"
                className="primary-button"
                onClick={handleImportAllActive}
                disabled={importingActive || !isConfigured || !isValidated}
              >
                <Download size={14} />
                {importingActive ? 'Importando páginas...' : 'Importar todos os chamados ativos'}
              </button>}
              <button
                type="button"
                className="secondary-button"
                onClick={handleRunManualSync}
                disabled={manualSyncing || !isConfigured || !isValidated || !isBaselineDone}
              >
                <RefreshCw size={14} className={manualSyncing ? 'spin-icon' : ''} />
                {manualSyncing ? 'Sincronizando agora...' : 'Sincronizar Tudo Manualmente Agora'}
              </button>
            </footer>
          </div>
        </section>
      </div>
    </div>
  )
}
