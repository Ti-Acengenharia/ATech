import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google'
import { apiRequest } from './api/client'
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ContactRound,
  ClipboardList,
  FileText,
  Info,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Mail,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  Wrench,
  Zap,
  X,
} from 'lucide-react'
import './atech.css'

type UserRole = 'admin' | 'member'
type UserStatus = 'invited' | 'active' | 'suspended'
type AdminPage = 'home' | 'tickets' | 'letter-filling' | 'schedule' | 'collaborators' | 'inventory' | 'information' | 'accesses' | 'api-validation' | 'warranties' | 'legal-processes' | 'personal-activities'

interface SessionUser {
  id: number
  email: string
  displayName: string
  role: UserRole
}

interface CelebrationPerson {
  id: string
  name: string
  role: string
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

interface ManagedUser extends SessionUser {
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
  canAccessLegalProcesses: boolean
  canViewOtherPersonalActivities: boolean
  pageAccess: AdminPage[]
}

interface SessionResponse {
  user: SessionUser | null
  corporateDomain: string
  canAccessLegalProcesses: boolean
  canViewOtherPersonalActivities: boolean
  pageAccess: AdminPage[]
}

interface UserNotification {
  id: string
  ticket_id: string
  protocol: string
  kind: 'mention' | 'mention_reply'
  message: string
  actor_name: string
  created_at: string
  read_at: string | null
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const configuredDomain = import.meta.env.VITE_CORPORATE_DOMAIN ?? 'empresa.com.br'
const CollaboratorsPage = lazy(() => import('./CollaboratorsPage'))
const InventoryPage = lazy(() => import('./InventoryPage'))
const TicketBoardPage = lazy(() => import('./tickets/TicketBoardPage'))
const TicketLetterPage = lazy(() => import('./tickets/TicketLetterPage'))
const ProgrammingPage = lazy(() => import('./tickets/ProgrammingPage'))
const ApiValidationPage = lazy(() => import('./tickets/ApiValidationPage'))
const EnterpriseInformationPage = lazy(() => import('./EnterpriseInformationPage'))
const WarrantyManagementPage = lazy(() => import('./WarrantyManagementPage'))
const UserProfileModal = lazy(() => import('./UserProfileModal'))
const LegalProcessesPage = lazy(() => import('./LegalProcessesPage'))
const PersonalActivitiesPage = lazy(() => import('./PersonalActivitiesPage'))

function formatDate(value: string | null) {
  if (!value) return 'Ainda não acessou'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

export default function ATechApp() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [domain, setDomain] = useState(configuredDomain)
  const [loading, setLoading] = useState(true)
  const [apiAvailable, setApiAvailable] = useState(true)
  const [pageAccess, setPageAccess] = useState<AdminPage[]>([])
  const [canViewOtherPersonalActivities, setCanViewOtherPersonalActivities] = useState(false)

  useEffect(() => {
    apiRequest<SessionResponse>('/api/auth/session')
      .then((session) => {
        setUser(session.user)
        setDomain(session.corporateDomain)
        setPageAccess(session.pageAccess)
        setCanViewOtherPersonalActivities(session.canViewOtherPersonalActivities)
      })
      .catch(() => setApiAvailable(false))
      .finally(() => setLoading(false))
  }, [])

  async function signOut() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }) }
    finally { setUser(null) }
  }

  if (loading) return <main className="boot-screen"><span className="brand-mark"><Wrench size={19} /></span></main>

  if (!user) {
    const login = <LoginScreen domain={domain} apiAvailable={apiAvailable} onAuthenticated={(session) => {
      setUser(session.user)
      setPageAccess(session.pageAccess)
      setCanViewOtherPersonalActivities(session.canViewOtherPersonalActivities)
    }} />
    return googleClientId ? <GoogleOAuthProvider clientId={googleClientId}>{login}</GoogleOAuthProvider> : login
  }

  return <AdminScreen user={user} domain={domain} pageAccess={pageAccess} canViewOtherPersonalActivities={canViewOtherPersonalActivities} onSignOut={signOut} onUserUpdated={(displayName) => setUser((current) => current ? { ...current, displayName } : current)} />
}

