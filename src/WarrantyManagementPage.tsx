import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, RefreshCw, Save, Search, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api/client'

interface WarrantySubsubject {
  sourceSubsubjectId: number
  name: string
  warrantyYears: number | null
  active: boolean
  syncedAt: string | null
}

interface WarrantyListResponse {
  subsubjects: WarrantySubsubject[]
}

function loadSubsubjects() {
  return apiRequest<WarrantyListResponse>('/api/warranties')
}

export default function WarrantyManagementPage() {
  const [subsubjects, setSubsubjects] = useState<WarrantySubsubject[]>([])
  const [years, setYears] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function reload() {
    const result = await loadSubsubjects()
    setSubsubjects(result.subsubjects)
    setYears(Object.fromEntries(result.subsubjects.map((item) => [
      item.sourceSubsubjectId,
      item.warrantyYears === null ? '' : String(item.warrantyYears),
    ])))
  }

  useEffect(() => {
    let cancelled = false
    loadSubsubjects()
      .then((result) => {
        if (cancelled) return
        setSubsubjects(result.subsubjects)
        setYears(Object.fromEntries(result.subsubjects.map((item) => [
          item.sourceSubsubjectId,
          item.warrantyYears === null ? '' : String(item.warrantyYears),
        ])))
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os prazos de garantia.' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function syncCatalog() {
    setSyncing(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ synced: number }>('/api/warranties/sync', { method: 'POST' })
      await reload()
      setNotice({ kind: 'success', text: `${result.synced} subassunto(s) de Assistência técnica sincronizado(s) do CVCRM.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível sincronizar o catálogo do CVCRM.' })
    } finally {
      setSyncing(false)
    }
  }

  async function saveYears(item: WarrantySubsubject) {
    const value = years[item.sourceSubsubjectId] ?? ''
    const parsed = value === '' ? null : Number(value)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)) {
      setNotice({ kind: 'error', text: 'Informe um prazo inteiro entre 1 e 100 anos ou deixe em branco.' })
      return
    }
    setSavingId(item.sourceSubsubjectId)
    setNotice(null)
    try {
      await apiRequest(`/api/warranties/${item.sourceSubsubjectId}`, {
        method: 'PUT',
        body: JSON.stringify({ warrantyYears: parsed }),
      })
      setSubsubjects((current) => current.map((entry) => entry.sourceSubsubjectId === item.sourceSubsubjectId
        ? { ...entry, warrantyYears: parsed }
        : entry))
      setNotice({ kind: 'success', text: `Prazo de garantia de “${item.name}” salvo.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar este prazo.' })
    } finally {
      setSavingId(null)
    }
  }

  const filtered = useMemo(() => subsubjects
    .filter((item) => showInactive || item.active)
    .filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [subsubjects, search, showInactive])
  const configuredCount = subsubjects.filter((item) => item.active && item.warrantyYears !== null).length

  return (
    <section className="warranty-page">
      <header className="page-heading-row">
        <div><div className="eyebrow page-eyebrow">GESTÃO DA OPERAÇÃO</div><h1>Prazos de garantia</h1><p>Configure a garantia de cada subassunto de Assistência técnica do CVCRM.</p></div>
        <button type="button" className="primary-button" onClick={() => void syncCatalog()} disabled={syncing}>
          <RefreshCw size={15} className={syncing ? 'warranty-spinning' : ''} />{syncing ? 'Sincronizando...' : 'Sincronizar subassuntos'}
        </button>
      </header>

      {notice && <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span className="notice-symbol">{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

      <section className="warranty-summary">
        <span className="warranty-summary-icon"><ShieldCheck size={19} /></span>
        <div><strong>Assunto: Assistência técnica · ID 16</strong><p>{configuredCount} de {subsubjects.filter((item) => item.active).length} subassunto(s) ativo(s) com prazo configurado. Chamados sem prazo ou sem data de entrega serão sinalizados como indeterminados.</p></div>
      </section>

      <section className="directory-section warranty-directory" aria-labelledby="warranty-list-heading">
        <div className="directory-heading"><div><h2 id="warranty-list-heading">Subassuntos e respectivos prazos</h2><p>O período é contado em anos corridos a partir da data de entrega, inclusive até o aniversário final.</p></div><label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar subassunto" aria-label="Buscar subassunto" /></label></div>
        <label className="warranty-inactive-toggle"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Mostrar subassuntos que não vieram na última sincronização</label>
        <div className="user-table-wrap">
          <table className="user-table warranty-table"><thead><tr><th>SUBASSUNTO</th><th>GARANTIA (ANOS)</th><th>STATUS</th><th><span className="sr-only">Ação</span></th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4} className="table-message">Carregando subassuntos...</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={4} className="table-message">{subsubjects.length ? 'Nenhum subassunto corresponde aos filtros.' : 'Nenhum subassunto carregado. Sincronize o catálogo do CVCRM.'}</td></tr>
                  : filtered.map((item) => <tr key={item.sourceSubsubjectId} className={!item.active ? 'warranty-row-inactive' : ''}>
                    <td><strong>{item.name}</strong><small className="warranty-source-id">ID CVCRM {item.sourceSubsubjectId}{!item.active ? ' · não retornado na última sincronização' : ''}</small></td>
                    <td><label className="warranty-years-field"><input type="number" min="1" max="100" step="1" value={years[item.sourceSubsubjectId] ?? ''} onChange={(event) => setYears((current) => ({ ...current, [item.sourceSubsubjectId]: event.target.value }))} aria-label={`Prazo de garantia em anos para ${item.name}`} placeholder="Não configurado" /><span>anos</span></label></td>
                    <td><span className={`status-pill ${item.warrantyYears === null ? 'status-invited' : 'status-active'}`}><i />{item.warrantyYears === null ? 'Prazo pendente' : 'Configurado'}</span></td>
                    <td className="action-cell"><button type="button" className="row-action warranty-save" onClick={() => void saveYears(item)} disabled={savingId === item.sourceSubsubjectId} title={`Salvar prazo para ${item.name}`} aria-label={`Salvar prazo para ${item.name}`}><Save size={16} /></button></td>
                  </tr>)}
            </tbody>
          </table>
        </div>
        <footer className="table-footer"><span><ShieldCheck size={14} /> As regras são aplicadas aos chamados atuais e futuros do assunto Assistência técnica.</span><span>{filtered.length} item(ns)</span></footer>
      </section>
    </section>
  )
}
