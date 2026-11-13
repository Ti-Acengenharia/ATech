import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  Award,
  BriefcaseBusiness,
  Building2,
  Cake,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  History,
  Info,
  Layers,
  List,
  ListTodo,
  MapPin,
  Package,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  TriangleAlert,
  UserCheck,
  UsersRound,
  Zap,
} from 'lucide-react'
import { apiRequest } from './api/client'
import './HomeDashboard.css'

export type AdminPage =
  | 'home'
  | 'tickets'
  | 'letter-filling'
  | 'schedule'
  | 'collaborators'
  | 'inventory'
  | 'information'
  | 'accesses'
  | 'api-validation'
  | 'warranties'
  | 'legal-processes'
  | 'personal-activities'
  | 'logs'
  | 'work-calendar'
  | 'stock-units'

interface SessionUser {
  id: number
  email: string
  displayName: string
  role: 'admin' | 'member'
}

interface ManagedUser extends SessionUser {
  status: 'invited' | 'active' | 'suspended'
}

interface CelebrationPerson {
  id: string
  name: string
  role: string
  roleLabel?: string
  day: number
  month?: number
  year?: number
  admissionDate?: string
  years?: number
  months?: number
  days?: number
}

interface CelebrationGroup {
  label: string
  people: CelebrationPerson[]
}

interface DashboardCelebrations {
  birthdays: {
    previous: CelebrationGroup
    current: CelebrationGroup
    next: CelebrationGroup
  }
  workAnniversaries: {
    previous: CelebrationGroup
    current: CelebrationGroup
    next: CelebrationGroup
  }
}

type FieldTeamPeriod = 'now' | 'morning' | 'afternoon' | 'all'
type FieldTeamView = 'cost-center' | 'list'

interface CostCenterWorker {
  id: string
  name: string
  role: string
  startsAt: string
  endsAt: string
  timeRange: { start: string; end: string }
  service: string
  completed: boolean
  sublocation: string | null
  ticketProtocol: string | null
  legalProcessNumber: string | null
  transitionTag: {
    type: 'outgoing' | 'incoming' | 'full' | 'neutral'
    text: string
  } | null
}

interface CostCenterGroup {
  name: string
  type: 'ticket' | 'legal' | 'standalone'
  badge: string
  sublocation: string | null
  workers: CostCenterWorker[]
}

const AVATAR_COLORS = [
  { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  { bg: '#fdf4ff', text: '#86198f', border: '#f5d0fe' },
  { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' },
  { bg: '#fefce8', text: '#a16207', border: '#fef08a' },
]

function getWorkerAvatarStyle(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i)
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]
}

function getWorkerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface HomeSummaryData {
  user: {
    id: number
    displayName: string
    role: string
  }
  tickets: {
    activeTotal: number
    openedThisMonth: number
    filterApplied?: boolean
    filterSummary?: string | null
  } | null
  schedule: {
    totalToday: number
    collaboratorsCount: number
    todayAppointments: Array<{
      id: string
      startsAt: string
      endsAt: string
      service: string
      completed: boolean
      enterprise: string | null
      block: string | null
      unit: string | null
      location: string | null
      standaloneLocation?: string | null
      commonAreaLocation?: string | null
      collaboratorId?: string | number
      collaboratorName: string
      collaboratorRole: string
      ticketProtocol: string | null
      legalProcessNumber: string | null
      legalProcessTitle: string | null
    }>
  } | null
  legal: {
    activeTotal: number
    upcomingDeadlinesCount: number
  } | null
  inventory: {
    lowStockCount: number
  } | null
  absencesToday: Array<{
    id: string
    type: 'atestado' | 'falta_injustificada'
    collaboratorId: string
    collaboratorName: string
    collaboratorRole: string
    startDate: string
    endDate: string
    cid?: string | null
  }>
  personalTasksCount: number | null
}

interface HomeDashboardProps {
  user: SessionUser
  users: ManagedUser[]
  loading: boolean
  pageAccess: AdminPage[]
  onOpenCollaborators: () => void
  onOpenPage: (page: AdminPage) => void
}

