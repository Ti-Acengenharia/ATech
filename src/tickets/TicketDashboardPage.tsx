import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Calendar,
  CheckCheck,
  CircleCheck,
  CircleX,
  Clock3,
  Download,
  Filter,
  LayoutGrid,
  List,
  MoveHorizontal,
  RefreshCw,
  Search,
  Ticket,
  X,
} from 'lucide-react'
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
  internals?: number
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
  average_days_this_month: number | null
  selected_month_key: string | null
  selected_month_label: string | null
  last_updated: string | null
  active_by_enterprise: EnterpriseCount[]
  status_summary: StatusCount[]
  months: MonthlyCount[]
  query_ms?: number
}

const countFormat = new Intl.NumberFormat('pt-BR')
const decimalFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 })
const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long' })
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const monthNames = Array.from({ length: 12 }, (_, index) => monthFormat.format(new Date(2020, index, 1)))

function formatMonth(value: string) {
  const month = Number(value.slice(5, 7))
  return monthNames[month - 1] ?? value
}

function formatMonthYear(monthStr: string, year: number) {
  return `${formatMonth(monthStr)} de ${year}`
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
  referenceMonth?: string | null
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
  if (filters.referenceMonth) params.set('referenceMonth', filters.referenceMonth)
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

type EnterpriseSortField = 'enterprise' | 'clients' | 'condominiums' | 'internals' | 'total'
type SortOrder = 'asc' | 'desc'
type StatusSortField = 'status' | 'total'
type MonthSortField = 'date' | 'created' | 'completed' | 'canceled' | 'closedTotal' | 'balance'

export default function TicketDashboardPage({
  onBack,
  onSelectView,
}: {
  onBack: () => void
  onSelectView?: (view: 'kanban' | 'list') => void
}) {
  const [options, setOptions] = useState<DashboardOptions>({
    enterprises: [],
    blocks: [],
    units: [],
    subjects: [],
    subsubjects: [],
    years: [],
    dashboardSubjects: [],
  })
  const [data, setData] = useState<TicketDashboardData | null>(null)
  const [initialFilters] = useState(() => loadSavedTicketDashboardFilters())
  const [enterprises, setEnterprises] = useState<string[]>(() => initialFilters.enterprises ?? [])
  const [blocks, setBlocks] = useState<string[]>(() => initialFilters.blocks ?? [])
  const [units, setUnits] = useState<string[]>(() => initialFilters.units ?? [])
  const [subjects, setSubjects] = useState<string[]>(() => initialFilters.subjects ?? [])
  const [subsubjects, setSubsubjects] = useState<string[]>(() => initialFilters.subsubjects ?? [])
  const [types, setTypes] = useState<string[]>(() => {
    const saved = initialFilters.types
    if (!saved || saved.length === 0) return ['client', 'condominium', 'internal']
    if (saved.length === 2 && saved.includes('client') && saved.includes('condominium') && !saved.includes('internal')) {
      return ['client', 'condominium', 'internal']
    }
    return saved
  })
  const [customer, setCustomer] = useState(() => initialFilters.customerQuery ?? '')
  const [customerQuery, setCustomerQuery] = useState(() => initialFilters.customerQuery ?? '')
  const [fromYear, setFromYear] = useState<number>(() => initialFilters.fromYear ?? 2021)

  // Novo: Filtro de Mês de Referência para os Indicadores do Mês
  const [referenceMonth, setReferenceMonth] = useState<string>('')

  // Controles da Tabela de Empreendimentos
  const [enterpriseSearch, setEnterpriseSearch] = useState('')
  const [enterpriseSortField, setEnterpriseSortField] = useState<EnterpriseSortField>('total')
  const [enterpriseSortOrder, setEnterpriseSortOrder] = useState<SortOrder>('desc')
  const [showClientsCol, setShowClientsCol] = useState(true)
  const [showCondoCol, setShowCondoCol] = useState(true)
  const [showInternalsCol, setShowInternalsCol] = useState(true)

  // Controles da Tabela de Situações
  const [statusSearch, setStatusSearch] = useState('')
  const [hideZeroStatuses, setHideZeroStatuses] = useState(false)
  const [statusSortField, setStatusSortField] = useState<StatusSortField>('total')
  const [statusSortOrder, setStatusSortOrder] = useState<SortOrder>('desc')

  // Controles da Tabela de Evolução Mensal
  const currentYear = new Date().getFullYear()
  const [monthlyYearFilter, setMonthlyYearFilter] = useState<string>(() => String(currentYear))
  const [monthSortField, setMonthSortField] = useState<MonthSortField>('date')
  const [monthSortOrder, setMonthSortOrder] = useState<SortOrder>('desc')

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

  const dashboardQuery =
    fromYear === null
      ? ''
      : buildDashboardQuery({
        enterprises,
        blocks,
        units,
        subjects,
        subsubjects,
        types,
        customer,
        fromYear,
        referenceMonth: referenceMonth || null,
      })
  const requestKey = `${dashboardQuery}|${refreshKey}`
  const isFetching = loading || loadedQuery !== requestKey
  const isInitialLoadRef = useRef(true)
  const initialYear = initialFilters.fromYear ?? 2021
  const lastLoadedFromYearRef = useRef<number | null>(initialYear)

  useEffect(() => {
    let cancelled = false
    const url = `/api/tickets/filter-options?includeInactive=true&fromYear=${initialYear}`
    apiRequest<DashboardOptions>(url)
      .then((result) => {
        if (cancelled) return
        setOptions(result)
        lastLoadedFromYearRef.current = initialYear
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setOptionsError(
            requestError instanceof Error ? requestError.message : 'Não foi possível carregar as opções dos filtros.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [initialYear])

  useEffect(() => {
    if (fromYear === lastLoadedFromYearRef.current) return
    let cancelled = false
    lastLoadedFromYearRef.current = fromYear
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
        if (!cancelled)
          setOptionsError(
            requestError instanceof Error
              ? requestError.message
              : 'Não foi possível carregar os assuntos do período selecionado.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [fromYear])

  useEffect(() => {
    const timer = window.setTimeout(() => setCustomer(customerQuery.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [customerQuery])

  useEffect(() => {
    let cancelled = false
    if (!dashboardQuery)
      return () => {
        cancelled = true
      }
    const controller = new AbortController()
    const isInstant = isInitialLoadRef.current
    const delay = isInstant ? 0 : 250
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      const freshParam = refreshKey > 0 ? '&fresh=true' : ''
      apiRequest<{ dashboard: TicketDashboardData }>(`/api/tickets/dashboard?${dashboardQuery}${freshParam}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (cancelled) return
          setData(result.dashboard)
          setLoadedQuery(requestKey)
          setError('')
          isInitialLoadRef.current = false
        })
        .catch((requestError: unknown) => {
          if (cancelled) return
          if (controller.signal.aborted) return
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Não foi possível carregar o dashboard dos chamados.',
          )
          setLoadedQuery(requestKey)
          isInitialLoadRef.current = false
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [dashboardQuery, requestKey, refreshKey])

  const months = data?.months
  const activeByEnterprise = data?.active_by_enterprise
  const statusSummary = data?.status_summary

  // Lista de meses disponíveis para o seletor
  const availableMonths = useMemo(() => {
    if (!months) return []
    // Extrai chaves YYYY-MM únicas em ordem decrescente
    const list = months.map((m) => ({
      key: m.month.slice(0, 7),
      label: formatMonthYear(m.month, m.year),
      year: m.year,
    }))
    return list.reverse()
  }, [months])

  // Processamento e ordenação da Tabela 1: Resumo por Empreendimento
  const filteredAndSortedEnterprises = useMemo(() => {
    if (!activeByEnterprise) return []
    let list = [...activeByEnterprise]
    if (enterpriseSearch.trim()) {
      const q = enterpriseSearch.trim().toLowerCase()
      list = list.filter((e) => e.enterprise.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      let cmp = 0
      if (enterpriseSortField === 'enterprise') {
        cmp = a.enterprise.localeCompare(b.enterprise, 'pt-BR')
      } else {
        cmp = (a[enterpriseSortField] ?? 0) - (b[enterpriseSortField] ?? 0)
      }
      return enterpriseSortOrder === 'asc' ? cmp : -cmp
    })
    return list
  }, [activeByEnterprise, enterpriseSearch, enterpriseSortField, enterpriseSortOrder])

  // Processamento e ordenação da Tabela 2: Situações do CVCRM
  const enterpriseNames = useMemo(
    () => activeByEnterprise?.map((entry) => entry.enterprise) ?? [],
    [activeByEnterprise],
  )
  const statusTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of statusSummary ?? []) {
      map.set(entry.status, (map.get(entry.status) ?? 0) + entry.count)
    }
    return map
  }, [statusSummary])

  const statusByEnterprise = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of statusSummary ?? []) {
      map.set(`${entry.status}\u0000${entry.enterprise}`, entry.count)
    }
    return map
  }, [statusSummary])

  const enterpriseTotalsByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of activeByEnterprise ?? []) {
      map.set(entry.enterprise, entry.total)
    }
    return map
  }, [activeByEnterprise])

  const filteredAndSortedStatuses = useMemo(() => {
    let list = [...new Set(statusSummary?.map((entry) => entry.status) ?? [])]
    if (statusSearch.trim()) {
      const q = statusSearch.trim().toLowerCase()
      list = list.filter((s) => s.toLowerCase().includes(q))
    }
    if (hideZeroStatuses) {
      list = list.filter((s) => (statusTotals.get(s) ?? 0) > 0)
    }
    list.sort((a, b) => {
      if (statusSortField === 'status') {
        const cmp = a.localeCompare(b, 'pt-BR')
        return statusSortOrder === 'asc' ? cmp : -cmp
      }
      const countA = statusTotals.get(a) ?? 0
      const countB = statusTotals.get(b) ?? 0
      return statusSortOrder === 'asc' ? countA - countB : countB - countA
    })
    return list
  }, [statusSummary, statusSearch, hideZeroStatuses, statusSortField, statusSortOrder, statusTotals])

  // Processamento e ordenação da Tabela 3: Movimentação Mensal
  const availableMovementYears = useMemo(() => {
    if (!months) return [currentYear]
    const years = [...new Set(months.map((m) => m.year))]
    if (!years.includes(currentYear)) years.push(currentYear)
    return years.sort((a, b) => b - a)
  }, [months, currentYear])

  const filteredAndSortedMonths = useMemo(() => {
    if (!months) return []
    let list = [...months]
    if (monthlyYearFilter !== 'all') {
      const yr = Number(monthlyYearFilter)
      list = list.filter((m) => m.year === yr)
    }
    list.sort((a, b) => {
      let cmp = 0
      if (monthSortField === 'date') {
        cmp = a.month.localeCompare(b.month)
      } else if (monthSortField === 'created') {
        cmp = a.created - b.created
      } else if (monthSortField === 'completed') {
        cmp = a.completed - b.completed
      } else if (monthSortField === 'canceled') {
        cmp = a.canceled - b.canceled
      } else if (monthSortField === 'closedTotal') {
        cmp = a.completed + a.canceled - (b.completed + b.canceled)
      } else if (monthSortField === 'balance') {
        cmp = a.balance - b.balance
      }
      return monthSortOrder === 'asc' ? cmp : -cmp
    })
    return list
  }, [months, monthlyYearFilter, monthSortField, monthSortOrder])

  const enterpriseTotals = useMemo(() => {
    return (
      activeByEnterprise?.reduce(
        (totals, entry) => ({
          clients: totals.clients + entry.clients,
          condominiums: totals.condominiums + entry.condominiums,
          internals: totals.internals + (entry.internals ?? 0),
          total: totals.total + entry.total,
        }),
        { clients: 0, condominiums: 0, internals: 0, total: 0 },
      ) ?? { clients: 0, condominiums: 0, internals: 0, total: 0 }
    )
  }, [activeByEnterprise])

  const totalActiveTickets = data?.active_total ?? enterpriseTotals.total

  function toggleType(type: string) {
    setTypes((current) => (current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]))
  }

  function clearFilters() {
    setEnterprises([])
    setBlocks([])
    setUnits([])
    setSubjects([])
    setSubsubjects([])
    setTypes(['client', 'condominium', 'internal'])
    setCustomerQuery('')
    setCustomer('')
    const defaultYear = options.years[0] ?? new Date().getFullYear()
    setFromYear(defaultYear)
    setReferenceMonth('')
    setMonthlyYearFilter(String(new Date().getFullYear()))
    try {
      localStorage.removeItem(TICKET_DASHBOARD_STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  function handleEnterpriseSort(field: EnterpriseSortField) {
    if (enterpriseSortField === field) {
      setEnterpriseSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setEnterpriseSortField(field)
      setEnterpriseSortOrder(field === 'enterprise' ? 'asc' : 'desc')
    }
  }

  function handleMonthSort(field: MonthSortField) {
    if (monthSortField === field) {
      setMonthSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setMonthSortField(field)
      setMonthSortOrder(field === 'date' ? 'desc' : 'desc')
    }
  }

  function exportMonthlyToCsv() {
    if (!filteredAndSortedMonths.length) return
    const headers = ['Ano', 'Mes', 'Criados', 'Finalizados', 'Cancelados', 'Finalizados_Cancelados', 'Saldo']
    const rows = filteredAndSortedMonths.map((m) => [
      m.year,
      `"${formatMonth(m.month)}"`,
      m.created,
      m.completed,
      m.canceled,
      m.completed + m.canceled,
      m.balance,
    ])
    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `evolucao_mensal_chamados_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const hasActiveFilters = Boolean(
    enterprises.length ||
    blocks.length ||
    units.length ||
    subjects.length ||
    subsubjects.length ||
    customerQuery.trim() ||
    types.length !== 3 ||
    (options.years.length && fromYear !== options.years[0]) ||
    referenceMonth,
  )

  const closedThisMonthTotal = (data?.completed_this_month ?? 0) + (data?.canceled_this_month ?? 0)
  const isCustomMonth = Boolean(referenceMonth)
  const selectedMonthDisplay = data?.selected_month_label
    ? `Mês selecionado (${data.selected_month_label})`
    : 'Indicadores do mês atual'

  return (
    <section className="ticket-dashboard-page">
      <header className="ticket-dashboard-heading">
        <div>
          <span className="eyebrow">ANÁLISE CVCRM</span>
          <h1>Dashboard de chamados</h1>
          <p>Volume, situações e movimentação dos atendimentos por empreendimento.</p>
        </div>
        <div className="ticket-dashboard-actions">
          {data?.last_updated && (
            <span className="ticket-dashboard-updated">
              Última sincronização {formatDateTime(data.last_updated)}
              {typeof data.query_ms === 'number' && ` · ${data.query_ms}ms`}
            </span>
          )}
          <div className="ticket-view-toggle" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => (onSelectView ? onSelectView('kanban') : onBack())}
              title="Alternar para visão em Quadro"
            >
              <LayoutGrid size={14} /> Quadro
            </button>
            <button
              type="button"
              onClick={() => (onSelectView ? onSelectView('list') : onBack())}
              title="Alternar para visão em Lista"
            >
              <List size={14} /> Lista
            </button>
            <button
              type="button"
              className="is-active"
              title="Dashboard ativo"
            >
              <BarChart3 size={14} /> Dashboard
            </button>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={isFetching}
          >
            <RefreshCw size={15} className={isFetching ? 'ticket-dashboard-loading-icon' : ''} /> Atualizar
          </button>
          <button type="button" className="secondary-button" onClick={onBack}>
            <ArrowLeft size={15} /> Voltar aos chamados
          </button>
        </div>
      </header>

      {!isFetching && (error || optionsError) && (
        <div className="notice notice-error" role="alert">
          {error || optionsError}
        </div>
      )}

      <section className="ticket-dashboard-filters-panel" aria-label="Filtros do dashboard">
        <div className="ticket-dashboard-filters-header">
          <strong>Filtros do período e empreendimento</strong>
          <button type="button" className="filter-clear-button" disabled={!hasActiveFilters} onClick={clearFilters}>
            <X size={14} /> Limpar filtros
          </button>
        </div>
        <div className="ticket-dashboard-filters">
          <label className="ticket-dashboard-year-filter">
            <span>Considerar chamados a partir de</span>
            <select
              value={fromYear ?? ''}
              onChange={(event) => setFromYear(Number(event.target.value))}
              disabled={!options.years.length}
            >
              <option value="" disabled>
                Selecione o ano
              </option>
              {options.years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <SearchableMultiSelect
            label="Empreendimentos"
            options={options.enterprises}
            value={enterprises}
            onChange={setEnterprises}
          />
          <SearchableMultiSelect label="Blocos" options={options.blocks} value={blocks} onChange={setBlocks} />
          <SearchableMultiSelect label="Unidades" options={options.units} value={units} onChange={setUnits} />
          <label className="ticket-dashboard-customer">
            <span>Cliente</span>
            <div>
              <Search size={15} />
              <input
                type="search"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Buscar por nome"
              />
            </div>
          </label>
          <SearchableMultiSelect
            label="Assuntos"
            options={options.dashboardSubjects}
            value={subjects}
            onChange={setSubjects}
          />
          <SearchableMultiSelect
            label="Subassuntos"
            options={options.subsubjects}
            value={subsubjects}
            onChange={setSubsubjects}
          />
          <div className="ticket-dashboard-type-filter" role="group" aria-label="Tipo de chamado">
            <span>Tipo de chamado</span>
            <div className="ticket-dashboard-type-options">
              <label>
                <input
                  type="checkbox"
                  checked={types.includes('client')}
                  onChange={() => toggleType('client')}
                />{' '}
                Cliente
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={types.includes('condominium')}
                  onChange={() => toggleType('condominium')}
                />{' '}
                Condomínio
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={types.includes('internal')}
                  onChange={() => toggleType('internal')}
                />{' '}
                Interno
              </label>
            </div>
          </div>
        </div>
      </section>

      {isFetching && !data ? (
        <div className="ticket-dashboard-loading" role="status" aria-live="polite">
          <RefreshCw size={19} className="ticket-dashboard-loading-icon" />
          <strong>Carregando dados do dashboard</strong>
          <span>Os indicadores serão exibidos assim que a consulta dos filtros terminar.</span>
        </div>
      ) : data ? (
        <div style={{ opacity: isFetching ? 0.72 : 1, transition: 'opacity 0.2s ease' }}>
          {/* SEÇÃO 1: INDICADORES DO MÊS (COM SELETOR DE MÊS ANTERIOR) */}
          <div className="ticket-dashboard-section-heading">
            <div className="ticket-dashboard-section-title-group">
              <span className="eyebrow">RESUMO DO PERÍODO</span>
              <div className="ticket-dashboard-title-row">
                <h2>{selectedMonthDisplay}</h2>

                {/* Seletor de Mês de Referência */}
                <div className="ticket-dashboard-month-selector-wrap">
                  <Calendar size={14} />
                  <span>Mês de referência:</span>
                  <select
                    value={referenceMonth}
                    onChange={(e) => setReferenceMonth(e.target.value)}
                    className="ticket-dashboard-month-select"
                  >
                    <option value="">Mês atual (tempo real)</option>
                    {availableMonths.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {isCustomMonth && (
                    <button
                      type="button"
                      className="btn-reset-month"
                      onClick={() => setReferenceMonth('')}
                      title="Voltar para o mês atual"
                    >
                      <X size={12} /> Mês atual
                    </button>
                  )}
                </div>

                <span className="ticket-dashboard-avg-days">
                  <Clock3 size={14} />
                  Prazo médio de finalização:
                  <strong>
                    {data?.average_days_this_month != null
                      ? `${decimalFormat.format(data.average_days_this_month)} dias`
                      : '—'}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <section className="ticket-dashboard-metrics" aria-label="Indicadores do mês selecionado">
            <article className="ticket-dashboard-metric metric-active">
              <span>
                <Ticket size={16} />
                Chamados ativos
              </span>
              <strong>{countFormat.format(data?.active_total ?? 0)}</strong>
              <small>Ativos no CVCRM (geral)</small>
            </article>

            <article className="ticket-dashboard-metric">
              <span>
                <BarChart3 size={16} />
                Criados no mês
              </span>
              <strong>{countFormat.format(data?.created_this_month ?? 0)}</strong>
              <small>Por data de abertura</small>
            </article>

            <article className="ticket-dashboard-metric">
              <span>
                <CircleCheck size={16} />
                Finalizados no mês
              </span>
              <strong>{countFormat.format(data?.completed_this_month ?? 0)}</strong>
              <small>Registrados no histórico do CVCRM</small>
            </article>

            <article className="ticket-dashboard-metric">
              <span>
                <CircleX size={16} />
                Cancelados no mês
              </span>
              <strong>{countFormat.format(data?.canceled_this_month ?? 0)}</strong>
              <small>Registrados no histórico do CVCRM</small>
            </article>

            <article className="ticket-dashboard-metric">
              <span>
                <CheckCheck size={16} />
                Finalizados + cancelados
              </span>
              <strong>{countFormat.format(closedThisMonthTotal)}</strong>
              <small>Soma de finalizados e cancelados no período</small>
            </article>

            <article className="ticket-dashboard-metric">
              <span>
                <Activity size={16} />
                Saldo do mês
              </span>
              <strong style={{ color: (data?.balance_this_month ?? 0) < 0 ? '#10b981' : undefined }}>
                {countFormat.format(data?.balance_this_month ?? 0)}
              </strong>
              <small>Criados − finalizados − cancelados</small>
            </article>
          </section>

          {/* TABELA 1: RESUMO POR EMPREENDIMENTO (COM BUSCA, ORDENAÇÃO E TOGGLE DE COLUNAS) */}
          <section className="ticket-dashboard-panel">
            <header className="ticket-dashboard-panel-heading">
              <div>
                <span className="eyebrow">CHAMADOS ATIVOS</span>
                <h2>Resumo por empreendimento</h2>
              </div>
              <div className="panel-controls-group">
                <div className="panel-search-box">
                  <Search size={13} />
                  <input
                    type="search"
                    placeholder="Filtrar empreendimento..."
                    value={enterpriseSearch}
                    onChange={(e) => setEnterpriseSearch(e.target.value)}
                  />
                  {enterpriseSearch && (
                    <button type="button" onClick={() => setEnterpriseSearch('')} aria-label="Limpar">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="panel-col-toggle-group">
                  <label className="panel-col-toggle">
                    <input
                      type="checkbox"
                      checked={showClientsCol}
                      onChange={(e) => setShowClientsCol(e.target.checked)}
                    />
                    <span>Clientes</span>
                  </label>
                  <label className="panel-col-toggle">
                    <input
                      type="checkbox"
                      checked={showCondoCol}
                      onChange={(e) => setShowCondoCol(e.target.checked)}
                    />
                    <span>Condomínio</span>
                  </label>
                  <label className="panel-col-toggle">
                    <input
                      type="checkbox"
                      checked={showInternalsCol}
                      onChange={(e) => setShowInternalsCol(e.target.checked)}
                    />
                    <span>Internos</span>
                  </label>
                </div>
                <strong>{countFormat.format(enterpriseTotals.total)} ativos</strong>
              </div>
            </header>

            <div className="ticket-dashboard-table-wrap">
              <table className="ticket-dashboard-table">
                <thead>
                  <tr>
                    <th
                      className="sortable-th"
                      onClick={() => handleEnterpriseSort('enterprise')}
                      title="Clique para ordenar por empreendimento"
                    >
                      Empreendimento
                      {enterpriseSortField === 'enterprise' ? (
                        enterpriseSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    {showClientsCol && (
                      <th
                        className="sortable-th"
                        onClick={() => handleEnterpriseSort('clients')}
                        title="Clique para ordenar por chamados de clientes"
                      >
                        Clientes
                        {enterpriseSortField === 'clients' ? (
                          enterpriseSortOrder === 'asc' ? (
                            <ArrowUp size={11} className="sort-icon" />
                          ) : (
                            <ArrowDown size={11} className="sort-icon" />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="sort-icon-inactive" />
                        )}
                      </th>
                    )}
                    {showCondoCol && (
                      <th
                        className="sortable-th"
                        onClick={() => handleEnterpriseSort('condominiums')}
                        title="Clique para ordenar por condomínio"
                      >
                        Condomínio
                        {enterpriseSortField === 'condominiums' ? (
                          enterpriseSortOrder === 'asc' ? (
                            <ArrowUp size={11} className="sort-icon" />
                          ) : (
                            <ArrowDown size={11} className="sort-icon" />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="sort-icon-inactive" />
                        )}
                      </th>
                    )}
                    {showInternalsCol && (
                      <th
                        className="sortable-th"
                        onClick={() => handleEnterpriseSort('internals')}
                        title="Clique para ordenar por chamados internos"
                      >
                        Internos
                        {enterpriseSortField === 'internals' ? (
                          enterpriseSortOrder === 'asc' ? (
                            <ArrowUp size={11} className="sort-icon" />
                          ) : (
                            <ArrowDown size={11} className="sort-icon" />
                          )
                        ) : (
                          <ArrowUpDown size={11} className="sort-icon-inactive" />
                        )}
                      </th>
                    )}
                    <th
                      className="sortable-th"
                      onClick={() => handleEnterpriseSort('total')}
                      title="Clique para ordenar por total de chamados ativos"
                    >
                      Total ativos
                      {enterpriseSortField === 'total' ? (
                        enterpriseSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedEnterprises.map((entry) => {
                    const clientsPct = entry.total > 0 ? entry.clients / entry.total : 0
                    const condoPct = entry.total > 0 ? entry.condominiums / entry.total : 0
                    const internalsPct = entry.total > 0 ? (entry.internals ?? 0) / entry.total : 0
                    const totalPct = enterpriseTotals.total > 0 ? entry.total / enterpriseTotals.total : 0
                    return (
                      <tr key={entry.enterprise}>
                        <td>{entry.enterprise}</td>
                        {showClientsCol && (
                          <td>
                            {countFormat.format(entry.clients)}
                            <span className="ticket-dashboard-pct" title={`${percentFormat.format(clientsPct)} de clientes neste empreendimento`}>
                              ({percentFormat.format(clientsPct)})
                            </span>
                          </td>
                        )}
                        {showCondoCol && (
                          <td>
                            {countFormat.format(entry.condominiums)}
                            <span className="ticket-dashboard-pct" title={`${percentFormat.format(condoPct)} de condomínio neste empreendimento`}>
                              ({percentFormat.format(condoPct)})
                            </span>
                          </td>
                        )}
                        {showInternalsCol && (
                          <td>
                            {countFormat.format(entry.internals ?? 0)}
                            <span className="ticket-dashboard-pct" title={`${percentFormat.format(internalsPct)} de chamados internos neste empreendimento`}>
                              ({percentFormat.format(internalsPct)})
                            </span>
                          </td>
                        )}
                        <td>
                          <strong>{countFormat.format(entry.total)}</strong>
                          <span className="ticket-dashboard-pct" title={`${percentFormat.format(totalPct)} do total de chamados ativos`}>
                            ({percentFormat.format(totalPct)} do total)
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredAndSortedEnterprises.length && (
                    <tr>
                      <td colSpan={2 + (showClientsCol ? 1 : 0) + (showCondoCol ? 1 : 0) + (showInternalsCol ? 1 : 0)} className="ticket-dashboard-empty">
                        Nenhum empreendimento encontrado para a busca ou filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    {showClientsCol && (
                      <th>
                        {countFormat.format(enterpriseTotals.clients)}
                        <span className="ticket-dashboard-pct">
                          ({percentFormat.format(enterpriseTotals.total > 0 ? enterpriseTotals.clients / enterpriseTotals.total : 0)})
                        </span>
                      </th>
                    )}
                    {showCondoCol && (
                      <th>
                        {countFormat.format(enterpriseTotals.condominiums)}
                        <span className="ticket-dashboard-pct">
                          ({percentFormat.format(enterpriseTotals.total > 0 ? enterpriseTotals.condominiums / enterpriseTotals.total : 0)})
                        </span>
                      </th>
                    )}
                    {showInternalsCol && (
                      <th>
                        {countFormat.format(enterpriseTotals.internals)}
                        <span className="ticket-dashboard-pct">
                          ({percentFormat.format(enterpriseTotals.total > 0 ? enterpriseTotals.internals / enterpriseTotals.total : 0)})
                        </span>
                      </th>
                    )}
                    <th>{countFormat.format(enterpriseTotals.total)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* TABELA 2: SITUAÇÕES DO CVCRM (COM BUSCA, ORDENAÇÃO E OCULTAR ZERADOS) */}
          <section className="ticket-dashboard-panel">
            <header className="ticket-dashboard-panel-heading">
              <div>
                <span className="eyebrow">SITUAÇÕES DO CVCRM</span>
                <h2>Chamados ativos por empreendimento</h2>
              </div>
              <div className="panel-controls-group">
                <div className="panel-search-box">
                  <Search size={13} />
                  <input
                    type="search"
                    placeholder="Filtrar situação..."
                    value={statusSearch}
                    onChange={(e) => setStatusSearch(e.target.value)}
                  />
                  {statusSearch && (
                    <button type="button" onClick={() => setStatusSearch('')} aria-label="Limpar">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <label className="panel-checkbox-label">
                  <input
                    type="checkbox"
                    checked={hideZeroStatuses}
                    onChange={(e) => setHideZeroStatuses(e.target.checked)}
                  />
                  <span>Ocultar zeradas</span>
                </label>
              </div>
            </header>

            <div className="ticket-dashboard-table-wrap">
              <div className="mobile-table-scroll-hint mobile-only-text" aria-hidden="true">
                <MoveHorizontal size={13} />
                <span>Deslize a tabela para ver todos os empreendimentos e totais</span>
              </div>
              <table className="ticket-dashboard-table ticket-dashboard-status-table">
                <thead>
                  <tr>
                    <th
                      className="sortable-th"
                      onClick={() => {
                        if (statusSortField === 'status') {
                          setStatusSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
                        } else {
                          setStatusSortField('status')
                          setStatusSortOrder('asc')
                        }
                      }}
                      title="Clique para ordenar por nome da situação"
                    >
                      Situação
                      {statusSortField === 'status' ? (
                        statusSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    {enterpriseNames.map((enterprise) => (
                      <th key={enterprise}>{enterprise}</th>
                    ))}
                    <th
                      className="sortable-th"
                      onClick={() => {
                        if (statusSortField === 'total') {
                          setStatusSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
                        } else {
                          setStatusSortField('total')
                          setStatusSortOrder('desc')
                        }
                      }}
                      title="Clique para ordenar por total"
                    >
                      Total
                      {statusSortField === 'total' ? (
                        statusSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedStatuses.map((status) => {
                    const rowTotal = statusTotals.get(status) ?? 0
                    const rowPct = totalActiveTickets > 0 ? rowTotal / totalActiveTickets : 0
                    return (
                      <tr key={status}>
                        <td>{status}</td>
                        {enterpriseNames.map((enterprise) => {
                          const count = statusByEnterprise.get(`${status}\u0000${enterprise}`)
                          const entTotal = enterpriseTotalsByName.get(enterprise) ?? 0
                          const pct = entTotal > 0 && count ? count / entTotal : 0
                          return (
                            <td key={enterprise}>
                              {count ? (
                                <>
                                  {countFormat.format(count)}
                                  <span className="ticket-dashboard-pct" title={`${percentFormat.format(pct)} dos chamados de ${enterprise}`}>
                                    ({percentFormat.format(pct)})
                                  </span>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          )
                        })}
                        <td>
                          <strong>{countFormat.format(rowTotal)}</strong>
                          {rowTotal > 0 && (
                            <span className="ticket-dashboard-pct" title={`${percentFormat.format(rowPct)} do total geral de chamados ativos`}>
                              ({percentFormat.format(rowPct)} do total)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredAndSortedStatuses.length && (
                    <tr>
                      <td colSpan={enterpriseNames.length + 2} className="ticket-dashboard-empty">
                        Nenhuma situação encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
                {!!filteredAndSortedStatuses.length && (
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      {enterpriseNames.map((enterprise) => {
                        const entTotal = enterpriseTotalsByName.get(enterprise) ?? 0
                        const entPct = totalActiveTickets > 0 ? entTotal / totalActiveTickets : 0
                        return (
                          <th key={enterprise}>
                            {countFormat.format(entTotal)}
                            {entTotal > 0 && (
                              <span className="ticket-dashboard-pct" title={`${percentFormat.format(entPct)} do total de chamados ativos`}>
                                ({percentFormat.format(entPct)})
                              </span>
                            )}
                          </th>
                        )
                      })}
                      <th>{countFormat.format(totalActiveTickets)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* TABELA 3: MOVIMENTAÇÃO DE CHAMADOS (COM FILTRO DE ANO LOCAL, ORDENAÇÃO E EXPORTAÇÃO CSV) */}
          <section className="ticket-dashboard-panel">
            <header className="ticket-dashboard-panel-heading">
              <div>
                <span className="eyebrow">EVOLUÇÃO MENSAL</span>
                <h2>Movimentação de chamados</h2>
              </div>
              <div className="panel-controls-group">
                {/* Filtro local de Ano para a visualização da tabela */}
                <div className="panel-inline-filter">
                  <Filter size={13} />
                  <span>Ano exibido:</span>
                  <div className="panel-year-pills" role="group" aria-label="Filtrar ano da evolução mensal">
                    {availableMovementYears.map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        className={`panel-year-pill ${monthlyYearFilter === String(yr) ? 'is-active' : ''}`}
                        onClick={() => setMonthlyYearFilter(String(yr))}
                      >
                        {yr === currentYear ? `${yr} (atual)` : yr}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`panel-year-pill ${monthlyYearFilter === 'all' ? 'is-active' : ''}`}
                      onClick={() => setMonthlyYearFilter('all')}
                    >
                      Todos os anos
                    </button>
                  </div>
                  <select
                    value={monthlyYearFilter}
                    onChange={(e) => setMonthlyYearFilter(e.target.value)}
                    className="panel-inline-select panel-inline-select-mobile"
                    aria-label="Selecionar ano exibido"
                  >
                    {availableMovementYears.map((yr) => (
                      <option key={yr} value={String(yr)}>
                        Ano {yr} {yr === currentYear ? '(atual)' : ''}
                      </option>
                    ))}
                    <option value="all">Todos os anos ({fromYear} em diante)</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="btn-export-csv"
                  onClick={exportMonthlyToCsv}
                  disabled={!filteredAndSortedMonths.length}
                  title="Exportar esta tabela para CSV (Excel)"
                >
                  <Download size={13} /> Exportar CSV
                </button>
              </div>
            </header>

            <div className="ticket-dashboard-table-wrap">
              <table className="ticket-dashboard-table ticket-dashboard-month-table">
                <thead>
                  <tr>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('date')}
                      title="Clique para alternar ordenação por Ano/Mês"
                    >
                      Ano / Mês
                      {monthSortField === 'date' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('created')}
                      title="Clique para ordenar por criados"
                    >
                      Criados
                      {monthSortField === 'created' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('completed')}
                      title="Clique para ordenar por finalizados"
                    >
                      Finalizados
                      {monthSortField === 'completed' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('canceled')}
                      title="Clique para ordenar por cancelados"
                    >
                      Cancelados
                      {monthSortField === 'canceled' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('closedTotal')}
                      title="Clique para ordenar por finalizados + cancelados"
                    >
                      Finalizados + cancelados
                      {monthSortField === 'closedTotal' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                    <th
                      className="sortable-th"
                      onClick={() => handleMonthSort('balance')}
                      title="Clique para ordenar por saldo do mês"
                    >
                      Saldo do mês
                      {monthSortField === 'balance' ? (
                        monthSortOrder === 'asc' ? (
                          <ArrowUp size={11} className="sort-icon" />
                        ) : (
                          <ArrowDown size={11} className="sort-icon" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="sort-icon-inactive" />
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedMonths.map((m) => {
                    const monthKey = m.month.slice(0, 7)
                    const isSelected = referenceMonth === monthKey
                    return (
                      <tr
                        key={`${m.year}-${m.month}`}
                        className={isSelected ? 'ticket-dashboard-row-selected' : ''}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setReferenceMonth(isSelected ? '' : monthKey)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        title={
                          isSelected
                            ? 'Clique para desmarcar este mês'
                            : `Clique para filtrar os indicadores pelo mês de ${formatMonth(m.month)}/${m.year}`
                        }
                      >
                        <td>
                          <strong>{m.year}</strong> · {formatMonth(m.month)}
                          {isSelected && <span className="ticket-dashboard-badge-active-month">Filtrado</span>}
                        </td>
                        <td>{countFormat.format(m.created)}</td>
                        <td>{countFormat.format(m.completed)}</td>
                        <td>{countFormat.format(m.canceled)}</td>
                        <td>{countFormat.format(m.completed + m.canceled)}</td>
                        <td style={{ color: m.balance < 0 ? '#10b981' : m.balance > 0 ? '#ea580c' : undefined }}>
                          <strong>{countFormat.format(m.balance)}</strong>
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredAndSortedMonths.length && (
                    <tr>
                      <td colSpan={6} className="ticket-dashboard-empty">
                        Nenhuma movimentação para o ano selecionado e filtros ativos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="ticket-dashboard-footnote">
              São considerados chamados abertos a partir do ano selecionado no filtro geral. Finalizações e
              cancelamentos usam o histórico de mudanças quando disponível; para chamados históricos sem eventos locais,
              a data de última alteração da situação do CVCRM é usada como aproximação. O saldo de cada mês é calculado por
              criados menos finalizados e cancelados naquele mês.
            </p>
          </section>
        </div>
      ) : null}
    </section>
  )
}
