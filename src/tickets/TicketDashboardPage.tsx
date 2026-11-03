import { useEffect, useState } from 'react'
import { Activity, ArrowLeft, BarChart3, CheckCheck, CircleCheck, CircleX, Clock3, RefreshCw, Search, Ticket, X } from 'lucide-react'
import { apiRequest } from '../api/client'
import SearchableMultiSelect from '../SearchableMultiSelect'
import './TicketDashboardPage.css'

interface DashboardOptions {
  enterprises: string[]
  blocks: string[]
  units: string[]
  subjects: string[]
  subsubjects: string[]
  years: number[]
  dashboardSubjects: Array<{ value: string; label: string }>
}

interface EnterpriseCount {
  enterprise: string
  clients: number
  condominiums: number
  total: number
}

interface StatusCount {
  enterprise: string
  status: string
  count: number
}

interface MonthlyCount {
  month: string
  year: number
  created: number
  completed: number
  canceled: number
  balance: number
}

interface TicketDashboardData {
  active_total: number
  created_this_month: number
  completed_this_month: number
  canceled_this_month: number
  balance_this_month: number
  average_days: number | null
  last_updated: string | null
  active_by_enterprise: EnterpriseCount[]
  status_summary: StatusCount[]
  months: MonthlyCount[]
}

const countFormat = new Intl.NumberFormat('pt-BR')
const decimalFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long' })
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const monthNames = Array.from({ length: 12 }, (_, index) => monthFormat.format(new Date(2020, index, 1)))

function formatMonth(value: string) {
  const month = Number(value.slice(5, 7))
  return monthNames[month - 1] ?? value
}

function formatDateTime(value: string) {
  return dateTimeFormat.format(new Date(value))
}

function buildDashboardQuery(filters: {
  enterprises: string[]
  blocks: string[]
  units: string[]
  subjects: string[]
  subsubjects: string[]
  types: string[]
  customer: string
  fromYear: number
}) {
  const params = new URLSearchParams()
  for (const value of filters.enterprises) params.append('enterprise', value)
  for (const value of filters.blocks) params.append('block', value)
  for (const value of filters.units) params.append('unit', value)
  for (const value of filters.subjects) params.append('subject', value)
  for (const value of filters.subsubjects) params.append('subsubject', value)
  for (const value of filters.types) params.append('type', value)
  if (filters.customer.trim()) params.set('customer', filters.customer.trim())
  params.set('fromYear', String(filters.fromYear))
  return params.toString()
}

const TICKET_DASHBOARD_STORAGE_KEY = 'atech_ticket_dashboard_filters'

interface SavedTicketDashboardFilters {
  enterprises?: string[]
  blocks?: string[]
  units?: string[]
  subjects?: string[]
  subsubjects?: string[]
  types?: string[]
  customerQuery?: string
  fromYear?: number | null
}

function loadSavedTicketDashboardFilters(): SavedTicketDashboardFilters {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(TICKET_DASHBOARD_STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as SavedTicketDashboardFilters
  } catch {
    return {}
  }
}

