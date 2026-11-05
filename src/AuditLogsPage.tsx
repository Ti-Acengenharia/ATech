import { useCallback, useEffect, useState, useMemo } from 'react'
import { History, Search, RefreshCw, ShieldAlert, ArrowLeft, Filter, Calendar, User, Eye, X, Download, Copy, Check } from 'lucide-react'
import { apiRequest } from './api/client'
import './AuditLogsPage.css'

interface AuditLogEntry {
  id: string
  actorUserId: string | null
  actorName: string
  action: string
  resourceType: string
  resourceId: string
  summary: string
  metadata: Record<string, unknown>
  createdAt: string
}

export default function AuditLogsPage({
  onBack,
}: {
  onBack?: () => void
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [resourceFilter, setResourceFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)
  const [copiedMeta, setCopiedMeta] = useState(false)

  const parsedSelectedMeta = useMemo(() => {
    if (!selectedLog || !selectedLog.metadata) return null
    let val: unknown = selectedLog.metadata
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val)
      } catch {
        return { raw: val }
      }
    }
    if (val && typeof val === 'object' && Object.keys(val).length > 0) {
      return val as Record<string, unknown>
    }
    return null
  }, [selectedLog])

  const copyMetadataToClipboard = useCallback(async () => {
    if (!parsedSelectedMeta) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(parsedSelectedMeta, null, 2))
      setCopiedMeta(true)
      setTimeout(() => setCopiedMeta(false), 2000)
    } catch {
      // ignore
    }
  }, [parsedSelectedMeta])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs')
      setLogs(res.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os registros de auditoria.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs')
      .then((res) => {
        if (!cancelled) setLogs(res.logs)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar os registros de auditoria.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const availableResources = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.resourceType) set.add(log.resourceType)
    }
    return Array.from(set).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (resourceFilter !== 'all' && log.resourceType !== resourceFilter) return false
      if (actionFilter !== 'all' && !log.action.toLowerCase().includes(actionFilter.toLowerCase())) return false
      if (search.trim()) {
        const query = search.trim().toLowerCase()
        const text = `${log.summary} ${log.actorName} ${log.action} ${log.resourceType} ${log.resourceId}`.toLowerCase()
        if (!text.includes(query)) return false
      }
      return true
    })
  }, [logs, resourceFilter, actionFilter, search])

  function getActionBadgeClass(action: string) {
    const act = action.toLowerCase()
    if (act.includes('delete') || act.includes('lockout') || act.includes('suspend')) {
      return 'audit-badge is-danger'
    }
    if (act.includes('update') || act.includes('change') || act.includes('permission')) {
      return 'audit-badge is-warning'
    }
    if (act.includes('invite') || act.includes('create') || act.includes('activate')) {
      return 'audit-badge is-success'
    }
    return 'audit-badge is-info'
  }

  function formatDateTime(iso: string) {
    if (!iso) return '—'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function exportCsv() {
    if (!filteredLogs.length) return
    const header = ['ID', 'Data/Hora', 'Responsável', 'Ação', 'Recurso', 'ID Recurso', 'Resumo']
    const rows = filteredLogs.map((l) => [
      l.id,
      formatDateTime(l.createdAt),
      `"${(l.actorName || 'Sistema').replace(/"/g, '""')}"`,
      `"${l.action.replace(/"/g, '""')}"`,
      `"${l.resourceType.replace(/"/g, '""')}"`,
      `"${l.resourceId.replace(/"/g, '""')}"`,
      `"${l.summary.replace(/"/g, '""')}"`,
    ])
    const csvContent = '\uFEFF' + [header.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `atech_auditoria_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="audit-page">
      <header className="audit-page-header">
        <div className="audit-header-copy">
          {onBack && (
            <button type="button" className="secondary-button audit-back-btn" onClick={onBack}>
              <ArrowLeft size={15} /> Voltar
            </button>
          )}
          <span className="eyebrow"><History size={13} /> GOVERNANÇA & SEGURANÇA</span>
          <h1>Trilha de Auditoria e Logs do Sistema</h1>
          <p>Registro imutável de todas as ações administrativas, alterações de permissões e eventos críticos na plataforma.</p>
        </div>
        <div className="audit-header-actions">
          <button type="button" className="secondary-button" onClick={exportCsv} disabled={!filteredLogs.length} title="Exportar tabela atual em CSV">
            <Download size={14} /> Exportar CSV
          </button>
          <button type="button" className="primary-button" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'is-spinning' : ''} /> {loading ? 'Atualizando...' : 'Atualizar logs'}
          </button>
        </div>
      </header>

      {error && (
        <div className="notice notice-error" role="alert">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="audit-toolbar">
        <div className="audit-search-field">
          <Search size={15} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por responsável, resumo, ID ou ação..."
            aria-label="Pesquisar logs"
          />
        </div>

        <label className="audit-select-field">
          <span><Filter size={13} /> Módulo:</span>
          <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
            <option value="all">Todos os módulos</option>
            {availableResources.map((res) => (
              <option key={res} value={res}>{res}</option>
            ))}
          </select>
        </label>

        <label className="audit-select-field">
          <span>Ação:</span>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="all">Todas as ações</option>
            <option value="invite">Convites</option>
            <option value="status">Mudança de status</option>
            <option value="role">Cargos / Admin</option>
            <option value="page_access">Permissões de página</option>
            <option value="lockout">Bloqueios de login</option>
            <option value="delete">Exclusões</option>
            <option value="config">Configurações globais</option>
          </select>
        </label>

        <span className="audit-count-badge">
          {filteredLogs.length} log(s) encontrado(s)
        </span>
      </div>

      {/* Tabela de Logs */}
      <div className="audit-table-card">
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Data / Hora</th>
                <th>Ação</th>
                <th>Módulo</th>
                <th>Responsável</th>
                <th>Resumo da Operação</th>
                <th className="audit-action-col">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="audit-date-cell">
                      <Calendar size={13} />
                      <time>{formatDateTime(log.createdAt)}</time>
                    </td>
                    <td>
                      <span className={getActionBadgeClass(log.action)}>
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <span className="audit-resource-tag">
                        {log.resourceType}
                        {log.resourceId ? ` #${log.resourceId}` : ''}
                      </span>
                    </td>
                    <td className="audit-user-cell">
                      <User size={13} />
                      <strong>{log.actorName || 'Sistema / Cron'}</strong>
                    </td>
                    <td className="audit-summary-cell">
                      <span>{log.summary}</span>
                    </td>
                    <td className="audit-action-col">
                      <button
                        type="button"
                        className="audit-view-btn"
                        onClick={() => setSelectedLog(log)}
                        title="Ver metadados do evento"
                        aria-label="Ver detalhes do log"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="audit-empty-cell">
                    {loading ? 'Carregando trilha de auditoria...' : 'Nenhum log encontrado para os filtros selecionados.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Detalhes do Log */}
      {selectedLog && (
        <div className="audit-modal-backdrop" onClick={() => setSelectedLog(null)} role="dialog" aria-modal="true">
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <header className="audit-modal-header">
              <div>
                <span className="eyebrow">DETALHES DO EVENTO DE AUDITORIA</span>
                <h2>Log #{selectedLog.id}</h2>
              </div>
              <button type="button" className="audit-modal-close" onClick={() => setSelectedLog(null)} aria-label="Fechar">
                <X size={18} />
              </button>
            </header>
            <div className="audit-modal-body">
              <div className="audit-modal-grid">
                <div><span>Data/Hora</span><strong>{formatDateTime(selectedLog.createdAt)}</strong></div>
                <div><span>Responsável</span><strong>{selectedLog.actorName || 'Sistema'} (ID {selectedLog.actorUserId || 'N/A'})</strong></div>
                <div><span>Ação</span><strong className={getActionBadgeClass(selectedLog.action)}>{selectedLog.action}</strong></div>
                <div><span>Módulo / Recurso</span><strong>{selectedLog.resourceType} (ID: {selectedLog.resourceId || 'N/A'})</strong></div>
              </div>
              <div className="audit-modal-summary-box">
                <span>Resumo da Operação</span>
                <p>{selectedLog.summary}</p>
              </div>
              <div className="audit-modal-meta-box">
                <div className="audit-meta-header">
                  <span>Metadados Técnicos (JSON)</span>
                  {parsedSelectedMeta && (
                    <button
                      type="button"
                      className="audit-meta-copy-btn"
                      onClick={() => void copyMetadataToClipboard()}
                      title="Copiar JSON para área de transferência"
                    >
                      {copiedMeta ? <Check size={12} /> : <Copy size={12} />}
                      {copiedMeta ? 'Copiado!' : 'Copiar JSON'}
                    </button>
                  )}
                </div>
                {parsedSelectedMeta ? (
                  <pre>{JSON.stringify(parsedSelectedMeta, null, 2)}</pre>
                ) : (
                  <p className="audit-meta-empty">Nenhum metadado adicional registrado para este evento.</p>
                )}
              </div>
            </div>
            <footer className="audit-modal-footer">
              <button type="button" className="secondary-button" onClick={() => setSelectedLog(null)}>Fechar</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