function LoginScreen({ domain, apiAvailable, onAuthenticated }: {
  domain: string
  apiAvailable: boolean
  onAuthenticated: (session: SessionResponse) => void
}) {
  const [adminMode, setAdminMode] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function authenticate(path: string, body: Record<string, string>) {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ user: SessionUser }>(path, { method: 'POST', body: JSON.stringify(body) })
      const session = await apiRequest<SessionResponse>('/api/auth/session')
      onAuthenticated({ ...session, user: result.user })
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Falha ao autenticar.')
    } finally {
      setBusy(false)
    }
  }

  function handleAdminSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void authenticate('/api/auth/admin/login', { email, password })
  }

  function handleGoogleSuccess(response: CredentialResponse) {
    if (!response.credential) {
      setError('Não foi possível validar sua conta Google. Tente novamente.')
      return
    }
    void authenticate('/api/auth/google', { credential: response.credential })
  }

  return (
    <main className="login-layout">
      <section className="login-story" aria-label="ATech assistência técnica">
        <div className="story-topline"><Brand /><span className="workspace-tag"><i /> AMBIENTE DE TRABALHO</span></div>
        <div className="story-copy"><span className="eyebrow">OPERAÇÃO TÉCNICA, EM ORDEM</span><h1>O trabalho bem feito começa com <em>acesso certo.</em></h1><p>Um espaço seguro para quem mantém tudo funcionando.</p></div>
        <div className="service-visual" aria-hidden="true">
          <div className="visual-grid" />
          <div className="service-ticket">
            <div className="ticket-head"><span>ATECH / SERVICE DESK</span><span className="ticket-status"><i /> SEGURO</span></div>
            <div className="ticket-rule" />
            <div className="ticket-middle"><span className="ticket-emblem"><Wrench size={24} /></span><span><small>IDENTIDADE VERIFICADA</small><strong>Equipe técnica</strong></span><ArrowUpRight size={18} className="ticket-arrow" /></div>
            <div className="ticket-foot"><span>DOMÍNIO CORPORATIVO</span><span>01 — 03</span></div>
          </div>
          <div className="visual-index">ACESSO CONTROLADO <i /> 24/7</div>
        </div>
        <footer className="story-footer"><span>© ATech</span><span><ShieldCheck size={14} /> Acesso protegido</span></footer>
      </section>

      <section className="login-panel">
        <div className="mobile-brand"><Brand /></div>
        <div className="login-content">
          <div className="login-heading"><span className="eyebrow">BEM-VINDO À ATECH</span><h2>{adminMode ? 'Acesso administrativo' : 'Entre na sua conta'}</h2><p>{adminMode ? 'Use as credenciais de primeiro acesso.' : 'Acesse com seu e-mail corporativo convidado.'}</p></div>
          {!apiAvailable && <div className="notice notice-warning"><CircleAlert size={17} /> API indisponível. Inicie o servidor e o banco para autenticar.</div>}

          {adminMode ? (
            <form className="admin-form" onSubmit={handleAdminSubmit}>
              <label htmlFor="admin-email">E-mail administrador</label>
              <div className="input-wrap"><Mail size={17} /><input id="admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@atech.local" required /></div>
              <label htmlFor="admin-password">Senha</label>
              <div className="input-wrap"><KeyRound size={17} /><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha de acesso" required /></div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? 'Verificando...' : 'Entrar na administração'} <ArrowUpRight size={17} /></button>
              <button className="text-button back-to-google" type="button" onClick={() => { setAdminMode(false); setError('') }}>Voltar ao acesso corporativo</button>
            </form>
          ) : (
            <div className="sso-content">
              <div className="domain-chip"><i /><span>DOMÍNIO AUTORIZADO</span><strong>@{domain}</strong></div>
              {googleClientId ? <div className="google-button-wrap"><GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setError('Falha ao conectar com o Google. Tente novamente.')} text="continue_with" theme="outline" shape="rectangular" size="large" width="360" useOneTap={false} /></div> : <div className="setup-note"><CircleAlert size={18} /><span>Configure as credenciais do Google em <code>.env</code> para habilitar o login corporativo.</span></div>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <p className="invite-hint"><ShieldCheck size={15} /> Somente contas convidadas pela administração podem entrar.</p>
              <div className="login-divider"><span>OU</span></div>
              <button className="secondary-button admin-access" type="button" onClick={() => { setAdminMode(true); setError('') }}><KeyRound size={16} /> Acesso do administrador <ArrowUpRight size={15} /></button>
            </div>
          )}
        </div>
        <div className="login-panel-footer"><span>Precisa de acesso? Solicite um convite ao administrador.</span><span>Privacidade <i /> Segurança</span></div>
      </section>
    </main>
  )
}

function Brand() {
  return <div className="brand-lockup"><span className="brand-mark"><Wrench size={19} strokeWidth={2.2} /></span><span className="brand-name">ATech<span>.</span></span></div>
}