export default function TicketDashboardPage({ onBack }: { onBack: () => void }) {
  const [options, setOptions] = useState<DashboardOptions>({
    enterprises: [], blocks: [], units: [], subjects: [], subsubjects: [], years: [], dashboardSubjects: [],
  })
  const [data, setData] = useState<TicketDashboardData | null>(null)
  const [initialFilters] = useState(() => loadSavedTicketDashboardFilters())
  const [enterprises, setEnterprises] = useState<string[]>(() => initialFilters.enterprises ?? [])
  const [blocks, setBlocks] = useState<string[]>(() => initialFilters.blocks ?? [])
  const [units, setUnits] = useState<string[]>(() => initialFilters.units ?? [])
  const [subjects, setSubjects] = useState<string[]>(() => initialFilters.subjects ?? [])
  const [subsubjects, setSubsubjects] = useState<string[]>(() => initialFilters.subsubjects ?? [])
  const [types, setTypes] = useState<string[]>(() => initialFilters.types ?? ['client', 'condominium'])
  const [customer, setCustomer] = useState(() => initialFilters.customerQuery ?? '')
  const [customerQuery, setCustomerQuery] = useState(() => initialFilters.customerQuery ?? '')
  const [fromYear, setFromYear] = useState<number | null>(() => initialFilters.fromYear ?? null)

  useEffect(() => {
    try {
      const stateToSave: SavedTicketDashboardFilters = {
        enterprises,
        blocks,
        units,
        subjects,
        subsubjects,
        types,
        customerQuery,
        fromYear,
      }
      localStorage.setItem(TICKET_DASHBOARD_STORAGE_KEY, JSON.stringify(stateToSave))
    } catch {
      // ignore storage access issues
    }
  }, [enterprises, blocks, units, subjects, subsubjects, types, customerQuery, fromYear])
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedQuery, setLoadedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [optionsError, setOptionsError] = useState('')
  const dashboardQuery = fromYear === null
    ? ''
    : buildDashboardQuery({ enterprises, blocks, units, subjects, subsubjects, types, customer, fromYear })
  const requestKey = `${dashboardQuery}|${refreshKey}`
  const isFetching = loading || loadedQuery !== requestKey

  useEffect(() => {
    let cancelled = false
    apiRequest<DashboardOptions>('/api/tickets/filter-options?includeInactive=true')
      .then((result) => {
        if (cancelled) return
        setOptions(result)
        setFromYear((current) => current ?? result.years[0] ?? new Date().getFullYear())
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setOptionsError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as opções dos filtros.')
          setFromYear((current) => current ?? new Date().getFullYear())
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (fromYear === null) return
    let cancelled = false
    apiRequest<{ dashboardSubjects: DashboardOptions['dashboardSubjects'] }>(
      `/api/tickets/filter-options?includeInactive=true&fromYear=${fromYear}`,
    )
      .then((result) => {
        if (cancelled) return
        setOptions((current) => ({ ...current, dashboardSubjects: result.dashboardSubjects }))
        const availableValues = new Set(result.dashboardSubjects.map((option) => option.value))
        setSubjects((current) => current.filter((subject) => availableValues.has(subject)))
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setOptionsError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os assuntos do período selecionado.')
      })
    return () => { cancelled = true }
  }, [fromYear])

  useEffect(() => {
    const timer = window.setTimeout(() => setCustomer(customerQuery.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [customerQuery])

  useEffect(() => {
    let cancelled = false
    if (!dashboardQuery) return () => { cancelled = true }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      apiRequest<{ dashboard: TicketDashboardData }>(`/api/tickets/dashboard?${dashboardQuery}`, { signal: controller.signal })
        .then((result) => {
          if (cancelled) return
          setData(result.dashboard)
          setLoadedQuery(requestKey)
          setError('')
        })
        .catch((requestError: unknown) => {
          if (cancelled) return
          setData(null)
          setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o dashboard dos chamados.')
          setLoadedQuery(requestKey)
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [dashboardQuery, requestKey])

  const enterpriseNames = data?.active_by_enterprise.map((entry) => entry.enterprise) ?? []
  const statuses = [...new Set(data?.status_summary.map((entry) => entry.status) ?? [])]
  const enterpriseTotals = data?.active_by_enterprise.reduce((totals, entry) => ({
    clients: totals.clients + entry.clients,
    condominiums: totals.condominiums + entry.condominiums,
    total: totals.total + entry.total,
  }), { clients: 0, condominiums: 0, total: 0 }) ?? { clients: 0, condominiums: 0, total: 0 }
  const statusTotals = new Map<string, number>()
  const statusByEnterprise = new Map<string, number>()
  for (const entry of data?.status_summary ?? []) {
    statusByEnterprise.set(`${entry.status}\u0000${entry.enterprise}`, entry.count)
    statusTotals.set(entry.status, (statusTotals.get(entry.status) ?? 0) + entry.count)
  }

  function toggleType(type: string) {
    setTypes((current) => current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type])
  }

  function clearFilters() {
    setEnterprises([])
    setBlocks([])
    setUnits([])
    setSubjects([])
    setSubsubjects([])
    setTypes(['client', 'condominium'])
    setCustomerQuery('')
    setCustomer('')
    const defaultYear = options.years[0] ?? new Date().getFullYear()
    setFromYear(defaultYear)
    try {
      localStorage.removeItem(TICKET_DASHBOARD_STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  const hasActiveFilters = Boolean(
    enterprises.length || blocks.length || units.length || subjects.length || subsubjects.length ||
    customerQuery.trim() || types.length !== 2 || (options.years.length && fromYear !== options.years[0]),
  )
  const closedThisMonthTotal = (data?.completed_this_month ?? 0) + (data?.canceled_this_month ?? 0)

  return <section className="ticket-dashboard-page">
    <header className="ticket-dashboard-heading">
      <div><span className="eyebrow">ANÁLISE CVCRM</span><h1>Dashboard de chamados</h1><p>Volume, situações e movimentação dos atendimentos por empreendimento.</p></div>
      <div className="ticket-dashboard-actions">
        {data?.last_updated && <span className="ticket-dashboard-updated">Última sincronização {formatDateTime(data.last_updated)}</span>}
        <button type="button" className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={isFetching}><RefreshCw size={15} /> Atualizar</button>
        <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> Voltar aos chamados</button>
      </div>
    </header>

    {!isFetching && (error || optionsError) && <div className="notice notice-error" role="alert">{error || optionsError}</div>}

    <section className="ticket-dashboard-filters-panel" aria-label="Filtros do dashboard">
      <div className="ticket-dashboard-filters-header">
        <strong>Filtros do período e empreendimento</strong>
        <button type="button" className="filter-clear-button" disabled={!hasActiveFilters} onClick={clearFilters}><X size={14} /> Limpar filtros</button>
      </div>
      <div className="ticket-dashboard-filters">
        <label className="ticket-dashboard-year-filter"><span>Considerar chamados a partir de</span><select value={fromYear ?? ''} onChange={(event) => setFromYear(Number(event.target.value))} disabled={!options.years.length}><option value="" disabled>Selecione o ano</option>{options.years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <SearchableMultiSelect label="Empreendimentos" options={options.enterprises} value={enterprises} onChange={setEnterprises} />
        <SearchableMultiSelect label="Blocos" options={options.blocks} value={blocks} onChange={setBlocks} />
        <SearchableMultiSelect label="Unidades" options={options.units} value={units} onChange={setUnits} />
        <label className="ticket-dashboard-customer"><span>Cliente</span><div><Search size={15} /><input type="search" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Buscar por nome" /></div></label>
        <SearchableMultiSelect label="Assuntos" options={options.dashboardSubjects} value={subjects} onChange={setSubjects} />
        <SearchableMultiSelect label="Subassuntos" options={options.subsubjects} value={subsubjects} onChange={setSubsubjects} />
        <div className="ticket-dashboard-type-filter" role="group" aria-label="Tipo de chamado">
          <span>Tipo de chamado</span>
          <div className="ticket-dashboard-type-options">
            <label><input type="checkbox" checked={types.includes('client')} onChange={() => toggleType('client')} /> Cliente</label>
            <label><input type="checkbox" checked={types.includes('condominium')} onChange={() => toggleType('condominium')} /> Condomínio</label>
          </div>
        </div>
      </div>
    </section>

    {isFetching
      ? <div className="ticket-dashboard-loading" role="status" aria-live="polite">
        <RefreshCw size={19} className="ticket-dashboard-loading-icon" />
        <strong>Carregando dados do dashboard</strong>
        <span>Os indicadores serão exibidos assim que a consulta dos filtros terminar.</span>
      </div>
      : <>
    <div className="ticket-dashboard-section-heading">
      <div className="ticket-dashboard-section-title-group">
        <span className="eyebrow">RESUMO DO PERÍODO</span>
        <div className="ticket-dashboard-title-row">
          <h2>Indicadores do mês atual</h2>
          <span className="ticket-dashboard-avg-days">
            <Clock3 size={14} />
            Prazo médio de finalização: <strong>{data?.average_days == null ? '—' : `${decimalFormat.format(data.average_days)} dias`}</strong>
          </span>
        </div>
      </div>
    </div>
    <section className="ticket-dashboard-metrics" aria-label="Indicadores do mês atual">
      <article className="ticket-dashboard-metric metric-active"><span><Ticket size={16} />Chamados ativos</span><strong>{countFormat.format(data?.active_total ?? 0)}</strong><small>Ativos no CVCRM</small></article>
      <article className="ticket-dashboard-metric"><span><BarChart3 size={16} />Criados no mês</span><strong>{countFormat.format(data?.created_this_month ?? 0)}</strong><small>Por data de abertura</small></article>
      <article className="ticket-dashboard-metric"><span><CircleCheck size={16} />Finalizados no mês</span><strong>{countFormat.format(data?.completed_this_month ?? 0)}</strong><small>Registrados no histórico do CVCRM</small></article>
      <article className="ticket-dashboard-metric"><span><CircleX size={16} />Cancelados no mês</span><strong>{countFormat.format(data?.canceled_this_month ?? 0)}</strong><small>Registrados no histórico do CVCRM</small></article>
      <article className="ticket-dashboard-metric"><span><CheckCheck size={16} />Finalizados + cancelados no mês</span><strong>{countFormat.format(closedThisMonthTotal)}</strong><small>Soma de finalizados e cancelados no mês</small></article>
      <article className="ticket-dashboard-metric"><span><Activity size={16} />Saldo do mês</span><strong>{countFormat.format(data?.balance_this_month ?? 0)}</strong><small>Criados − finalizados − cancelados</small></article>
    </section>

    <section className="ticket-dashboard-panel">
      <header className="ticket-dashboard-panel-heading"><div><span className="eyebrow">CHAMADOS ATIVOS</span><h2>Resumo por empreendimento</h2></div><strong>{countFormat.format(enterpriseTotals.total)} ativos</strong></header>
      <div className="ticket-dashboard-table-wrap"><table className="ticket-dashboard-table">
        <thead><tr><th>Empreendimento</th><th>Clientes</th><th>Condomínio</th><th>Total ativos</th></tr></thead>
        <tbody>{data?.active_by_enterprise.map((entry) => <tr key={entry.enterprise}><td>{entry.enterprise}</td><td>{countFormat.format(entry.clients)}</td><td>{countFormat.format(entry.condominiums)}</td><td><strong>{countFormat.format(entry.total)}</strong></td></tr>)}
          {!data?.active_by_enterprise.length && <tr><td colSpan={4} className="ticket-dashboard-empty">Nenhum chamado ativo para os filtros selecionados.</td></tr>}
        </tbody>
        <tfoot><tr><th>Total</th><th>{countFormat.format(enterpriseTotals.clients)}</th><th>{countFormat.format(enterpriseTotals.condominiums)}</th><th>{countFormat.format(enterpriseTotals.total)}</th></tr></tfoot>
      </table></div>
    </section>

    <section className="ticket-dashboard-panel">
      <header className="ticket-dashboard-panel-heading"><div><span className="eyebrow">SITUAÇÕES DO CVCRM</span><h2>Chamados ativos por empreendimento</h2></div></header>
      <div className="ticket-dashboard-table-wrap"><table className="ticket-dashboard-table ticket-dashboard-status-table">
        <thead><tr><th>Situação</th>{enterpriseNames.map((enterprise) => <th key={enterprise}>{enterprise}</th>)}<th>Total</th></tr></thead>
        <tbody>{statuses.map((status) => <tr key={status}><td>{status}</td>{enterpriseNames.map((enterprise) => <td key={enterprise}>{statusByEnterprise.get(`${status}\u0000${enterprise}`) ? countFormat.format(statusByEnterprise.get(`${status}\u0000${enterprise}`)!) : '—'}</td>)}<td><strong>{countFormat.format(statusTotals.get(status) ?? 0)}</strong></td></tr>)}
          {!statuses.length && <tr><td colSpan={enterpriseNames.length + 2} className="ticket-dashboard-empty">Nenhum chamado ativo para os filtros selecionados.</td></tr>}
        </tbody>
        {!!statuses.length && <tfoot><tr><th>Total</th>{enterpriseNames.map((enterprise) => <th key={enterprise}>{countFormat.format(data?.active_by_enterprise.find((entry) => entry.enterprise === enterprise)?.total ?? 0)}</th>)}<th>{countFormat.format(data?.active_total ?? 0)}</th></tr></tfoot>}
      </table></div>
    </section>

    <section className="ticket-dashboard-panel">
      <header className="ticket-dashboard-panel-heading"><div><span className="eyebrow">EVOLUÇÃO MENSAL</span><h2>Movimentação de chamados</h2></div></header>
      <div className="ticket-dashboard-table-wrap"><table className="ticket-dashboard-table ticket-dashboard-month-table">
        <thead><tr><th>Ano</th><th>Mês</th><th>Criados</th><th>Finalizados</th><th>Cancelados</th><th>Finalizados + cancelados</th><th>Saldo do mês</th></tr></thead>
        <tbody>{(data?.months ?? []).map((month) => <tr key={`${month.year}-${month.month}`}><td>{month.year}</td><td>{formatMonth(month.month)}</td><td>{countFormat.format(month.created)}</td><td>{countFormat.format(month.completed)}</td><td>{countFormat.format(month.canceled)}</td><td>{countFormat.format(month.completed + month.canceled)}</td><td><strong>{countFormat.format(month.balance)}</strong></td></tr>)}
          {!data?.months.length && <tr><td colSpan={7} className="ticket-dashboard-empty">Nenhuma movimentação para este ano e filtros.</td></tr>}
        </tbody>
      </table></div>
      <p className="ticket-dashboard-footnote">São considerados chamados abertos a partir do ano selecionado, inclusive. Finalizações e cancelamentos usam o histórico de mudanças quando disponível; para chamados históricos sem eventos locais, a data de última alteração da situação do CVCRM é usada como aproximação. O saldo de cada mês é calculado por criados menos finalizados e cancelados naquele mês.</p>
    </section>
    </>}
  </section>
}