export default function HomeDashboard({
  user,
  users: _users,
  loading: _loading,
  pageAccess,
  onOpenCollaborators,
  onOpenPage,
}: HomeDashboardProps) {
  const canAccess = (key: AdminPage) => user.role === 'admin' || pageAccess.includes(key)
  const canAccessCollaborators = canAccess('collaborators')
  const canAccessSchedule = canAccess('schedule')
  const canAccessTickets = canAccess('tickets')
  const canAccessLegal = canAccess('legal-processes')
  const canAccessInventory = canAccess('inventory')

  const hasGroup1 = canAccessTickets || canAccessSchedule || canAccess('letter-filling') || canAccess('information') || canAccess('warranties')
  const hasGroup2 = canAccessCollaborators || canAccessInventory || canAccess('stock-units') || canAccessLegal || canAccess('personal-activities')
  const hasGroup3 = user.role === 'admin'
  const hasAnyModule = hasGroup1 || hasGroup2 || hasGroup3

  const [summary, setSummary] = useState<HomeSummaryData | null>(null)
  const [_summaryLoading, setSummaryLoading] = useState(true)
  const [celebrations, setCelebrations] = useState<DashboardCelebrations | null>(null)
  const [activeMuralCategory, setActiveMuralCategory] = useState<'birthdays' | 'anniversaries'>('birthdays')
  const [activeMuralPeriod, setActiveMuralPeriod] = useState<'previous' | 'current' | 'next'>('current')

  // Saudação dinâmica e data formatada com fuso brasileiro
  const [timeContext] = useState(() => {
    const now = new Date()
    const currentHour = now.getHours()
    const greetingText = currentHour < 12 ? 'Bom dia' : currentHour < 18 ? 'Boa tarde' : 'Boa noite'
    const formatted = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Maceio',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now)
    const label = formatted.charAt(0).toUpperCase() + formatted.slice(1)
    return { greeting: greetingText, todayLabel: label }
  })
  const { greeting, todayLabel } = timeContext
  const firstName = user.displayName.split(' ')[0] || 'Usuário'

  const [todayDayNumber] = useState(() =>
    Number(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Maceio',
        day: 'numeric',
      }).format(new Date()),
    ),
  )

  const formatMonthName = (name?: string) => {
    if (!name) return ''
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  const formatAdmissionDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }

  // Carregar dados de resumo da Home
  useEffect(() => {
    let cancelled = false
    apiRequest<HomeSummaryData>('/api/home/summary')
      .then((data) => {
        if (!cancelled) {
          setSummary(data)
          setSummaryLoading(false)
        }
      })
      .catch((_err) => {
        if (!cancelled) setSummaryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Carregar aniversários se permitido
  useEffect(() => {
    if (!canAccessCollaborators) return
    let cancelled = false
    apiRequest<DashboardCelebrations>('/api/collaborators/birthdays')
      .then((result) => {
        if (!cancelled) setCelebrations(result)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [canAccessCollaborators])

  // Formatadores de data e hora para agendamentos
  const formatTimeRange = (startsAt: string, endsAt: string) => {
    try {
      const start = new Date(startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const end = new Date(endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      return { start, end }
    } catch {
      return { start: '—', end: '—' }
    }
  }

  const prevMonthName = celebrations?.birthdays.previous.label || 'Mês anterior'
  const currentMonthName = celebrations?.birthdays.current.label || 'Este mês'
  const nextMonthName = celebrations?.birthdays.next.label || 'Próximo mês'

  const selectedCelebrationsGroup =
    activeMuralCategory === 'birthdays'
      ? celebrations?.birthdays[activeMuralPeriod]
      : celebrations?.workAnniversaries[activeMuralPeriod]

  const celebrants = selectedCelebrationsGroup?.people ?? []
  const countBirthdaysCurrent = celebrations?.birthdays[activeMuralPeriod].people.length ?? 0
  const countAnniversariesCurrent = celebrations?.workAnniversaries[activeMuralPeriod].people.length ?? 0

  const [schedulePage, setSchedulePage] = useState(1)
  const SCHEDULE_PAGE_SIZE = 5

  const [fieldTeamView, setFieldTeamView] = useState<FieldTeamView>('cost-center')
  const [fieldTeamPeriod, setFieldTeamPeriod] = useState<FieldTeamPeriod>(() => {
    const hour = new Date().getHours()
    if (hour >= 7 && hour < 12) return 'morning'
    if (hour >= 12 && hour < 18) return 'afternoon'
    return 'all'
  })

  const allAppointments = summary?.schedule?.todayAppointments ?? []
  const totalSchedulePages = Math.max(1, Math.ceil(allAppointments.length / SCHEDULE_PAGE_SIZE))
  const validSchedulePage = Math.min(Math.max(1, schedulePage), totalSchedulePages)
  const pagedAppointments = allAppointments.slice(
    (validSchedulePage - 1) * SCHEDULE_PAGE_SIZE,
    validSchedulePage * SCHEDULE_PAGE_SIZE,
  )

  // Agrupa agendamentos por colaborador para rastrear transições de rota ao longo do dia
  const appointmentsByWorker = useMemo(() => {
    const map = new Map<string, typeof allAppointments>()
    for (const app of allAppointments) {
      const list = map.get(app.collaboratorName) || []
      list.push(app)
      map.set(app.collaboratorName, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    }
    return map
  }, [allAppointments])

  function resolveCostCenter(app: (typeof allAppointments)[0]) {
    if (app.enterprise && app.enterprise.trim() && app.enterprise.toLowerCase() !== 'atividade avulsa') {
      return {
        name: app.enterprise.trim(),
        type: 'ticket' as const,
        badge: app.ticketProtocol ? `Chamado #${app.ticketProtocol}` : 'Chamado',
        sublocation: [app.block ? `Bl. ${app.block}` : null, app.unit ? `Un. ${app.unit}` : null].filter(Boolean).join(' · ') || null,
      }
    }

    if (app.legalProcessTitle?.trim() || app.legalProcessNumber?.trim()) {
      const name = app.enterprise?.trim() || app.legalProcessTitle?.trim() || `Processo #${app.legalProcessNumber}`
      return {
        name,
        type: 'legal' as const,
        badge: app.legalProcessNumber ? `Jurídico #${app.legalProcessNumber}` : 'Jurídico',
        sublocation: app.enterprise && app.legalProcessTitle ? app.legalProcessTitle : (app.location || null),
      }
    }

    const loc = app.standaloneLocation?.trim() || app.commonAreaLocation?.trim() || (app.location !== 'Local a definir' && app.location !== 'Atividade avulsa' ? app.location?.trim() : null)
    return {
      name: loc || 'Atividades Avulsas / Sede',
      type: 'standalone' as const,
      badge: 'Atividade Avulsa',
      sublocation: app.enterprise && app.enterprise !== 'Atividade avulsa' ? app.enterprise : null,
    }
  }

  // Contagens para os botões/pills de período
  const periodCounts = useMemo(() => {
    const now = new Date()
    const nowMs = now.getTime()
    const nowWorkers = new Set<string>()
    const morningWorkers = new Set<string>()
    const afternoonWorkers = new Set<string>()
    const allWorkers = new Set<string>()

    for (const app of allAppointments) {
      allWorkers.add(app.collaboratorName)
      try {
        const s = new Date(app.startsAt)
        const e = new Date(app.endsAt)
        const sHour = s.getHours() + s.getMinutes() / 60
        const eHour = e.getHours() + e.getMinutes() / 60

        if (nowMs >= s.getTime() && nowMs <= e.getTime()) {
          nowWorkers.add(app.collaboratorName)
        }
        if (sHour < 12) {
          morningWorkers.add(app.collaboratorName)
        }
        if (eHour > 12 && (sHour >= 12 || eHour > 13)) {
          afternoonWorkers.add(app.collaboratorName)
        }
      } catch {
        // ignore
      }
    }

    return {
      now: nowWorkers.size,
      morning: morningWorkers.size,
      afternoon: afternoonWorkers.size,
      all: allWorkers.size,
    }
  }, [allAppointments])

  // Agrupamento dos Centros de Custo para o período selecionado
  const costCenterGroups = useMemo(() => {
    const now = new Date()
    const nowMs = now.getTime()

    // 1. Filtra agendamentos pelo período
    const filteredApps = allAppointments.filter((app) => {
      try {
        const s = new Date(app.startsAt)
        const e = new Date(app.endsAt)
        const sHour = s.getHours() + s.getMinutes() / 60
        const eHour = e.getHours() + e.getMinutes() / 60

        if (fieldTeamPeriod === 'now') {
          return nowMs >= s.getTime() && nowMs <= e.getTime()
        }
        if (fieldTeamPeriod === 'morning') {
          return sHour < 12
        }
        if (fieldTeamPeriod === 'afternoon') {
          return eHour > 12 && (sHour >= 12 || eHour > 13)
        }
        return true
      } catch {
        return true
      }
    })

    // 2. Agrupa por Centro de Custo
    const groupsMap = new Map<string, CostCenterGroup>()

    for (const app of filteredApps) {
      const cc = resolveCostCenter(app)
      if (!groupsMap.has(cc.name)) {
        groupsMap.set(cc.name, {
          name: cc.name,
          type: cc.type,
          badge: cc.badge,
          sublocation: cc.sublocation,
          workers: [],
        })
      }
      const group = groupsMap.get(cc.name)!

      // 3. Analisa transições de rota deste colaborador
      const workerAllApps = appointmentsByWorker.get(app.collaboratorName) || []
      let transitionTag: CostCenterWorker['transitionTag'] = null

      if (workerAllApps.length > 1) {
        const otherApps = workerAllApps.filter((o) => resolveCostCenter(o).name !== cc.name)
        if (otherApps.length > 0) {
          const nextApp = workerAllApps.find(
            (o) => new Date(o.startsAt).getTime() >= new Date(app.endsAt).getTime() && resolveCostCenter(o).name !== cc.name,
          )
          const prevApp = workerAllApps.find(
            (o) => new Date(o.endsAt).getTime() <= new Date(app.startsAt).getTime() && resolveCostCenter(o).name !== cc.name,
          )

          if ((fieldTeamPeriod === 'morning' || fieldTeamPeriod === 'now') && nextApp) {
            transitionTag = {
              type: 'outgoing',
              text: `À tarde vai para: ${resolveCostCenter(nextApp).name}`,
            }
          } else if ((fieldTeamPeriod === 'afternoon' || fieldTeamPeriod === 'now') && prevApp) {
            transitionTag = {
              type: 'incoming',
              text: `De manhã estava em: ${resolveCostCenter(prevApp).name}`,
            }
          } else if (fieldTeamPeriod === 'all') {
            if (nextApp) {
              transitionTag = {
                type: 'outgoing',
                text: `Também vai para: ${resolveCostCenter(nextApp).name}`,
              }
            } else if (prevApp) {
              transitionTag = {
                type: 'incoming',
                text: `Veio de: ${resolveCostCenter(prevApp).name}`,
              }
            }
          }
        }
      } else {
        try {
          const s = new Date(app.startsAt).getHours()
          const e = new Date(app.endsAt).getHours()
          if (s <= 8 && e >= 16) {
            transitionTag = {
              type: 'full',
              text: 'Dia todo neste local',
            }
          }
        } catch {
          // ignore
        }
      }

      const existing = group.workers.find((w) => w.name === app.collaboratorName)
      if (!existing) {
        const { start, end } = formatTimeRange(app.startsAt, app.endsAt)
        group.workers.push({
          id: app.id,
          name: app.collaboratorName,
          role: app.collaboratorRole.replace(/_/g, ' '),
          startsAt: app.startsAt,
          endsAt: app.endsAt,
          timeRange: { start, end },
          service: app.service || 'Serviço geral',
          completed: app.completed,
          sublocation: [app.block ? `Bl. ${app.block}` : null, app.unit ? `Un. ${app.unit}` : null].filter(Boolean).join(' · ') || null,
          ticketProtocol: app.ticketProtocol,
          legalProcessNumber: app.legalProcessNumber,
          transitionTag,
        })
      }
    }

    return Array.from(groupsMap.values()).sort(
      (a, b) => b.workers.length - a.workers.length || a.name.localeCompare(b.name, 'pt-BR'),
    )
  }, [allAppointments, fieldTeamPeriod, appointmentsByWorker])

  return (
    <div className="home-dashboard-v2">
      {/* 1. HERO DE BOAS-VINDAS & AÇÕES RÁPIDAS */}
      <section className="home-hero-v2">
        <div className="home-hero-top">
          <div className="home-hero-greeting">
            <span className="home-hero-eyebrow">
              <img src="/logo-ac.png" alt="AC Engenharia" className="home-hero-logo" />
              <span>ESPAÇO DE TRABALHO ATECH</span>
            </span>
            <h1 className="home-hero-title">
              {greeting}, {firstName}.
            </h1>
            <p className="home-hero-subtitle">
              <span>{todayLabel}</span>
              <span>·</span>
              <span className="home-hero-role">
                {user.role === 'admin' ? 'Administrador do Sistema' : 'Equipe Operacional'}
              </span>
            </p>
          </div>
          <div className="home-hero-badge">
            <i /> AMBIENTE SEGURO
          </div>
        </div>

        {/* Barra de Ações Rápidas */}
        {(canAccessTickets || canAccessSchedule || canAccessInventory || canAccessLegal || canAccess('personal-activities')) && (
          <div className="home-quick-actions-bar">
            <div className="home-quick-actions-buttons">
              {canAccessTickets && (
                <button
                  type="button"
                  className="home-quick-btn home-quick-btn-primary"
                  onClick={() => onOpenPage('tickets')}
                  title="Acessar quadro e atendimentos de chamados"
                >
                  <ClipboardList size={15} /> Chamados
                </button>
              )}

              {canAccessSchedule && (
                <button
                  type="button"
                  className="home-quick-btn"
                  onClick={() => onOpenPage('schedule')}
                  title="Agendar equipe técnica para atendimentos ou serviços"
                >
                  <CalendarDays size={14} /> Agendar equipe
                </button>
              )}

              {canAccessInventory && (
                <button
                  type="button"
                  className="home-quick-btn"
                  onClick={() => onOpenPage('inventory')}
                  title="Lançar entrada, saída ou entrega de insumos/ferramentas"
                >
                  <Package size={14} /> Movimentar estoque
                </button>
              )}

              {canAccessLegal && (
                <button
                  type="button"
                  className="home-quick-btn"
                  onClick={() => onOpenPage('legal-processes')}
                  title="Acessar processos jurídicos e prazos"
                >
                  <BriefcaseBusiness size={14} /> Processos jurídicos
                </button>
              )}

              {canAccess('personal-activities') && (
                <button
                  type="button"
                  className="home-quick-btn"
                  onClick={() => onOpenPage('personal-activities')}
                  title="Acessar minhas atividades e tarefas"
                >
                  <ListTodo size={14} /> Minhas atividades
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 2. RADAR OPERACIONAL EM TEMPO REAL (KPIs) */}
      <section className="home-kpis-grid" aria-label="Indicadores operacionais em tempo real">
        {/* KPI 1: Chamados em Aberto */}
        {canAccessTickets && (
          <article className="home-kpi-card home-kpi-blue" onClick={() => onOpenPage('tickets')}>
            <div className="home-kpi-header">
              <span className="home-kpi-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                Chamados Ativos
                {summary?.tickets?.filterApplied && (
                  <span
                    style={{
                      fontSize: '10px',
                      background: 'rgba(37, 99, 235, 0.12)',
                      color: '#1d4ed8',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontWeight: 600,
                    }}
                    title={`Filtro personalizado da homepage ativo: ${summary.tickets.filterSummary}`}
                  >
                    Filtrado
                  </span>
                )}
              </span>
              <div className="home-kpi-icon">
                <ClipboardList size={18} />
              </div>
            </div>
            <div className="home-kpi-body">
              <div className="home-kpi-value">{summary?.tickets?.activeTotal ?? '—'}</div>
            </div>
            <div className="home-kpi-footer">
              <span title={summary?.tickets?.filterSummary ? `Regra da contagem: ${summary.tickets.filterSummary}` : undefined}>
                {summary?.tickets?.filterSummary
                  ? summary.tickets.filterSummary
                  : summary?.tickets
                  ? `+${summary.tickets.openedThisMonth} criados este mês`
                  : 'Atendimentos em curso'}
              </span>
              <ArrowRight size={14} className="home-kpi-arrow" />
            </div>
          </article>
        )}

        {/* KPI 2: Equipe em Campo Hoje */}
        {canAccessSchedule && (
          <article className="home-kpi-card home-kpi-emerald" onClick={() => onOpenPage('schedule')}>
            <div className="home-kpi-header">
              <span className="home-kpi-label">Equipe em Campo</span>
              <div className="home-kpi-icon">
                <CalendarDays size={18} />
              </div>
            </div>
            <div className="home-kpi-body">
              <div className="home-kpi-value">{summary?.schedule?.collaboratorsCount ?? '0'}</div>
            </div>
            <div className="home-kpi-footer">
              <span>
                {summary?.schedule?.totalToday != null
                  ? summary.schedule.totalToday === 1
                    ? '1 atividade agendada hoje'
                    : `${summary.schedule.totalToday} atividades agendadas hoje`
                  : 'Colaboradores com programação hoje'}
              </span>
              <ArrowRight size={14} className="home-kpi-arrow" />
            </div>
          </article>
        )}

        {/* KPI 3: Prazos Jurídicos */}
        {canAccessLegal && (
          <article className="home-kpi-card home-kpi-purple" onClick={() => onOpenPage('legal-processes')}>
            <div className="home-kpi-header">
              <span className="home-kpi-label">Processos Jurídicos</span>
              <div className="home-kpi-icon">
                <BriefcaseBusiness size={18} />
              </div>
            </div>
            <div className="home-kpi-body">
              <div className="home-kpi-value">{summary?.legal?.activeTotal ?? '—'}</div>
            </div>
            <div className="home-kpi-footer">
              <span>
                {summary?.legal?.upcomingDeadlinesCount
                  ? `${summary.legal.upcomingDeadlinesCount} a vencer nos próximos 7 dias`
                  : 'Nenhum prazo imediato'}
              </span>
              <ArrowRight size={14} className="home-kpi-arrow" />
            </div>
          </article>
        )}

        {/* KPI 4: Alertas Operacionais (Estoque Baixo & Atestados) */}
        {(canAccessInventory || canAccessCollaborators) && (
          <article
            className={`home-kpi-card ${
              (summary?.inventory?.lowStockCount ?? 0) > 0 || (summary?.absencesToday?.length ?? 0) > 0
                ? 'home-kpi-amber'
                : 'home-kpi-emerald'
            }`}
            onClick={() => {
              if ((summary?.inventory?.lowStockCount ?? 0) > 0 && canAccessInventory) {
                onOpenPage('inventory')
              } else if ((summary?.absencesToday?.length ?? 0) > 0 && canAccessCollaborators) {
                onOpenCollaborators()
              }
            }}
          >
            <div className="home-kpi-header">
              <span className="home-kpi-label">Alertas Operacionais</span>
              <div className="home-kpi-icon">
                {(summary?.inventory?.lowStockCount ?? 0) > 0 || (summary?.absencesToday?.length ?? 0) > 0 ? (
                  <TriangleAlert size={18} />
                ) : (
                  <CheckCircle2 size={18} />
                )}
              </div>
            </div>
            <div className="home-kpi-body">
              <div className="home-kpi-value">
                {(summary?.inventory?.lowStockCount ?? 0) + (summary?.absencesToday?.length ?? 0)}
              </div>
            </div>
            <div className="home-kpi-footer">
              <span>
                {(summary?.inventory?.lowStockCount ?? 0) > 0
                  ? `${summary?.inventory?.lowStockCount} insumos em nível crítico`
                  : (summary?.absencesToday?.length ?? 0) > 0
                    ? `${summary?.absencesToday.length} ausências registradas hoje`
                    : 'Suprimentos e escalas em conformidade'}
              </span>
              <ArrowRight size={14} className="home-kpi-arrow" />
            </div>
          </article>
        )}
      </section>

      {/* 3. PAINEL CENTRAL (AGENDA DO DIA + MURAL & CELEBRAÇÕES) */}
      <section className="home-split-layout">
        {/* Coluna Esquerda: Agenda e Equipe Hoje */}
        <div className="home-agenda-panel">
          <div className="home-panel-header">
            <div className="home-panel-title-wrap">
              <div className="home-panel-title-icon">
                <Clock size={16} />
              </div>
              <div>
                <h3>Equipe em Campo Hoje</h3>
                <small>SERVIÇOS E ROTAS AGENDADAS</small>
              </div>
            </div>
            {canAccessSchedule && (
              <button type="button" className="home-panel-action-btn" onClick={() => onOpenPage('schedule')}>
                Ver programação completa <ArrowRight size={13} />
              </button>
            )}
          </div>

          {/* Banner de Aviso de Atestados / Faltas no dia */}
          {summary?.absencesToday && summary.absencesToday.length > 0 && (
            <div className="home-absence-banner" role="alert">
              <TriangleAlert size={16} className="home-absence-banner-icon" />
              <div className="home-absence-banner-content">
                <strong>Atenção para as escalas do dia:</strong>
                <span>
                  {summary.absencesToday.length === 1
                    ? 'Há 1 colaborador ausente com atestado ou falta registrada hoje:'
                    : `Há ${summary.absencesToday.length} colaboradores ausentes registrados hoje:`}
                </span>
                <div className="home-absence-pills">
                  {summary.absencesToday.map((abs) => (
                    <span key={abs.id} className="home-absence-pill">
                      {abs.collaboratorName} ({abs.type === 'atestado' ? 'Atestado' : 'Falta'})
                      {abs.cid ? ` · CID ${abs.cid}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Controles da Equipe em Campo (Alternância de Visão e Filtro de Período) */}
          {allAppointments.length > 0 && (
            <div className="home-fieldteam-controls">
              <div className="home-fieldteam-view-tabs" role="tablist" aria-label="Modo de visualização">
                <button
                  type="button"
                  className={`home-fieldteam-tab ${fieldTeamView === 'cost-center' ? 'is-active' : ''}`}
                  onClick={() => setFieldTeamView('cost-center')}
                  role="tab"
                  aria-selected={fieldTeamView === 'cost-center'}
                >
                  <Building2 size={13} /> Por Centro de Custo
                </button>
                <button
                  type="button"
                  className={`home-fieldteam-tab ${fieldTeamView === 'list' ? 'is-active' : ''}`}
                  onClick={() => setFieldTeamView('list')}
                  role="tab"
                  aria-selected={fieldTeamView === 'list'}
                >
                  <List size={13} /> Lista de Atividades
                </button>
              </div>

              {fieldTeamView === 'cost-center' && (
                <div className="home-fieldteam-period-pills" role="group" aria-label="Período do dia">
                  <button
                    type="button"
                    className={`home-period-pill ${fieldTeamPeriod === 'now' ? 'is-active' : ''}`}
                    onClick={() => setFieldTeamPeriod('now')}
                    title="Colaboradores atuando exatamente neste minuto"
                  >
                    <span className="live-pulse-dot" />
                    <strong>Agora</strong>
                    <span className="pill-count">{periodCounts.now}</span>
                  </button>

                  <button
                    type="button"
                    className={`home-period-pill ${fieldTeamPeriod === 'morning' ? 'is-active' : ''}`}
                    onClick={() => setFieldTeamPeriod('morning')}
                    title="Colaboradores alocados no turno da manhã (até 12:00)"
                  >
                    <Sun size={12} />
                    <span>Manhã</span>
                    <span className="pill-count">{periodCounts.morning}</span>
                  </button>

                  <button
                    type="button"
                    className={`home-period-pill ${fieldTeamPeriod === 'afternoon' ? 'is-active' : ''}`}
                    onClick={() => setFieldTeamPeriod('afternoon')}
                    title="Colaboradores alocados no turno da tarde (após 12:00)"
                  >
                    <Sunset size={12} />
                    <span>Tarde</span>
                    <span className="pill-count">{periodCounts.afternoon}</span>
                  </button>

                  <button
                    type="button"
                    className={`home-period-pill ${fieldTeamPeriod === 'all' ? 'is-active' : ''}`}
                    onClick={() => setFieldTeamPeriod('all')}
                    title="Visão geral consolidada do dia todo"
                  >
                    <CalendarDays size={12} />
                    <span>Dia Todo</span>
                    <span className="pill-count">{periodCounts.all}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Conteúdo: Quadro por Centro de Custo OU Lista Tradicional */}
          {allAppointments.length > 0 ? (
            fieldTeamView === 'cost-center' ? (
              costCenterGroups.length > 0 ? (
                <div className="home-cost-centers-grid">
                  {costCenterGroups.map((group) => (
                    <div key={group.name} className={`home-cost-center-card is-type-${group.type}`}>
                      <div className="home-cost-center-header">
                        <div className="home-cost-center-title-group">
                          <div className="home-cost-center-icon">
                            {group.type === 'legal' ? (
                              <BriefcaseBusiness size={14} />
                            ) : group.type === 'standalone' ? (
                              <MapPin size={14} />
                            ) : (
                              <Building2 size={14} />
                            )}
                          </div>
                          <div>
                            <h4 className="home-cost-center-name">{group.name}</h4>
                            <span className="home-cost-center-type-badge">{group.badge}</span>
                          </div>
                        </div>
                        <span className="home-cost-center-count-badge">
                          <UsersRound size={12} />
                          <strong>{group.workers.length}</strong> {group.workers.length === 1 ? 'pessoa' : 'pessoas'}
                        </span>
                      </div>

                      <div className="home-cost-center-workers-list">
                        {group.workers.map((worker) => {
                          const avatar = getWorkerAvatarStyle(worker.name)
                          return (
                            <div key={worker.id + worker.name} className="home-cc-worker-row">
                              <div
                                className="home-cc-worker-avatar"
                                style={{ background: avatar.bg, color: avatar.text, borderColor: avatar.border }}
                                title={worker.name}
                              >
                                {getWorkerInitials(worker.name)}
                              </div>

                              <div className="home-cc-worker-info">
                                <div className="home-cc-worker-heading">
                                  <span className="home-cc-worker-name">{worker.name}</span>
                                  <span className="home-cc-worker-hours">
                                    <Clock size={10} /> {worker.timeRange.start} – {worker.timeRange.end}
                                  </span>
                                </div>

                                <div className="home-cc-worker-role">{worker.role}</div>

                                <div className="home-cc-worker-service">
                                  {worker.service}
                                  {worker.sublocation && <span className="home-cc-worker-subloc"> · {worker.sublocation}</span>}
                                </div>

                                {worker.transitionTag && (
                                  <div className={`home-cc-transition-tag is-${worker.transitionTag.type}`}>
                                    <ArrowRightLeft size={10} />
                                    <span>{worker.transitionTag.text}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="home-fieldteam-empty">
                  <Clock size={28} className="home-fieldteam-empty-icon" />
                  <strong>
                    {fieldTeamPeriod === 'now'
                      ? 'Nenhum colaborador com atividade no minuto atual'
                      : 'Nenhum colaborador com escala para o período selecionado'}
                  </strong>
                  <p>
                    {fieldTeamPeriod === 'now'
                      ? 'Pode ser horário de intervalo/almoço ou fora do expediente. Selecione "Manhã", "Tarde" ou "Dia Todo" para visualizar as alocações.'
                      : 'Não foram encontradas programações para este horário hoje.'}
                  </p>
                  {fieldTeamPeriod === 'now' && (
                    <button
                      type="button"
                      className="home-fieldteam-btn-reset"
                      onClick={() => setFieldTeamPeriod('all')}
                    >
                      Ver escala completa do Dia ({periodCounts.all})
                    </button>
                  )}
                </div>
              )
            ) : (
              <>
                <div className="home-appointments-list">
                  {pagedAppointments.map((app) => {
                    const { start, end } = formatTimeRange(app.startsAt, app.endsAt)
                    return (
                      <div
                        key={app.id}
                        className={`home-appointment-card ${app.completed ? 'home-appointment-completed' : ''}`}
                      >
                        <div className="home-appointment-time">
                          <span>{start}</span>
                          <small>{end}</small>
                        </div>
                        <div className="home-appointment-details">
                          <div className="home-appointment-title">
                            <span className="home-appointment-worker">{app.collaboratorName}</span>
                            <span className="home-appointment-role">{app.collaboratorRole.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="home-appointment-desc">{app.service || 'Serviço técnico geral'}</div>
                          <div className="home-appointment-meta">
                            {app.enterprise && (
                              <span className="home-appointment-meta-item" title="Empreendimento / Obra">
                                <Building2 size={11} /> {app.enterprise}
                              </span>
                            )}
                            {app.block && (
                              <span className="home-appointment-meta-item" title="Bloco">
                                <strong>Bl.</strong> {app.block}
                              </span>
                            )}
                            {app.unit && (
                              <span className="home-appointment-meta-item" title="Unidade">
                                <strong>Un.</strong> {app.unit}
                              </span>
                            )}
                            {!app.enterprise && !app.block && !app.unit && app.location && (
                              <span className="home-appointment-meta-item">
                                <MapPin size={11} /> {app.location}
                              </span>
                            )}
                            {app.ticketProtocol && (
                              <span className="home-appointment-meta-item">
                                <ClipboardList size={11} /> #{app.ticketProtocol}
                              </span>
                            )}
                            {app.legalProcessNumber && (
                              <span className="home-appointment-meta-item">
                                <BriefcaseBusiness size={11} /> Proc. {app.legalProcessNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {totalSchedulePages > 1 && (
                  <div className="home-schedule-pagination">
                    <span className="home-schedule-pagination-info">
                      Mostrando {(validSchedulePage - 1) * SCHEDULE_PAGE_SIZE + 1}–{Math.min(validSchedulePage * SCHEDULE_PAGE_SIZE, allAppointments.length)} de {allAppointments.length} programações
                    </span>
                    <div className="home-schedule-pagination-controls">
                      <button
                        type="button"
                        className="home-schedule-page-btn"
                        disabled={validSchedulePage === 1}
                        onClick={() => setSchedulePage((p) => Math.max(1, p - 1))}
                        title="Página anterior"
                      >
                        <ChevronLeft size={13} /> Anterior
                      </button>
                      <span className="home-schedule-page-current">
                        {validSchedulePage} / {totalSchedulePages}
                      </span>
                      <button
                        type="button"
                        className="home-schedule-page-btn"
                        disabled={validSchedulePage === totalSchedulePages}
                        onClick={() => setSchedulePage((p) => Math.min(totalSchedulePages, p + 1))}
                        title="Próxima página"
                      >
                        Próxima <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
          ) : (
            <div className="home-empty-state">
              <CalendarDays size={28} />
              <p>Nenhuma atividade técnica programada para o dia de hoje.</p>
              {canAccessSchedule && (
                <button
                  type="button"
                  className="home-panel-action-btn"
                  onClick={() => onOpenPage('schedule')}
                  style={{ marginTop: 6 }}
                >
                  Programar novo atendimento
                </button>
              )}
            </div>
          )}
        </div>

        {/* Coluna Direita: Mural da Equipe & Celebrações */}
        <div className="home-mural-panel">
          <div className="home-panel-header">
            <div className="home-panel-title-wrap">
              <div className="home-panel-title-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <Award size={16} />
              </div>
              <div>
                <h3>Mural & Pessoas</h3>
                <small>DATAS ESPECIAIS DO MÊS</small>
              </div>
            </div>
            {canAccessCollaborators && (
              <button type="button" className="home-panel-action-btn" onClick={onOpenCollaborators}>
                Equipe <ArrowRight size={13} />
              </button>
            )}
          </div>

          {/* Abas de Categorias */}
          <div className="home-mural-tabs">
            <button
              type="button"
              className={`home-mural-tab ${activeMuralCategory === 'birthdays' ? 'active' : ''}`}
              onClick={() => setActiveMuralCategory('birthdays')}
            >
              🎂 Aniversariantes ({countBirthdaysCurrent})
            </button>
            <button
              type="button"
              className={`home-mural-tab ${activeMuralCategory === 'anniversaries' ? 'active' : ''}`}
              onClick={() => setActiveMuralCategory('anniversaries')}
            >
              🏅 Tempo de Empresa ({countAnniversariesCurrent})
            </button>
          </div>

          {/* Sub-seletor de Período: Mês Anterior, Atual, Próximo */}
          <div className="home-mural-periods" role="tablist" aria-label="Seletor de mês do mural">
            <button
              type="button"
              className={`home-mural-period-pill ${activeMuralPeriod === 'previous' ? 'active' : ''}`}
              onClick={() => setActiveMuralPeriod('previous')}
              title={`Ver comemorações de ${formatMonthName(prevMonthName)}`}
            >
              <span>{formatMonthName(prevMonthName)}</span>
              <small>Anterior</small>
            </button>
            <button
              type="button"
              className={`home-mural-period-pill ${activeMuralPeriod === 'current' ? 'active' : ''}`}
              onClick={() => setActiveMuralPeriod('current')}
              title={`Ver comemorações de ${formatMonthName(currentMonthName)}`}
            >
              <Sparkles size={11} className="home-mural-sparkle" />
              <span>{formatMonthName(currentMonthName)}</span>
              <small>Este Mês</small>
            </button>
            <button
              type="button"
              className={`home-mural-period-pill ${activeMuralPeriod === 'next' ? 'active' : ''}`}
              onClick={() => setActiveMuralPeriod('next')}
              title={`Ver comemorações de ${formatMonthName(nextMonthName)}`}
            >
              <span>{formatMonthName(nextMonthName)}</span>
              <small>Próximo</small>
            </button>
          </div>

          {/* Conteúdo da Lista de Homenageados */}
          <div className="home-mural-list">
            {activeMuralCategory === 'birthdays' ? (
              celebrants.length > 0 ? (
                celebrants.map((person) => {
                  const isToday = activeMuralPeriod === 'current' && person.day === todayDayNumber
                  const isUpcoming = activeMuralPeriod === 'current' && person.day > todayDayNumber
                  const isPast = activeMuralPeriod === 'current' && person.day < todayDayNumber
                  const roleDisplay = person.roleLabel || person.role.replace(/_/g, ' ')
                  return (
                    <div key={person.id} className={`home-celebrant-row ${isToday ? 'is-today-highlight' : ''}`}>
                      <div className={`home-celebrant-day ${isToday ? 'is-today-day' : ''}`}>
                        <span className="home-celebrant-day-num">{String(person.day).padStart(2, '0')}</span>
                        <small className="home-celebrant-day-month">
                          {person.month ? String(person.month).padStart(2, '0') : ''}
                        </small>
                      </div>
                      <div className="home-celebrant-info">
                        <div className="home-celebrant-name-row">
                          <strong className="home-celebrant-name">{person.name}</strong>
                          {isToday && <span className="home-celebrant-pill pill-today">🎉 É HOJE!</span>}
                          {isUpcoming && <span className="home-celebrant-pill pill-upcoming">Em {person.day - todayDayNumber}d</span>}
                          {isPast && <span className="home-celebrant-pill pill-past">Já comemorou</span>}
                          {activeMuralPeriod === 'previous' && <span className="home-celebrant-pill pill-past">Comemorado</span>}
                        </div>
                        <div className="home-celebrant-role">{roleDisplay}</div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="home-empty-state">
                  <Cake size={26} />
                  <p>Nenhum aniversariante registrado em {formatMonthName(selectedCelebrationsGroup?.label || '')}.</p>
                </div>
              )
            ) : celebrants.length > 0 ? (
              celebrants.map((person) => {
                const isToday = activeMuralPeriod === 'current' && person.day === todayDayNumber
                const roleDisplay = person.roleLabel || person.role.replace(/_/g, ' ')
                const tenureParts: string[] = []
                if (person.years) tenureParts.push(`${person.years} ${person.years === 1 ? 'ano' : 'anos'}`)
                if (person.months) tenureParts.push(`${person.months} ${person.months === 1 ? 'mês' : 'meses'}`)
                if (person.days) tenureParts.push(`${person.days} ${person.days === 1 ? 'dia' : 'dias'}`)
                const tenureText = tenureParts.join(', ') || `${person.years ?? 0} anos`

                return (
                  <div key={person.id} className={`home-celebrant-row home-anniversary-row ${isToday ? 'is-today-highlight' : ''}`}>
                    <div className={`home-celebrant-day home-celebrant-day-gold ${isToday ? 'is-today-day' : ''}`}>
                      <span className="home-celebrant-day-num">{String(person.day).padStart(2, '0')}</span>
                      <small className="home-celebrant-day-month">DIA</small>
                    </div>
                    <div className="home-celebrant-info">
                      <div className="home-celebrant-name-row">
                        <strong className="home-celebrant-name">{person.name}</strong>
                        <span className="home-celebrant-pill pill-medal">
                          <Award size={11} /> {person.years} {person.years === 1 ? 'ano' : 'anos'}
                        </span>
                        {isToday && <span className="home-celebrant-pill pill-today">🎉 Hoje!</span>}
                      </div>
                      <div className="home-celebrant-role">{roleDisplay}</div>
                      <div className="home-celebrant-anniversary-meta">
                        {person.admissionDate && (
                          <span className="home-celebrant-admission">
                            Admissão: {formatAdmissionDate(person.admissionDate)}
                          </span>
                        )}
                        <span className="home-celebrant-tenure-full">
                          Tempo de empresa: <strong>{tenureText}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="home-empty-state">
                <Award size={26} />
                <p>Nenhum aniversário de empresa em {formatMonthName(selectedCelebrationsGroup?.label || '')}.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. VITRINE DE ÁREAS DE TRABALHO CATEGORIZADAS */}
      {hasAnyModule && (
        <section className="home-modules-section" aria-label="Módulos da plataforma ATech">
          <div className="home-modules-heading">
            <div>
              <h3>Áreas de Trabalho & Ferramentas</h3>
              <p>Acesse rapidamente os módulos da plataforma corporativa</p>
            </div>
          </div>

          {/* Grupo 1: Atendimento Técnico & Obras */}
          {hasGroup1 && (
            <div className="home-modules-category-group">
              <span className="home-modules-cat-label">
                <ClipboardList size={13} /> Atendimento Técnico & Obras
              </span>
              <div className="home-modules-grid">
                {canAccessTickets && (
                  <div className="home-module-card" onClick={() => onOpenPage('tickets')}>
                    <div className="home-module-icon-wrap home-mod-blue">
                      <ClipboardList size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Chamados</strong>
                      <small>Quadro Kanban, solicitações e atendimentos CVCRM</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccessSchedule && (
                  <div className="home-module-card" onClick={() => onOpenPage('schedule')}>
                    <div className="home-module-icon-wrap home-mod-teal">
                      <CalendarDays size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Programação</strong>
                      <small>Agenda de serviços técnicos e alocação de equipes</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccess('letter-filling') && (
                  <div className="home-module-card" onClick={() => onOpenPage('letter-filling')}>
                    <div className="home-module-icon-wrap home-mod-blue">
                      <FileText size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Preenchimento de cartas</strong>
                      <small>Geração de cartas e termos de atendimento</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccess('information') && (
                  <div className="home-module-card" onClick={() => onOpenPage('information')}>
                    <div className="home-module-icon-wrap home-mod-slate">
                      <Info size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Informações de empreendimentos</strong>
                      <small>Dados cadastrais, síndicos e habite-se de empreendimentos</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccess('warranties') && (
                  <div className="home-module-card" onClick={() => onOpenPage('warranties')}>
                    <div className="home-module-icon-wrap home-mod-amber">
                      <ShieldCheck size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Prazos de Garantia</strong>
                      <small>Configuração e prazos de garantia por subassuntos</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Grupo 2: Recursos, Pessoas & Jurídico */}
          {hasGroup2 && (
            <div className="home-modules-category-group">
              <span className="home-modules-cat-label">
                <Layers size={13} /> Pessoas, Recursos & Jurídico
              </span>
              <div className="home-modules-grid">
                {canAccessCollaborators && (
                  <div className="home-module-card" onClick={onOpenCollaborators}>
                    <div className="home-module-icon-wrap home-mod-emerald">
                      <UsersRound size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Colaboradores</strong>
                      <small>Fichas, uniformes, escalas e registro de atestados</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccessInventory && (
                  <div className="home-module-card" onClick={() => onOpenPage('inventory')}>
                    <div className="home-module-icon-wrap home-mod-blue">
                      <Package size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Gestão de Estoque</strong>
                      <small>Insumos, EPIs, entregas com PIN e ferramentas</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccess('stock-units') && (
                  <div className="home-module-card" onClick={() => onOpenPage('stock-units')}>
                    <div className="home-module-icon-wrap home-mod-teal">
                      <Building2 size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Unidades em estoque</strong>
                      <small>Controle e status de unidades prontas e chaves</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccessLegal && (
                  <div className="home-module-card" onClick={() => onOpenPage('legal-processes')}>
                    <div className="home-module-icon-wrap home-mod-purple">
                      <BriefcaseBusiness size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Processos Jurídicos</strong>
                      <small>Quadro, fases, incidentes e dashboard executivo</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}

                {canAccess('personal-activities') && (
                  <div className="home-module-card" onClick={() => onOpenPage('personal-activities')}>
                    <div className="home-module-icon-wrap home-mod-indigo">
                      <ListTodo size={18} />
                    </div>
                    <div className="home-module-content">
                      <strong>Minhas atividades</strong>
                      <small>Seu quadro privado de tarefas e acompanhamentos</small>
                    </div>
                    <ChevronRight size={15} className="home-module-arrow" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Grupo 3: Administração & Integrações (exibido apenas para administradores) */}
          {hasGroup3 && (
            <div className="home-modules-category-group">
              <span className="home-modules-cat-label">
                <ShieldAlert size={13} /> Administração & Auditoria
              </span>
              <div className="home-modules-grid">
                <div className="home-module-card" onClick={() => onOpenPage('accesses')}>
                  <div className="home-module-icon-wrap home-mod-slate">
                    <UserCheck size={18} />
                  </div>
                  <div className="home-module-content">
                    <strong>Controle de Acessos</strong>
                    <small>Gestão de permissões de páginas e contas da equipe</small>
                  </div>
                  <ChevronRight size={15} className="home-module-arrow" />
                </div>

                <div className="home-module-card" onClick={() => onOpenPage('api-validation')}>
                  <div className="home-module-icon-wrap home-mod-amber">
                    <Zap size={18} />
                  </div>
                  <div className="home-module-content">
                    <strong>Validação da API</strong>
                    <small>Sincronização CVCRM, carga CSV e diagnóstico</small>
                  </div>
                  <ChevronRight size={15} className="home-module-arrow" />
                </div>

                <div className="home-module-card" onClick={() => onOpenPage('work-calendar')}>
                  <div className="home-module-icon-wrap home-mod-teal">
                    <CalendarDays size={18} />
                  </div>
                  <div className="home-module-content">
                    <strong>Expediente e Calendário</strong>
                    <small>Configuração de expediente, feriados e folgas</small>
                  </div>
                  <ChevronRight size={15} className="home-module-arrow" />
                </div>

                <div className="home-module-card" onClick={() => onOpenPage('logs')}>
                  <div className="home-module-icon-wrap home-mod-purple">
                    <History size={18} />
                  </div>
                  <div className="home-module-content">
                    <strong>Auditoria & Logs</strong>
                    <small>Histórico completo de ações e eventos do sistema</small>
                  </div>
                  <ChevronRight size={15} className="home-module-arrow" />
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Footer discreto */}
      <footer className="workspace-footer">
        <span>ATech · Cockpit Operacional da Engenharia e Assistência Técnica</span>
        <span>
          Ambiente Protegido <i /> Acesso corporativo verificado
        </span>
      </footer>
    </div>
  )
}