function AdminScreen({ user, domain, pageAccess, canViewOtherPersonalActivities, onSignOut, onUserUpdated }: { user: SessionUser; domain: string; pageAccess: AdminPage[]; canViewOtherPersonalActivities: boolean; onSignOut: () => void; onUserUpdated: (displayName: string) => void }) {
  const [page, setPage] = useState<AdminPage>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('atech.sidebar-collapsed') === 'true')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [search, setSearch] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(user.role === 'admin')
  const [submitting, setSubmitting] = useState(false)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [initialTicketId, setInitialTicketId] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const availablePages: { key: AdminPage; label: string }[] = [
    { key: 'home', label: 'Início' },
    { key: 'tickets', label: 'Chamados' },
    { key: 'schedule', label: 'Programação' },
    { key: 'collaborators', label: 'Colaboradores' },
    { key: 'information', label: 'Informações' },
    { key: 'api-validation', label: 'Validação da API' },
    { key: 'warranties', label: 'Prazos de garantia' },
    { key: 'legal-processes', label: 'Processos Jurídicos' },
    { key: 'personal-activities', label: 'Atividades pessoais' },
  ]
  const canAccessPage = (key: AdminPage) => key === 'inventory'
    ? user.role === 'admin' || pageAccess.includes('collaborators')
    : key === 'letter-filling'
      ? user.role === 'admin' || pageAccess.includes('tickets')
      : user.role === 'admin' || pageAccess.includes(key)
  const openPage = (key: AdminPage) => {
    if (canAccessPage(key)) setPage(key)
  }

  const loadNotifications = useCallback(async () => {
    if (user.role !== 'admin' && !pageAccess.includes('tickets')) return
    try {
      const result = await apiRequest<{ notifications: UserNotification[]; unreadCount: number }>('/api/team/notifications')
      setNotifications(result.notifications)
      setUnreadNotifications(result.unreadCount)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar as notificações.' })
    }
  }, [pageAccess, user.role])

  const clearInitialTicket = useCallback(() => setInitialTicketId(null), [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadNotifications(), 0)
    const timer = window.setInterval(() => void loadNotifications(), 60_000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [loadNotifications])

  async function openNotification(notification: UserNotification) {
    if (!canAccessPage('tickets')) return
    try {
      await apiRequest(`/api/team/notifications/${notification.id}/read`, { method: 'PATCH' })
      await loadNotifications()
      setInitialTicketId(notification.ticket_id)
      setShowNotifications(false)
      openPage('tickets')
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir a notificação.' })
    }
  }

  async function markAllNotificationsRead() {
    try {
      await apiRequest('/api/team/notifications/read-all', { method: 'PATCH' })
      await loadNotifications()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível marcar as notificações como lidas.' })
    }
  }

  async function loadUsers() {
    setLoading(true)
    try {
      const result = await apiRequest<{ users: ManagedUser[] }>('/api/users')
      setUsers(result.users)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar usuários.' })
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (user.role !== 'admin') return
    let cancelled = false
    apiRequest<{ users: ManagedUser[] }>('/api/users')
      .then((result) => { if (!cancelled) setUsers(result.users) })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar usuários.' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.role])

  useEffect(() => {
    localStorage.setItem('atech.sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setNotice(null)
    try {
      await apiRequest('/api/users/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail }) })
      setInviteEmail('')
      setNotice({ kind: 'success', text: 'Convite criado. A pessoa já pode entrar com a conta Google corporativa.' })
      await loadUsers()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível criar o convite.' })
    } finally { setSubmitting(false) }
  }

  async function changeStatus(member: ManagedUser) {
    const status = member.status === 'suspended' ? 'active' : 'suspended'
    setNotice(null)
    try {
      await apiRequest(`/api/users/${member.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadUsers()
      setNotice({ kind: 'success', text: status === 'suspended' ? 'Acesso suspenso.' : 'Acesso reativado.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o acesso.' })
    }
  }

  async function changePageAccess(member: ManagedUser, pageKey: AdminPage, enabled: boolean) {
    const pages = enabled
      ? [...new Set([...member.pageAccess, pageKey])]
      : member.pageAccess.filter((key) => key !== pageKey)
    setNotice(null)
    try {
      await apiRequest(`/api/users/${member.id}/page-access`, {
        method: 'PATCH',
        body: JSON.stringify({ pages }),
      })
      setUsers((current) => current.map((entry) => entry.id === member.id
        ? { ...entry, pageAccess: pages, canAccessLegalProcesses: pages.includes('legal-processes') }
        : entry))
      setNotice({ kind: 'success', text: `Acesso à página ${enabled ? 'liberado' : 'removido'} para ${member.displayName}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o acesso à página.' })
    }
  }

  async function changePersonalActivitiesViewAccess(member: ManagedUser, enabled: boolean) {
    setNotice(null)
    try {
      await apiRequest(`/api/users/${member.id}/personal-activities-view-access`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      setUsers((current) => current.map((entry) => entry.id === member.id
        ? { ...entry, canViewOtherPersonalActivities: enabled }
        : entry))
      setNotice({ kind: 'success', text: `Visualização de outros quadros ${enabled ? 'liberada' : 'removida'} para ${member.displayName}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar a permissão dos quadros.' })
    }
  }

  const activeCount = users.filter((member) => member.role === 'member' && member.status === 'active').length
  const invitedCount = users.filter((member) => member.status === 'invited').length
  const suspendedCount = users.filter((member) => member.status === 'suspended').length
  const filteredUsers = users.filter((member) => `${member.displayName} ${member.email}`.toLowerCase().includes(search.toLowerCase()))
  const pageTitles: Record<AdminPage, string> = {
    home: 'Visão geral',
    tickets: 'Chamados',
    'letter-filling': 'Preenchimento de cartas',
    schedule: 'Programação',
    collaborators: 'Colaboradores',
    information: 'Informações',
    accesses: 'Acessos',
    'api-validation': 'Validação da API',
    warranties: 'Prazos de garantia',
    'legal-processes': 'Processos Jurídicos',
    'personal-activities': 'Atividades pessoais',
    inventory: 'Gestão de estoque',
  }

  return (
    <main className={`workspace-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header"><Brand /><button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
        <div className="sidebar-label nav-label">MENU PRINCIPAL</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {canAccessPage('home') && <button type="button" title="Início" aria-label="Ir para início" className={`nav-item ${page === 'home' ? 'nav-item-active' : ''}`} onClick={() => setPage('home')}><LayoutDashboard size={17} /><span>Início</span></button>}
          {canAccessPage('tickets') && <button type="button" title="Chamados" aria-label="Ir para chamados" className={`nav-item ${page === 'tickets' ? 'nav-item-active' : ''}`} onClick={() => setPage('tickets')}><ClipboardList size={17} /><span>Chamados</span></button>}
          {canAccessPage('letter-filling') && <button type="button" title="Preenchimento de cartas" aria-label="Ir para preenchimento de cartas" className={`nav-item ${page === 'letter-filling' ? 'nav-item-active' : ''}`} onClick={() => setPage('letter-filling')}><FileText size={17} /><span>Preenchimento de cartas</span></button>}
          {canAccessPage('schedule') && <button type="button" title="Programação" aria-label="Ir para programação" className={`nav-item ${page === 'schedule' ? 'nav-item-active' : ''}`} onClick={() => setPage('schedule')}><CalendarDays size={17} /><span>Programação</span></button>}
          {canAccessPage('collaborators') && <button type="button" title="Colaboradores" aria-label="Ir para colaboradores" className={`nav-item ${page === 'collaborators' ? 'nav-item-active' : ''}`} onClick={() => setPage('collaborators')}><ContactRound size={17} /><span>Colaboradores</span></button>}
          {canAccessPage('inventory') && <button type="button" title="Gestão de estoque" aria-label="Ir para gestão de estoque" className={`nav-item ${page === 'inventory' ? 'nav-item-active' : ''}`} onClick={() => setPage('inventory')}><Package size={17} /><span>Estoque</span></button>}
          {canAccessPage('api-validation') && <button type="button" title="Validação da API" aria-label="Ir para validação da API" className={`nav-item ${page === 'api-validation' ? 'nav-item-active' : ''}`} onClick={() => setPage('api-validation')}><Zap size={17} /><span>Validação API</span></button>}
          {canAccessPage('warranties') && <button type="button" title="Prazos de garantia" aria-label="Ir para prazos de garantia" className={`nav-item ${page === 'warranties' ? 'nav-item-active' : ''}`} onClick={() => setPage('warranties')}><ShieldCheck size={17} /><span>Garantias</span></button>}
          {canAccessPage('legal-processes') && <button type="button" title="Processos Jurídicos" aria-label="Ir para processos jurídicos" className={`nav-item ${page === 'legal-processes' ? 'nav-item-active' : ''}`} onClick={() => setPage('legal-processes')}><BriefcaseBusiness size={17} /><span>Processos Jurídicos</span></button>}
          {canAccessPage('personal-activities') && <button type="button" title="Atividades pessoais" aria-label="Ir para atividades pessoais" className={`nav-item ${page === 'personal-activities' ? 'nav-item-active' : ''}`} onClick={() => setPage('personal-activities')}><ListTodo size={17} /><span>Atividades pessoais</span></button>}
          {canAccessPage('information') && <button type="button" title="Informações" aria-label="Ir para informações" className={`nav-item ${page === 'information' ? 'nav-item-active' : ''}`} onClick={() => setPage('information')}><Info size={17} /><span>Informações</span></button>}
          {user.role === 'admin' && <button type="button" title="Acessos" aria-label="Ir para acessos" className={`nav-item ${page === 'accesses' ? 'nav-item-active' : ''}`} onClick={() => setPage('accesses')}><UsersRound size={17} /><span>Acessos</span></button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-security"><ShieldCheck size={16} /><span><strong>Acesso protegido</strong><small>Domínio @{domain}</small></span></div>
          <button className="profile-row" type="button" onClick={() => setShowProfile(true)} title="Editar perfil"><span className="profile-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="profile-info"><strong>{user.displayName}</strong><small>Editar perfil e assinatura</small></span><Pencil size={15} /></button>
        </div>
      </aside>

      <section className="workspace-main" id="usuarios">
        <header className="topbar"><div className="breadcrumbs">Espaço de trabalho <span>/</span> <strong>{pageTitles[page]}</strong></div><div className="topbar-right"><span className="live-indicator"><i /> Sistema operacional</span><span className="topbar-divider" /><div className="notification-center"><button className="notification-trigger" type="button" aria-label={`Notificações${unreadNotifications ? `, ${unreadNotifications} não lidas` : ''}`} aria-expanded={showNotifications} onClick={() => { setShowNotifications((value) => !value); void loadNotifications() }}><Bell size={17} />{unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button>{showNotifications && <div className="notification-popover"><header><div><strong>Notificações</strong><small>{unreadNotifications} não lidas</small></div>{unreadNotifications > 0 && <button className="text-action-btn" type="button" onClick={() => void markAllNotificationsRead()}>Marcar todas como lidas</button>}</header>{notifications.length ? <ul>{notifications.map((notification) => <li key={notification.id}><button type="button" className={notification.read_at ? '' : 'is-unread'} onClick={() => void openNotification(notification)}><strong>{notification.message}</strong><span>#{notification.protocol} · {notification.actor_name}</span><small>{formatDate(notification.created_at)}</small></button></li>)}</ul> : <p>Você não tem notificações.</p>}</div>}</div><span className="topbar-admin">{user.role === 'admin' ? 'Administração' : 'Workspace'}</span></div></header>
        <div className="page-content">
          <Suspense fallback={<div className="page-loading"><span className="page-loading-spinner" />Carregando página...</div>}>
          {page === 'home' ? (
            <HomeDashboard user={user} users={users} loading={loading} pageAccess={pageAccess} onOpenCollaborators={() => openPage('collaborators')} onOpenPage={openPage} />
          ) : page === 'api-validation' && canAccessPage('api-validation') ? (
            <ApiValidationPage onGoToTickets={() => setPage('tickets')} />
          ) : page === 'tickets' && canAccessPage('tickets') ? (
            <TicketBoardPage
              canManageIntegration={user.role === 'admin'}
              onOpenValidation={() => setPage('api-validation')}
              currentUser={{ id: user.id, role: user.role, displayName: user.displayName }}
              initialTicketId={initialTicketId}
              onTicketOpened={clearInitialTicket}
            />
          ) : page === 'letter-filling' && canAccessPage('letter-filling') ? (
            <TicketLetterPage />
          ) : page === 'schedule' && canAccessPage('schedule') ? (
            <ProgrammingPage />
          ) : page === 'collaborators' && canAccessPage('collaborators') ? (
            <CollaboratorsPage />
          ) : page === 'inventory' && canAccessPage('inventory') ? (
            <InventoryPage />
          ) : page === 'information' && canAccessPage('information') ? (
            <EnterpriseInformationPage />
          ) : page === 'warranties' && canAccessPage('warranties') ? (
            <WarrantyManagementPage />
          ) : page === 'legal-processes' && canAccessPage('legal-processes') ? (
            <LegalProcessesPage currentUser={{ id: user.id, role: user.role }} />
          ) : page === 'personal-activities' && canAccessPage('personal-activities') ? (
            <PersonalActivitiesPage currentUser={user} canViewOtherActivities={canViewOtherPersonalActivities} />
          ) : page === 'accesses' ? (
            <>
          <div className="page-heading-row"><div><div className="eyebrow page-eyebrow">CONTROLE DE ACESSO</div><h1>Gestão de usuários</h1><p>Convide e acompanhe quem pode acessar a ATech.</p></div><span className="domain-badge"><ShieldCheck size={15} /> @{domain}</span></div>
          {notice && <div className={`notice notice-${notice.kind}`} role="status"><span className="notice-symbol">{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

          <section className="metrics" aria-label="Resumo de acessos">
            <article className="metric"><span className="metric-icon"><UsersRound size={17} /></span><span className="metric-label">Pessoas com acesso</span><strong>{users.length}</strong><small>Inclui a conta administradora</small></article>
            <article className="metric metric-active"><span className="metric-icon"><Check size={17} /></span><span className="metric-label">Acessos ativos</span><strong>{activeCount}</strong><small>Contas corporativas liberadas</small></article>
            <article className="metric metric-pending"><span className="metric-icon"><Clock3 size={17} /></span><span className="metric-label">Convites pendentes</span><strong>{invitedCount}</strong><small>Aguardando primeiro acesso</small></article>
            <article className="metric metric-paused"><span className="metric-icon"><Ban size={17} /></span><span className="metric-label">Acessos suspensos</span><strong>{suspendedCount}</strong><small>Sem permissão para entrar</small></article>
          </section>

          <section className="invite-section" aria-labelledby="invite-heading">
            <div className="invite-copy"><span className="invite-icon"><Mail size={18} /></span><div><h2 id="invite-heading">Convidar para a equipe</h2><p>Somente endereços <strong>@{domain}</strong> podem receber acesso.</p></div></div>
            <form className="invite-form" onSubmit={inviteUser}><div className="input-wrap invite-input"><Mail size={16} /><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder={`nome@${domain}`} aria-label="E-mail corporativo para convite" required /></div><button className="primary-button invite-submit" type="submit" disabled={submitting}><Plus size={17} />{submitting ? 'Convidando...' : 'Enviar convite'}</button></form>
          </section>

          <section className="directory-section" aria-labelledby="directory-heading">
            <div className="directory-heading"><div><h2 id="directory-heading">Pessoas e permissões</h2><p>{users.length} {users.length === 1 ? 'pessoa cadastrada' : 'pessoas cadastradas'}</p></div><div className="filter-search-actions"><label className="search-box"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pessoa" aria-label="Buscar por nome ou e-mail" /></label><button className="filter-clear-button" type="button" disabled={!search} onClick={() => setSearch('')}><X size={14} /> Limpar</button></div></div>
            <div className="user-table-wrap"><table className="user-table"><thead><tr><th>USUÁRIO</th><th>PERMISSÃO</th><th>PÁGINAS LIBERADAS</th><th>STATUS</th><th>ÚLTIMO ACESSO</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
              {loading ? <tr><td colSpan={6} className="table-message">Carregando usuários...</td></tr> : filteredUsers.length === 0 ? <tr><td colSpan={6} className="table-message">{users.length ? 'Nenhum resultado para esta busca.' : 'Ainda não há usuários cadastrados.'}</td></tr> : filteredUsers.map((member) => (
                <tr key={member.id}>
                  <td><div className="user-cell"><span className={`user-avatar ${member.role === 'admin' ? 'user-avatar-admin' : ''}`}>{member.displayName.slice(0, 1).toUpperCase()}</span><span className="user-identity"><strong>{member.displayName}{member.id === user.id && <span className="you-tag">VOCÊ</span>}</strong><small>{member.email}</small></span></div></td>
                  <td><span className={`role-label ${member.role === 'admin' ? 'role-admin' : ''}`}>{member.role === 'admin' ? 'Administrador' : 'Equipe técnica'}</span></td>
                  <td>{member.role === 'admin' ? <span className="role-label role-admin">Acesso total</span> : (
                    <details className="user-page-access">
                      <summary>{member.pageAccess.length} de {availablePages.length} páginas</summary>
                      <div>
                        {availablePages.map(({ key, label }) => (
                          <label key={key}><input type="checkbox" checked={member.pageAccess.includes(key)} disabled={member.status === 'suspended'} onChange={(event) => void changePageAccess(member, key, event.target.checked)} /><span>{label}</span></label>
                        ))}
                        <label className="personal-activity-view-permission"><input type="checkbox" checked={member.canViewOtherPersonalActivities} disabled={member.status === 'suspended'} onChange={(event) => void changePersonalActivitiesViewAccess(member, event.target.checked)} /><span>Selecionar quadro de outra pessoa</span></label>
                      </div>
                    </details>
                  )}</td>
                  <td><span className={`status-pill status-${member.status}`}><i />{member.status === 'active' ? 'Ativo' : member.status === 'invited' ? 'Convite enviado' : 'Suspenso'}</span></td>
                  <td className="last-seen">{member.role === 'admin' ? 'Conta principal' : formatDate(member.lastLoginAt)}</td>
                  <td className="action-cell">{member.role === 'member' && <button className="row-action" type="button" onClick={() => void changeStatus(member)} title={member.status === 'suspended' ? 'Reativar acesso' : 'Suspender acesso'} aria-label={member.status === 'suspended' ? `Reativar ${member.email}` : `Suspender ${member.email}`}><span className="sr-only">{member.status === 'suspended' ? 'Reativar' : 'Suspender'}</span>{member.status === 'suspended' ? <Check size={16} /> : <Ban size={16} />}</button>}</td>
                </tr>
              ))}
            </tbody></table></div>
            <div className="table-footer"><span><ShieldCheck size={14} /> A autenticação da equipe exige Google Workspace e convite ativo.</span><button className="refresh-button" type="button" onClick={() => void loadUsers()}>Atualizar lista <ArrowUpRight size={14} /></button></div>
          </section>
          <footer className="workspace-footer"><span>ATech · Gestão de acesso</span><span>Administrador único <i /> Domínio verificado</span></footer>
            </>
          ) : (
            <FutureModulePage page={page} />
          )}
          </Suspense>
        </div>
      </section>
      {showProfile && <Suspense fallback={null}><UserProfileModal onClose={() => setShowProfile(false)} onSaved={onUserUpdated} onSignOut={onSignOut} /></Suspense>}
    </main>
  )
}

function HomeDashboard({ user, users, loading, pageAccess, onOpenCollaborators, onOpenPage }: {
  user: SessionUser
  users: ManagedUser[]
  loading: boolean
  pageAccess: AdminPage[]
  onOpenCollaborators: () => void
  onOpenPage: (page: AdminPage) => void
}) {
  const canAccess = (key: AdminPage) => user.role === 'admin' || pageAccess.includes(key)
  const canAccessCollaborators = canAccess('collaborators')
  const activeUsers = users.filter((member) => member.role === 'member' && member.status === 'active').length
  const pendingInvites = users.filter((member) => member.status === 'invited').length
  const [celebrations, setCelebrations] = useState<DashboardCelebrations | null>(null)
  const [celebrationsError, setCelebrationsError] = useState('')

  useEffect(() => {
    if (!canAccessCollaborators) return
    let cancelled = false
    apiRequest<DashboardCelebrations>('/api/collaborators/birthdays')
      .then((result) => { if (!cancelled) setCelebrations(result) })
      .catch((error: unknown) => {
        if (!cancelled) setCelebrationsError(error instanceof Error ? error.message : 'Não foi possível carregar os aniversários.')
      })
    return () => { cancelled = true }
  }, [canAccessCollaborators])

  const renderCelebrants = (people: CelebrationPerson[], emptyMessage: string, includeYear = false) => (
    people.length ? people.map((person) => {
      const month = person.month ?? (person.admissionDate ? Number(person.admissionDate.slice(5, 7)) : 0)
      const admissionDateLabel = person.admissionDate
        ? `${person.admissionDate.slice(8, 10)}/${person.admissionDate.slice(5, 7)}/${person.admissionDate.slice(0, 4)}`
        : ''
      const tenureLabel = `${person.years ?? 0} ${person.years === 1 ? 'ano' : 'anos'}, ${person.months ?? 0} ${person.months === 1 ? 'mês' : 'meses'} e ${person.days ?? 0} ${person.days === 1 ? 'dia' : 'dias'}`
      return (
        <div className="celebrant-row" key={person.id}>
          <span className={`celebrant-day ${includeYear ? 'celebrant-date-full' : ''}`}>{String(person.day).padStart(2, '0')}/{String(month).padStart(2, '0')}{includeYear ? `/${person.year ?? person.admissionDate?.slice(0, 4) ?? ''}` : ''}</span>
          <span className="celebrant-identity"><strong>{person.name}</strong><small>{person.role.replaceAll('_', ' ')}{includeYear && person.admissionDate ? ` · Admissão ${admissionDateLabel} · ${tenureLabel} de empresa` : ''}</small></span>
        </div>
      )
    }) : <p className="celebration-empty">{emptyMessage}</p>
  )

  return (
    <div className="home-dashboard">
      <section className="dashboard-welcome">
        <div className="welcome-copy"><span className="eyebrow">ESPAÇO DE TRABALHO · ATECH</span><h1>Olá, {user.displayName.split(' ')[0]}.</h1><p>Visão geral da assistência técnica e dos acessos da equipe.</p></div>
        <div className="welcome-mark" aria-hidden="true"><Wrench size={30} /></div>
        <span className="welcome-status"><i /> AMBIENTE SEGURO</span>
      </section>

      <div className="dashboard-section-title"><div><span className="eyebrow">AGORA</span><h2>Resumo da equipe</h2></div>{canAccessCollaborators && <button className="text-link" type="button" onClick={onOpenCollaborators}>Gerenciar colaboradores <ArrowRight size={15} /></button>}</div>
      <section className="dashboard-metrics" aria-label="Resumo da equipe">
        <article className="dashboard-metric"><span className="metric-icon"><ContactRound size={17} /></span><span className="metric-label">Contas cadastradas</span><strong>{loading ? '—' : users.filter((member) => member.role === 'member').length}</strong><small>Convites e acessos da equipe</small></article>
        <article className="dashboard-metric"><span className="metric-icon"><Check size={17} /></span><span className="metric-label">Acessos ativos</span><strong>{loading ? '—' : activeUsers}</strong><small>Contas corporativas liberadas</small></article>
        <article className="dashboard-metric dashboard-metric-pending"><span className="metric-icon"><Clock3 size={17} /></span><span className="metric-label">Convites pendentes</span><strong>{loading ? '—' : pendingInvites}</strong><small>Aguardando primeiro acesso</small></article>
      </section>

      {canAccessCollaborators && <>
      <div className="dashboard-section-title celebrations-title"><div><span className="eyebrow">DATAS ESPECIAIS</span><h2>Aniversários da equipe</h2></div></div>
      <section className="celebration-grid" aria-label="Aniversários da equipe">
        <article className="celebration-card"><div className="celebration-card-heading"><CalendarDays size={16} /><div><h3>Aniversários pessoais</h3><small>Datas em dia/mês, sem ano de nascimento</small></div></div>
          {celebrationsError ? <p className="celebration-error">{celebrationsError}</p> : celebrations ? <>
            {(['previous', 'current', 'next'] as const).map((period) => (
              <div className="celebration-subgroup" key={period}>
                <h4>{period === 'previous' ? 'Mês anterior' : period === 'current' ? 'Este mês' : 'Próximo mês'} · {celebrations.birthdays[period].label}</h4>
                {renderCelebrants(celebrations.birthdays[period].people, 'Nenhum aniversário.', false)}
              </div>
            ))}
          </> : <p className="celebration-empty">Carregando...</p>}
        </article>
        <article className="celebration-card"><div className="celebration-card-heading"><ContactRound size={16} /><div><h3>Tempo de empresa · {celebrations?.workAnniversaries.current.label ?? 'este mês'}</h3><small>Aniversários de vínculo</small></div></div>
          {celebrationsError ? <p className="celebration-error">{celebrationsError}</p> : celebrations ? renderCelebrants(celebrations.workAnniversaries.current.people, 'Nenhum aniversário de empresa neste mês.', true) : <p className="celebration-empty">Carregando...</p>}
        </article>
        <article className="celebration-card celebration-card-nearby"><div className="celebration-card-heading"><CalendarDays size={16} /><div><h3>Tempo de empresa · meses próximos</h3><small>Antes e depois deste mês</small></div></div>
          {celebrationsError ? <p className="celebration-error">{celebrationsError}</p> : celebrations ? <>
            <div className="celebration-subgroup"><h4>Mês anterior · {celebrations.workAnniversaries.previous.label}</h4>{renderCelebrants(celebrations.workAnniversaries.previous.people, 'Nenhum aniversário.', true)}</div>
            <div className="celebration-subgroup"><h4>Próximo mês · {celebrations.workAnniversaries.next.label}</h4>{renderCelebrants(celebrations.workAnniversaries.next.people, 'Nenhum aniversário.', true)}</div>
          </> : <p className="celebration-empty">Carregando...</p>}
        </article>
      </section>
      </>}

      <div className="dashboard-section-title modules-title"><div><span className="eyebrow">PLATAFORMA</span><h2>Áreas de trabalho</h2></div></div>
      <section className="module-grid" aria-label="Áreas da plataforma">
        {canAccessCollaborators && <button className="module-item module-item-live" type="button" onClick={onOpenCollaborators}><span className="module-icon"><ContactRound size={18} /></span><span className="module-copy"><strong>Colaboradores</strong><small>Acessos, convites e permissões</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccessCollaborators && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('inventory')}><span className="module-icon"><Package size={18} /></span><span className="module-copy"><strong>Estoque</strong><small>Insumos, EPI e ferramentas</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('tickets') && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('tickets')}><span className="module-icon"><ClipboardList size={17} /></span><span className="module-copy"><strong>Chamados</strong><small>Quadro Kanban e atendimentos</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('schedule') && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('schedule')}><span className="module-icon"><CalendarDays size={17} /></span><span className="module-copy"><strong>Programação</strong><small>Agenda e atividades técnicas</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('api-validation') && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('api-validation')}><span className="module-icon"><Zap size={17} /></span><span className="module-copy"><strong>Validação API</strong><small>Integração CVCRM e carga CSV</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('warranties') && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('warranties')}><span className="module-icon"><ShieldCheck size={17} /></span><span className="module-copy"><strong>Prazos de garantia</strong><small>Subassuntos de assistência técnica</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('personal-activities') && <button className="module-item module-item-live" type="button" onClick={() => onOpenPage('personal-activities')}><span className="module-icon"><ListTodo size={17} /></span><span className="module-copy"><strong>Atividades pessoais</strong><small>Seu quadro pessoal de atividades</small></span><ArrowUpRight size={16} className="module-arrow" /></button>}
        {canAccess('information') && <button className="module-item" type="button" onClick={() => onOpenPage('information')}><span className="module-icon"><Info size={17} /></span><span className="module-copy"><strong>Informações</strong><small>Referências e dados operacionais</small></span><span className="module-tag">EM PREPARAÇÃO</span></button>}
      </section>
      <footer className="workspace-footer"><span>ATech · Assistência técnica</span><span>Administração segura <i /> {users.length} {users.length === 1 ? 'conta' : 'contas'}</span></footer>
    </div>
  )
}

function FutureModulePage({ page }: { page: AdminPage }) {
  const module = {
    tickets: { title: 'Chamados', description: 'Atendimentos técnicos e solicitações em um só lugar.', icon: ClipboardList },
    'letter-filling': { title: 'Preenchimento de cartas', description: 'Geração de notificações e termos a partir dos chamados.', icon: FileText },
    schedule: { title: 'Programação', description: 'Agenda de serviços e atividades da equipe.', icon: CalendarDays },
    information: { title: 'Informações', description: 'Referências e dados úteis para a operação técnica.', icon: Info },
    accesses: { title: 'Acessos', description: 'Contas administrativas e convites.', icon: UsersRound },
    'api-validation': { title: 'Validação da API', description: 'Painel de testes e controle da API CVCRM.', icon: Zap },
    warranties: { title: 'Prazos de garantia', description: 'Gestão dos prazos de garantia por subassunto.', icon: ShieldCheck },
    'legal-processes': { title: 'Processos Jurídicos', description: 'Gestão de processos, fases, responsáveis e pagamentos.', icon: BriefcaseBusiness },
    'personal-activities': { title: 'Atividades pessoais', description: 'Seu quadro privado para organizar atividades.', icon: ListTodo },
    home: { title: 'Início', description: '', icon: LayoutDashboard },
    collaborators: { title: 'Colaboradores', description: '', icon: ContactRound },
    inventory: { title: 'Gestão de estoque', description: 'Insumos, movimentações, EPIs e ferramentas.', icon: Package },
  }[page]
  const ModuleIcon = module.icon

  return (
    <section className="future-page">
      <span className="future-icon"><ModuleIcon size={22} /></span>
      <span className="eyebrow">PRÓXIMA ETAPA</span>
      <h1>{module.title}</h1>
      <p>{module.description}</p>
      <span className="future-status"><i /> Módulo em preparação</span>
    </section>
  )
}
