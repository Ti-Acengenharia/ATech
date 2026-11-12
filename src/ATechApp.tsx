import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google'
import { apiRequest } from './api/client'
import { startLiveSync } from './api/liveSync'
import {
  ArrowUpRight,
  Ban,
  Bell,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  ContactRound,
  ClipboardList,
  FileText,
  History,
  Info,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Lock,
  Mail,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
  Zap,
  X,
} from 'lucide-react'
import { APP_CURRENT_VERSION } from './version'
import { ATechLoading } from './ATechLoading'
import './atech.css'

type UserRole = 'admin' | 'member'
type UserStatus = 'invited' | 'active' | 'suspended'
type AdminPage = 'home' | 'tickets' | 'letter-filling' | 'schedule' | 'collaborators' | 'inventory' | 'information' | 'accesses' | 'api-validation' | 'warranties' | 'legal-processes' | 'personal-activities' | 'logs' | 'work-calendar' | 'stock-units'
type AppPage = AdminPage | 'not-found'

interface SessionUser {
  id: number
  email: string
  displayName: string
  role: UserRole
}

interface ManagedUser extends SessionUser {
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
  canAccessLegalProcesses: boolean
  canViewOtherPersonalActivities: boolean
  pageAccess: AdminPage[]
  hasPin?: boolean
  hasSignature?: boolean
  isPinLocked?: boolean
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
  source?: 'ticket' | 'legal-process' | 'stock-unit'
  ticket_id: string | null
  process_id?: string | null
  stock_unit_id?: string | null
  protocol: string
  process_number?: string | null
  kind: 'mention' | 'mention_reply' | 'legal_mention' | 'stock_status_change'
  message: string
  actor_name: string
  created_at: string
  read_at: string | null
}

interface AuditLogEntry {
  id: string
  actorUserId: number | null
  actorName: string
  action: string
  resourceType: string
  resourceId: string
  summary: string
  createdAt: string
}

interface QuickSearchResultItem {
  kind: 'ticket' | 'legal-process' | 'collaborator'
  id: string
  title: string
  subtitle: string
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const configuredDomain = import.meta.env.VITE_CORPORATE_DOMAIN ?? 'empresa.com.br'
const CollaboratorsPage = lazy(() => import('./CollaboratorsPage'))
const HomeDashboard = lazy(() => import('./HomeDashboard'))
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
const HomepageTicketsFilterSettings = lazy(() => import('./HomepageTicketsFilterSettings'))
const SessionTimeoutSettings = lazy(() => import('./SessionTimeoutSettings'))
const WhatsAppSettings = lazy(() => import('./WhatsAppSettings'))
const AuditLogsPage = lazy(() => import('./AuditLogsPage'))
const CalendarManagementPage = lazy(() => import('./CalendarManagementPage'))
const StockUnitsPage = lazy(() => import('./StockUnitsPage'))
const VersionHistoryModal = lazy(() => import('./VersionHistoryModal'))
const NotFoundPage = lazy(() => import('./NotFoundPage'))
const PrivacyPolicyModal = lazy(() => import('./PrivacyPolicyModal'))

const allAdminPages: AdminPage[] = [
  'home', 'tickets', 'letter-filling', 'schedule', 'collaborators', 'inventory',
  'information', 'accesses', 'api-validation', 'warranties', 'legal-processes', 'personal-activities', 'logs', 'work-calendar', 'stock-units',
]

function readPageFromLocation(): AppPage {
  if (typeof window === 'undefined') return 'home'
  const queryPage = new URLSearchParams(window.location.search).get('page')
  if (queryPage) {
    if (queryPage === 'ticket-dashboard') {
      return 'tickets'
    }
    if (queryPage === 'legal-dashboard') {
      return 'legal-processes'
    }
    if (allAdminPages.includes(queryPage as AdminPage)) {
      return queryPage as AdminPage
    }
    return 'not-found'
  }
  const pathSegment = window.location.pathname.replace(/^\/+|\/+$/g, '')
  if (pathSegment) {
    if (pathSegment === 'ticket-dashboard' || pathSegment === 'tickets/dashboard') {
      return 'tickets'
    }
    if (pathSegment === 'legal-dashboard' || pathSegment === 'legal-processes/dashboard') {
      return 'legal-processes'
    }
    if (allAdminPages.includes(pathSegment as AdminPage)) {
      return pathSegment as AdminPage
    }
    return 'not-found'
  }
  return 'home'
}

function formatDate(value: string | null) {
  if (!value) return 'Ainda não acessou'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function ATechApp() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [domain, setDomain] = useState(configuredDomain)
  const [loading, setLoading] = useState(true)
  const [apiAvailable, setApiAvailable] = useState(true)
  const [pageAccess, setPageAccess] = useState<AdminPage[]>([])
  const [canViewOtherPersonalActivities, setCanViewOtherPersonalActivities] = useState(false)
  const [sessionNotice, setSessionNotice] = useState('')

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

  useEffect(() => {
    function handleSessionExpired(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setUser(null)
      setSessionNotice(detail?.message || 'Sua sessão expirou. Faça login novamente para continuar.')
    }
    window.addEventListener('atech:session-expired', handleSessionExpired)
    return () => window.removeEventListener('atech:session-expired', handleSessionExpired)
  }, [])

  useEffect(() => {
    if (!user) return

    let lastCheckTime = Date.now()

    const verifySession = async () => {
      try {
        const session = await apiRequest<SessionResponse>('/api/auth/session')
        if (!session.user) {
          setUser(null)
          setSessionNotice('Sua sessão expirou por inatividade. Faça login novamente para continuar.')
        } else {
          setPageAccess(session.pageAccess)
          setCanViewOtherPersonalActivities(session.canViewOtherPersonalActivities)
        }
      } catch {
        // apiRequest já dispara atech:session-expired em caso de desconexão ou expiração
      }
    }

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        if (now - lastCheckTime >= 30_000) {
          lastCheckTime = now
          void verifySession()
        }
      }
    }

    const heartbeatTimer = window.setInterval(() => {
      lastCheckTime = Date.now()
      void verifySession()
    }, 120_000)

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)

    return () => {
      window.clearInterval(heartbeatTimer)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    return startLiveSync()
  }, [user])

  async function signOut() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }) }
    finally {
      setSessionNotice('')
      setUser(null)
    }
  }

  if (loading) {
    return (
      <ATechLoading
        fullscreen
        message="Carregando informações..."
        subtitle="Verificando sessão e ambiente de trabalho..."
      />
    )
  }

  if (!user) {
    const login = <LoginScreen domain={domain} apiAvailable={apiAvailable} sessionNotice={sessionNotice} onAuthenticated={(session) => {
      setSessionNotice('')
      setUser(session.user)
      setPageAccess(session.pageAccess)
      setCanViewOtherPersonalActivities(session.canViewOtherPersonalActivities)
    }} />
    return googleClientId ? <GoogleOAuthProvider clientId={googleClientId}>{login}</GoogleOAuthProvider> : login
  }

  return <AdminScreen user={user} domain={domain} pageAccess={pageAccess} canViewOtherPersonalActivities={canViewOtherPersonalActivities} onSignOut={signOut} onUserUpdated={(displayName) => setUser((current) => current ? { ...current, displayName } : current)} />
}

function LoginScreen({ domain, apiAvailable, sessionNotice, onAuthenticated }: {
  domain: string
  apiAvailable: boolean
  sessionNotice?: string
  onAuthenticated: (session: SessionResponse) => void
}) {
  const [adminMode, setAdminMode] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
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
    <main className="despojado-login-layout">
      {/* Coluna Visual Hero: Destaque para ATech e AC Engenharia */}
      <section className="login-hero-showcase" aria-label="Apresentação ATech e AC Engenharia">
        <div className="hero-mesh-glow hero-glow-1" />
        <div className="hero-mesh-glow hero-glow-2" />
        <div className="hero-grid-pattern" />

        <div className="hero-topline">
          <div className="hero-company-pill">
            <span className="hero-logo-box">
              <img src="/logo-ac.png" alt="AC Engenharia" className="hero-logo-img" />
            </span>
            <div className="hero-company-info">
              <strong>AC ENGENHARIA</strong>
              <small>Assistência Técnica & Qualidade</small>
            </div>
          </div>
          <span className="hero-badge-live">
            <i /> AMBIENTE SEGURO
          </span>
        </div>

        <div className="hero-center-content">
          <div className="hero-title-container">
            <span className="hero-super-tag">PLATAFORMA OPERACIONAL INTEGRADA</span>
            <h1 className="hero-atech-title">
              ATech<span className="hero-dot">.</span>
            </h1>
            <p className="hero-description">
              Inteligência, agilidade e excelência técnica para os empreendimentos e clientes da AC Engenharia.
            </p>
          </div>

          <div className="hero-features-stream">
            <div className="hero-feature-card">
              <div className="feature-icon-wrap icon-cyan">
                <ClipboardList size={18} />
              </div>
              <div className="feature-text">
                <strong>Chamados & Vistorias</strong>
                <small>Gestão de ponta a ponta com fluxo CVCRM integrado</small>
              </div>
            </div>

            <div className="hero-feature-card">
              <div className="feature-icon-wrap icon-blue">
                <ListTodo size={18} />
              </div>
              <div className="feature-text">
                <strong>Quadro de Atividades</strong>
                <small>Organização visual de prioridades, prazos e rotinas técnicas</small>
              </div>
            </div>

            <div className="hero-feature-card">
              <div className="feature-icon-wrap icon-purple">
                <ShieldCheck size={18} />
              </div>
              <div className="feature-text">
                <strong>Sincronização em Tempo Real</strong>
                <small>Informações sempre atualizadas para toda a equipe</small>
              </div>
            </div>
          </div>
        </div>

        <footer className="hero-footer-bar">
          <span>© AC Engenharia · Todos os direitos reservados</span>
          <span>Acesso corporativo seguro</span>
        </footer>
      </section>

      {/* Coluna de Login: Ação de entrada fluida e moderna */}
      <section className="login-action-column">
        <div className="login-action-container">
          <div className="login-mobile-brand">
            <span className="mobile-logo-box">
              <img src="/logo-ac.png" alt="AC Engenharia" className="hero-logo-img" />
            </span>
            <span className="mobile-atech-logo">ATech<span>.</span></span>
          </div>

          {sessionNotice && (
            <div className="despojado-alert session-alert" role="alert">
              <CircleAlert size={16} />
              <span>{sessionNotice}</span>
            </div>
          )}

          {!apiAvailable && (
            <div className="despojado-alert api-alert" role="alert">
              <CircleAlert size={16} />
              <span>Servidor ou banco temporariamente indisponível. Verifique a conexão.</span>
            </div>
          )}

          <div className="login-panel-card">
            <div className="login-panel-head">
              <span className="eyebrow">{adminMode ? 'ACESSO RESTRITO' : 'PORTAL CORPORATIVO'}</span>
              <h2>{adminMode ? 'Acesso Administrativo' : 'Bem-vindo de volta'}</h2>
              <p>
                {adminMode
                  ? 'Informe seu e-mail e senha de administrador para gerenciar a plataforma.'
                  : 'Acesse seu ambiente de trabalho com a conta Google corporativa.'}
              </p>
            </div>

            {adminMode ? (
              <form className="despojado-admin-form" onSubmit={handleAdminSubmit}>
                <label htmlFor="admin-email">E-mail de administrador</label>
                <div className="input-wrap">
                  <Mail size={16} />
                  <input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@atech.local"
                    required
                  />
                </div>

                <label htmlFor="admin-password">Senha de acesso</label>
                <div className="input-wrap">
                  <KeyRound size={16} />
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}

                <button className="primary-button login-submit-btn" type="submit" disabled={busy}>
                  {busy ? 'Verificando...' : 'Entrar na administração'}
                  <ArrowUpRight size={16} />
                </button>

                <button
                  className="text-button login-back-link"
                  type="button"
                  onClick={() => {
                    setAdminMode(false)
                    setError('')
                  }}
                >
                  ← Voltar ao login corporativo (Google)
                </button>
              </form>
            ) : (
              <div className="despojado-sso-wrap">
                <div className="authorized-domain-card">
                  <div className="domain-indicator-pulse" />
                  <div className="domain-text">
                    <small>DOMÍNIO AUTORIZADO</small>
                    <strong>@{domain}</strong>
                  </div>
                  <ShieldCheck size={16} className="domain-shield-icon" />
                </div>

                {googleClientId ? (
                  <div className="google-auth-button-area">
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError('Falha ao conectar com o Google. Tente novamente.')}
                      text="continue_with"
                      theme="outline"
                      shape="rectangular"
                      size="large"
                      width="100%"
                      useOneTap={false}
                    />
                  </div>
                ) : (
                  <div className="despojado-setup-note">
                    <CircleAlert size={17} />
                    <span>Configure <code>VITE_GOOGLE_CLIENT_ID</code> para habilitar o login corporativo.</span>
                  </div>
                )}

                {error && <p className="form-error" role="alert">{error}</p>}

                <div className="invited-only-banner">
                  <UsersRound size={14} />
                  <span>Acesso liberado somente para colaboradores convidados pela administração.</span>
                </div>
              </div>
            )}

            <div className="panel-discreet-footer">
              <span>AC Engenharia · ATech</span>
              {!adminMode && (
                <button
                  type="button"
                  className="despojado-discreet-admin-link"
                  onClick={() => {
                    setAdminMode(true)
                    setError('')
                  }}
                  title="Acesso de manutenção com credenciais"
                  aria-label="Acesso restrito de manutenção"
                >
                  <KeyRound size={11} />
                  <span>Acesso com credenciais</span>
                </button>
              )}
            </div>
          </div>

          <div className="login-subfooter">
            <span>Precisa de acesso? Solicite convite ao seu gestor ou suporte técnico.</span>
            <button
              type="button"
              className="login-privacy-link"
              onClick={() => setShowPrivacy(true)}
            >
              Privacidade & Termos LGPD
            </button>
          </div>
        </div>
      </section>

      {showPrivacy && (
        <Suspense fallback={null}>
          <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />
        </Suspense>
      )}
    </main>
  )
}

function Brand() {
  return (
    <div className="brand-lockup">
      <span className="brand-mark brand-logo-mark">
        <img src="/logo-ac.png" alt="AC Engenharia" className="brand-logo-img" />
      </span>
      <span className="brand-name">ATech<span>.</span></span>
    </div>
  )
}

function AdminScreen({ user, domain, pageAccess, canViewOtherPersonalActivities, onSignOut, onUserUpdated }: { user: SessionUser; domain: string; pageAccess: AdminPage[]; canViewOtherPersonalActivities: boolean; onSignOut: () => void; onUserUpdated: (displayName: string) => void }) {
  const [pageState, setPageState] = useState<AppPage>(readPageFromLocation)
  const [ticketView, setTicketView] = useState<'kanban' | 'list' | 'dashboard'>(() => {
    if (typeof window === 'undefined') return 'kanban'
    const viewParam = new URLSearchParams(window.location.search).get('view')?.toLowerCase()
    const pageParam = new URLSearchParams(window.location.search).get('page')?.toLowerCase()
    const pathname = window.location.pathname.toLowerCase()
    if (
      viewParam === 'dashboard' ||
      pageParam === 'ticket-dashboard' ||
      pathname.includes('/ticket-dashboard') ||
      pathname.includes('/tickets/dashboard')
    ) {
      return 'dashboard'
    }
    if (viewParam === 'list') return 'list'
    return 'kanban'
  })
  const [legalView, setLegalView] = useState<'board' | 'list' | 'dashboard'>(() => {
    if (typeof window === 'undefined') return 'board'
    const viewParam = new URLSearchParams(window.location.search).get('view')?.toLowerCase()
    const pageParam = new URLSearchParams(window.location.search).get('page')?.toLowerCase()
    const pathname = window.location.pathname.toLowerCase()
    if (
      viewParam === 'dashboard' ||
      pageParam === 'legal-dashboard' ||
      pathname.includes('/legal-dashboard') ||
      pathname.includes('/legal-processes/dashboard')
    ) {
      return 'dashboard'
    }
    if (viewParam === 'list') return 'list'
    return 'board'
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('atech.sidebar-collapsed') === 'true')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('atech.sidebar-open-menus')
      if (saved) return JSON.parse(saved)
    } catch {
      // fallback
    }
    return {
      chamados: true,
      administracao: true,
      configuracoes: true,
    }
  })
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [search, setSearch] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(user.role === 'admin')
  const [submitting, setSubmitting] = useState(false)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [initialTicketId, setInitialTicketId] = useState<string | null>(null)
  const [initialProcessId, setInitialProcessId] = useState<string | null>(null)
  const [initialCollaboratorId, setInitialCollaboratorId] = useState<string | null>(null)
  const [initialStockUnitId, setInitialStockUnitId] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showVersionModal, setShowVersionModal] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)

  // Command Palette (Ctrl + K)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandResults, setCommandResults] = useState<QuickSearchResultItem[]>([])
  const [commandSearching, setCommandSearching] = useState(false)

  const availablePages: { key: AdminPage; label: string }[] = [
    { key: 'home', label: 'Início' },
    { key: 'tickets', label: 'Chamados' },
    { key: 'letter-filling', label: 'Preenchimento de cartas' },
    { key: 'schedule', label: 'Programação' },
    { key: 'collaborators', label: 'Colaboradores' },
    { key: 'inventory', label: 'Estoque' },
    { key: 'stock-units', label: 'Unidades em estoque' },
    { key: 'information', label: 'Informações de empreendimentos' },
    { key: 'warranties', label: 'Prazos de garantia' },
    { key: 'legal-processes', label: 'Processos Jurídicos' },
    { key: 'personal-activities', label: 'Minhas atividades' },
  ]
  const canAccessPage = useCallback((key: AdminPage) => (key === 'accesses' || key === 'logs' || key === 'work-calendar' || key === 'api-validation')
    ? user.role === 'admin'
    : user.role === 'admin' || pageAccess.includes(key), [pageAccess, user.role])
  const isForbidden = pageState !== 'not-found' && !canAccessPage(pageState)
  const page: AppPage = pageState
  const setPage = useCallback((nextPage: AppPage) => {
    if (nextPage !== 'not-found' && !canAccessPage(nextPage)) return
    setPageState(nextPage)
    const url = new URL(window.location.href)
    if (nextPage === 'home') {
      url.searchParams.delete('page')
    } else if (nextPage !== 'not-found') {
      url.searchParams.set('page', nextPage)
    }
    if (nextPage !== 'tickets') {
      url.searchParams.delete('ticketId')
    }
    if (nextPage !== 'legal-processes') {
      url.searchParams.delete('processId')
    }
    if (nextPage !== 'tickets' && nextPage !== 'legal-processes') {
      url.searchParams.delete('view')
    }
    if (nextPage !== 'collaborators') url.searchParams.delete('collaboratorId')
    if (nextPage !== 'stock-units') url.searchParams.delete('unitId')
    const target = `${url.pathname}${url.search}${url.hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
      window.history.pushState({ page: nextPage }, '', target)
    }
  }, [canAccessPage])
  const openPage = (key: AdminPage) => {
    setPage(key)
  }

  useEffect(() => {
    function handleTicketViewChanged(event: Event) {
      const detail = (event as CustomEvent<{ view?: 'kanban' | 'list' | 'dashboard' }>).detail
      if (detail?.view) {
        setTicketView(detail.view)
      }
    }
    function handleLegalViewChanged(event: Event) {
      const detail = (event as CustomEvent<{ view?: 'board' | 'list' | 'dashboard' }>).detail
      if (detail?.view) {
        setLegalView(detail.view)
      }
    }
    function handlePopState() {
      const next = readPageFromLocation()
      setPageState(next)
      const viewParam = new URLSearchParams(window.location.search).get('view')?.toLowerCase()
      const pageParam = new URLSearchParams(window.location.search).get('page')?.toLowerCase()
      const pathname = window.location.pathname.toLowerCase()
      if (
        viewParam === 'dashboard' ||
        pageParam === 'ticket-dashboard' ||
        pathname.includes('/ticket-dashboard') ||
        pathname.includes('/tickets/dashboard')
      ) {
        setTicketView('dashboard')
      } else if (viewParam === 'list') {
        setTicketView('list')
      } else {
        setTicketView('kanban')
      }

      if (
        viewParam === 'dashboard' ||
        pageParam === 'legal-dashboard' ||
        pathname.includes('/legal-dashboard') ||
        pathname.includes('/legal-processes/dashboard')
      ) {
        setLegalView('dashboard')
      } else if (viewParam === 'list') {
        setLegalView('list')
      } else {
        setLegalView('board')
      }
    }
    window.addEventListener('atech:ticket-view-changed', handleTicketViewChanged)
    window.addEventListener('atech:legal-view-changed', handleLegalViewChanged)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('atech:ticket-view-changed', handleTicketViewChanged)
      window.removeEventListener('atech:legal-view-changed', handleLegalViewChanged)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false)
    setCommandQuery('')
    setCommandResults([])
    setCommandSearching(false)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (commandOpen) {
          closeCommandPalette()
        } else {
          setCommandOpen(true)
        }
        return
      }
      if (event.key !== 'Escape') return
      if (commandOpen) {
        closeCommandPalette()
        return
      }
      if (showNotifications) {
        setShowNotifications(false)
        return
      }
      const openAccessMenus = document.querySelectorAll<HTMLDetailsElement>('.user-page-access[open]')
      if (openAccessMenus.length > 0) {
        openAccessMenus.forEach((menu) => { menu.open = false })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeCommandPalette, commandOpen, showNotifications])

  useEffect(() => {
    const trimmed = commandQuery.trim()
    if (!commandOpen || trimmed.length < 2) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCommandSearching(true)
      apiRequest<{ items: QuickSearchResultItem[] }>(`/api/home/quick-search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          if (!cancelled) setCommandResults(res.items)
        })
        .catch(() => {
          if (!cancelled) setCommandResults([])
        })
        .finally(() => {
          if (!cancelled) setCommandSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [commandOpen, commandQuery])

  const loadNotifications = useCallback(async () => {
    try {
      const result = await apiRequest<{ notifications: UserNotification[]; unreadCount: number }>('/api/team/notifications')
      setNotifications(result.notifications)
      setUnreadNotifications(result.unreadCount)
    } catch {
      // Silencia erros de background polling
    }
  }, [])

  const clearInitialTicket = useCallback(() => setInitialTicketId(null), [])
  const clearInitialProcess = useCallback(() => setInitialProcessId(null), [])
  const clearInitialCollaborator = useCallback(() => setInitialCollaboratorId(null), [])
  const clearInitialStockUnit = useCallback(() => setInitialStockUnitId(null), [])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadNotifications(), 0)
    const timer = window.setInterval(() => void loadNotifications(), 60_000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [loadNotifications])

  async function openNotification(notification: UserNotification) {
    try {
      await apiRequest(`/api/team/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'PATCH' })
      await loadNotifications()
      setShowNotifications(false)
      if ((notification.source === 'legal-process' || notification.process_id) && canAccessPage('legal-processes')) {
        setInitialProcessId(notification.process_id ?? null)
        openPage('legal-processes')
        return
      }
      if ((notification.source === 'stock-unit' || notification.stock_unit_id) && canAccessPage('stock-units')) {
        setInitialStockUnitId(notification.stock_unit_id ?? null)
        openPage('stock-units')
        return
      }
      if (notification.ticket_id && canAccessPage('tickets')) {
        setInitialTicketId(notification.ticket_id)
        openPage('tickets')
      }
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
      const [usersResult, logsResult] = await Promise.all([
        apiRequest<{ users: ManagedUser[] }>('/api/users'),
        apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs').catch(() => ({ logs: [] })),
      ])
      setUsers(usersResult.users)
      setAuditLogs(logsResult.logs)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar usuários.' })
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (user.role !== 'admin') return
    let cancelled = false
    Promise.all([
      apiRequest<{ users: ManagedUser[] }>('/api/users'),
      apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs').catch(() => ({ logs: [] })),
    ])
      .then(([usersResult, logsResult]) => {
        if (!cancelled) {
          setUsers(usersResult.users)
          setAuditLogs(logsResult.logs)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar usuários.' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.role])

  useEffect(() => {
    localStorage.setItem('atech.sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem('atech.sidebar-open-menus', JSON.stringify(openMenus))
    } catch {
      // Ignora erro se localStorage indisponível
    }
  }, [openMenus])

  useEffect(() => {
    const chamadosPages: AdminPage[] = ['tickets', 'letter-filling']
    const administracaoPages: AdminPage[] = ['schedule', 'collaborators', 'inventory', 'stock-units', 'warranties', 'information']
    const configuracoesPages: AdminPage[] = ['api-validation', 'work-calendar', 'accesses', 'logs']

    if (chamadosPages.includes(page as AdminPage)) {
      setOpenMenus((prev) => prev.chamados ? prev : { ...prev, chamados: true })
    } else if (administracaoPages.includes(page as AdminPage)) {
      setOpenMenus((prev) => prev.administracao ? prev : { ...prev, administracao: true })
    } else if (configuracoesPages.includes(page as AdminPage)) {
      setOpenMenus((prev) => prev.configuracoes ? prev : { ...prev, configuracoes: true })
    }
    setMobileMenuOpen(false)
  }, [page])

  const toggleSubmenu = (menuKey: 'chamados' | 'administracao' | 'configuracoes') => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      setOpenMenus((prev) => ({ ...prev, [menuKey]: true }))
    } else {
      setOpenMenus((prev) => ({ ...prev, [menuKey]: !prev[menuKey] }))
    }
  }

  const navigateToPage = (newPage: AppPage) => {
    setPage(newPage)
    setMobileMenuOpen(false)
  }

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
      const logsResult = await apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs').catch(() => null)
      if (logsResult) setAuditLogs(logsResult.logs)
      setNotice({ kind: 'success', text: `Acesso à página ${enabled ? 'liberado' : 'removido'} para ${member.displayName}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o acesso à página.' })
    }
  }

  async function changeRole(member: ManagedUser, nextRole: UserRole) {
    if (member.role === nextRole) return
    const actionLabel = nextRole === 'admin'
      ? `conceder permissão de ADMINISTRADOR para ${member.displayName} (${member.email})?\nO usuário terá acesso irrestrito a todas as áreas do sistema.`
      : `alterar a permissão de ${member.displayName} (${member.email}) para EQUIPE TÉCNICA?`
    if (!window.confirm(`Deseja realmente ${actionLabel}`)) {
      return
    }
    setNotice(null)
    try {
      await apiRequest(`/api/users/${member.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      })
      await loadUsers()
      setNotice({
        kind: 'success',
        text: `Permissão de ${member.displayName} alterada para ${nextRole === 'admin' ? 'Administrador' : 'Equipe técnica'}.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível atualizar a permissão do usuário.',
      })
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
      const logsResult = await apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs').catch(() => null)
      if (logsResult) setAuditLogs(logsResult.logs)
      setNotice({ kind: 'success', text: `Visualização de outros quadros ${enabled ? 'liberada' : 'removida'} para ${member.displayName}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar a permissão dos quadros.' })
    }
  }

  async function resetSignaturePin(member: ManagedUser) {
    const confirmed = window.confirm(
      `Deseja realmente resetar o PIN e descartar a assinatura de ${member.displayName} (${member.email})?\n\n` +
      `Esta ação descartará a assinatura cadastrada e apagará o PIN de segurança. O colaborador terá que cadastrar uma nova assinatura e definir um novo PIN no próximo uso.`
    )
    if (!confirmed) return

    setNotice(null)
    try {
      await apiRequest(`/api/users/${member.id}/reset-signature-pin`, { method: 'POST' })
      setNotice({
        kind: 'success',
        text: `PIN e assinatura de ${member.displayName} foram resetados com sucesso.`,
      })
      await loadUsers()
      const logsResult = await apiRequest<{ logs: AuditLogEntry[] }>('/api/users/audit-logs').catch(() => null)
      if (logsResult) setAuditLogs(logsResult.logs)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível resetar o PIN e a assinatura.',
      })
    }
  }

  function handleSelectQuickSearchItem(item: QuickSearchResultItem) {
    closeCommandPalette()
    if (item.kind === 'ticket' && canAccessPage('tickets')) {
      setInitialTicketId(item.id)
      openPage('tickets')
    } else if (item.kind === 'legal-process' && canAccessPage('legal-processes')) {
      setInitialProcessId(item.id)
      openPage('legal-processes')
    } else if (item.kind === 'collaborator' && canAccessPage('collaborators')) {
      setInitialCollaboratorId(item.id)
      openPage('collaborators')
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
    information: 'Informações de empreendimentos',
    accesses: 'Acessos',
    'api-validation': 'Validação da API',
    warranties: 'Prazos de garantia',
    'legal-processes': 'Processos Jurídicos',
    'personal-activities': 'Minhas atividades',
    inventory: 'Gestão de estoque',
    'stock-units': 'Unidades em estoque',
    logs: 'Auditoria & Logs',
    'work-calendar': 'Expediente e Calendário',
  }
  const currentTitle = page === 'not-found'
    ? 'Página não encontrada'
    : isForbidden
      ? 'Acesso restrito'
      : page === 'tickets' && ticketView === 'dashboard'
        ? 'Dashboard de chamados'
        : page === 'legal-processes' && legalView === 'dashboard'
          ? 'Dashboard Jurídico'
          : pageTitles[page]

  const allNavigablePages: { key: AdminPage; label: string; view?: 'kanban' | 'list' | 'dashboard' | 'board' }[] = [
    ...availablePages,
    ...(canAccessPage('tickets')
      ? [{ key: 'tickets' as const, label: 'Dashboard de chamados', view: 'dashboard' as const }]
      : []),
    ...(canAccessPage('legal-processes')
      ? [{ key: 'legal-processes' as const, label: 'Dashboard Jurídico', view: 'dashboard' as const }]
      : []),
    ...(user.role === 'admin'
      ? [
          { key: 'api-validation' as const, label: 'Validação API' },
          { key: 'work-calendar' as const, label: 'Expediente e Calendário' },
          { key: 'accesses' as const, label: 'Acessos e Configurações' },
          { key: 'logs' as const, label: 'Auditoria & Logs' },
        ]
      : []),
  ].filter((entry) => canAccessPage(entry.key))

  const matchingNavPages = commandQuery.trim()
    ? allNavigablePages.filter((entry) => entry.label.toLowerCase().includes(commandQuery.trim().toLowerCase()))
    : allNavigablePages

  const hasChamadosAccess = canAccessPage('tickets') || canAccessPage('letter-filling')
  const isChamadosActive = page === 'tickets' || page === 'letter-filling'

  const hasAdminGroupAccess = canAccessPage('schedule') || canAccessPage('collaborators') || canAccessPage('stock-units') || canAccessPage('inventory') || canAccessPage('warranties') || canAccessPage('information')
  const isAdminGroupActive = (['schedule', 'collaborators', 'inventory', 'stock-units', 'warranties', 'information'] as AdminPage[]).includes(page as AdminPage)

  const hasConfigAccess = canAccessPage('api-validation') || canAccessPage('work-calendar') || canAccessPage('accesses') || canAccessPage('logs')
  const isConfigActive = (['api-validation', 'work-calendar', 'accesses', 'logs'] as AdminPage[]).includes(page as AdminPage)

  return (
    <main className={`workspace-shell ${sidebarCollapsed && !mobileMenuOpen ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed && !mobileMenuOpen ? 'sidebar-is-collapsed' : ''} ${mobileMenuOpen ? 'mobile-sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <Brand />
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="mobile-sidebar-close"
            type="button"
            aria-label="Fechar menu lateral"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="sidebar-label nav-label">MENU PRINCIPAL</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {/* 1. Início */}
          {canAccessPage('home') && (
            <button
              type="button"
              title="Início"
              aria-label="Ir para início"
              className={`nav-item ${page === 'home' ? 'nav-item-active' : ''}`}
              onClick={() => navigateToPage('home')}
            >
              <LayoutDashboard size={17} />
              <span>Início</span>
            </button>
          )}

          {/* 2. Minhas atividades */}
          {canAccessPage('personal-activities') && (
            <button
              type="button"
              title="Minhas atividades"
              aria-label="Ir para minhas atividades"
              className={`nav-item ${page === 'personal-activities' ? 'nav-item-active' : ''}`}
              onClick={() => navigateToPage('personal-activities')}
            >
              <ListTodo size={17} />
              <span>Minhas atividades</span>
            </button>
          )}

          {/* 3. Chamados (Submenu) */}
          {hasChamadosAccess && (
            <div className="nav-group">
              <button
                type="button"
                className={`nav-group-header ${isChamadosActive ? 'nav-group-active' : ''}`}
                onClick={() => toggleSubmenu('chamados')}
                title="Chamados"
                aria-expanded={openMenus.chamados}
              >
                <ClipboardList size={17} />
                <span className="nav-group-label">Chamados</span>
                <span className="nav-group-chevron">
                  {openMenus.chamados ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>
              {openMenus.chamados && (
                <div className="nav-subitems">
                  {canAccessPage('tickets') && (
                    <button
                      type="button"
                      title="Chamados"
                      aria-label="Ir para chamados"
                      className={`nav-item nav-subitem ${page === 'tickets' ? 'nav-item-active' : ''}`}
                      onClick={() => {
                        navigateToPage('tickets')
                        if (ticketView === 'dashboard') {
                          window.dispatchEvent(new CustomEvent('atech:ticket-view-navigate', { detail: { view: 'kanban' } }))
                        }
                      }}
                    >
                      <ClipboardList size={15} />
                      <span>Chamados</span>
                    </button>
                  )}
                  {canAccessPage('letter-filling') && (
                    <button
                      type="button"
                      title="Preenchimento de cartas"
                      aria-label="Ir para preenchimento de cartas"
                      className={`nav-item nav-subitem ${page === 'letter-filling' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('letter-filling')}
                    >
                      <FileText size={15} />
                      <span>Preenchimento de Cartas</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Processos Jurídicos */}
          {canAccessPage('legal-processes') && (
            <button
              type="button"
              title="Processos Jurídicos"
              aria-label="Ir para processos jurídicos"
              className={`nav-item ${page === 'legal-processes' ? 'nav-item-active' : ''}`}
              onClick={() => {
                navigateToPage('legal-processes')
                if (legalView === 'dashboard') {
                  window.dispatchEvent(new CustomEvent('atech:legal-view-navigate', { detail: { view: 'board' } }))
                }
              }}
            >
              <BriefcaseBusiness size={17} />
              <span>Processos Jurídicos</span>
            </button>
          )}

          {/* 5. Administração (Submenu) */}
          {hasAdminGroupAccess && (
            <div className="nav-group">
              <button
                type="button"
                className={`nav-group-header ${isAdminGroupActive ? 'nav-group-active' : ''}`}
                onClick={() => toggleSubmenu('administracao')}
                title="Administração"
                aria-expanded={openMenus.administracao}
              >
                <Briefcase size={17} />
                <span className="nav-group-label">Administração</span>
                <span className="nav-group-chevron">
                  {openMenus.administracao ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>
              {openMenus.administracao && (
                <div className="nav-subitems">
                  {canAccessPage('schedule') && (
                    <button
                      type="button"
                      title="Programação"
                      aria-label="Ir para programação"
                      className={`nav-item nav-subitem ${page === 'schedule' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('schedule')}
                    >
                      <CalendarDays size={15} />
                      <span>Programação</span>
                    </button>
                  )}
                  {canAccessPage('collaborators') && (
                    <button
                      type="button"
                      title="Colaboradores"
                      aria-label="Ir para colaboradores"
                      className={`nav-item nav-subitem ${page === 'collaborators' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('collaborators')}
                    >
                      <ContactRound size={15} />
                      <span>Colaboradores</span>
                    </button>
                  )}
                  {canAccessPage('stock-units') && (
                    <button
                      type="button"
                      title="Unidades em estoque"
                      aria-label="Ir para unidades em estoque"
                      className={`nav-item nav-subitem ${page === 'stock-units' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('stock-units')}
                    >
                      <Building2 size={15} />
                      <span>Unidades em estoque</span>
                    </button>
                  )}
                  {canAccessPage('inventory') && (
                    <button
                      type="button"
                      title="Estoque"
                      aria-label="Ir para estoque"
                      className={`nav-item nav-subitem ${page === 'inventory' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('inventory')}
                    >
                      <Package size={15} />
                      <span>Estoque</span>
                    </button>
                  )}
                  {canAccessPage('warranties') && (
                    <button
                      type="button"
                      title="Garantias"
                      aria-label="Ir para garantias"
                      className={`nav-item nav-subitem ${page === 'warranties' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('warranties')}
                    >
                      <ShieldCheck size={15} />
                      <span>Garantias</span>
                    </button>
                  )}
                  {canAccessPage('information') && (
                    <button
                      type="button"
                      title="Informações de empreendimentos"
                      aria-label="Ir para informações de empreendimentos"
                      className={`nav-item nav-subitem ${page === 'information' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('information')}
                    >
                      <Info size={15} />
                      <span>Informações de empreendimentos</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 6. Configurações (Submenu) */}
          {hasConfigAccess && (
            <div className="nav-group">
              <button
                type="button"
                className={`nav-group-header ${isConfigActive ? 'nav-group-active' : ''}`}
                onClick={() => toggleSubmenu('configuracoes')}
                title="Configurações"
                aria-expanded={openMenus.configuracoes}
              >
                <Settings size={17} />
                <span className="nav-group-label">Configurações</span>
                <span className="nav-group-chevron">
                  {openMenus.configuracoes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>
              {openMenus.configuracoes && (
                <div className="nav-subitems">
                  {canAccessPage('api-validation') && (
                    <button
                      type="button"
                      title="Validação API"
                      aria-label="Ir para validação da API"
                      className={`nav-item nav-subitem ${page === 'api-validation' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('api-validation')}
                    >
                      <Zap size={15} />
                      <span>Validação API</span>
                    </button>
                  )}
                  {canAccessPage('work-calendar') && (
                    <button
                      type="button"
                      title="Expediente"
                      aria-label="Ir para expediente"
                      className={`nav-item nav-subitem ${page === 'work-calendar' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('work-calendar')}
                    >
                      <CalendarClock size={15} />
                      <span>Expediente</span>
                    </button>
                  )}
                  {canAccessPage('accesses') && (
                    <button
                      type="button"
                      title="Acessos"
                      aria-label="Ir para acessos"
                      className={`nav-item nav-subitem ${page === 'accesses' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('accesses')}
                    >
                      <UsersRound size={15} />
                      <span>Acessos</span>
                    </button>
                  )}
                  {canAccessPage('logs') && (
                    <button
                      type="button"
                      title="Auditoria & Logs"
                      aria-label="Ir para auditoria e logs"
                      className={`nav-item nav-subitem ${page === 'logs' ? 'nav-item-active' : ''}`}
                      onClick={() => navigateToPage('logs')}
                    >
                      <History size={15} />
                      <span>Auditoria & Logs</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-security"><ShieldCheck size={16} /><span><strong>Acesso protegido</strong><small>Domínio @{domain}</small></span></div>
          <button
            className="sidebar-version-pill-btn"
            type="button"
            onClick={() => setShowVersionModal(true)}
            title={`Versão ${APP_CURRENT_VERSION} · Clique para ver o histórico e notas de atualização`}
          >
            <span className="sidebar-version-badge">{APP_CURRENT_VERSION}</span>
            <span className="sidebar-version-text">Notas de versão</span>
          </button>
          <button className="profile-row" type="button" onClick={() => setShowProfile(true)} title="Editar perfil"><span className="profile-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="profile-info"><strong>{user.displayName}</strong><small>Editar perfil e assinatura</small></span><Pencil size={15} /></button>
        </div>
      </aside>
      {mobileMenuOpen && (
        <div
          className="mobile-sidebar-backdrop is-active"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <section className="workspace-main" id="usuarios">
        <header className="topbar">
          <div className="topbar-left">
            <div className="breadcrumbs">
              <span className="breadcrumb-root">Espaço de trabalho</span>
              <span className="breadcrumb-separator">/</span>
              <strong>{currentTitle}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="topbar-search-trigger"
              onClick={() => setCommandOpen(true)}
              title="Busca rápida global (Ctrl + K)"
            >
              <Search size={14} />
              <span>Buscar chamado, processo ou página...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="live-indicator"><i /> Sistema operacional</span>
            <span className="topbar-divider" />
            <div className="notification-center">
              <button
                className="notification-trigger"
                type="button"
                aria-label={`Notificações${unreadNotifications ? `, ${unreadNotifications} não lidas` : ''}`}
                aria-expanded={showNotifications}
                onClick={() => { setShowNotifications((value) => !value); void loadNotifications() }}
              >
                <Bell size={17} />
                {unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
              </button>
              {showNotifications && (
                <div className="notification-popover">
                  <header>
                    <div>
                      <strong>Notificações</strong>
                      <small>{unreadNotifications} não lidas</small>
                    </div>
                    {unreadNotifications > 0 && (
                      <button className="text-action-btn" type="button" onClick={() => void markAllNotificationsRead()}>
                        Marcar todas como lidas
                      </button>
                    )}
                  </header>
                  {notifications.length ? (
                    <ul>
                      {notifications.map((notification) => (
                        <li key={notification.id}>
                          <button
                            type="button"
                            className={notification.read_at ? '' : 'is-unread'}
                            onClick={() => void openNotification(notification)}
                          >
                            <strong>{notification.message}</strong>
                            <span>
                              {notification.source === 'legal-process'
                                ? `Jurídico · ${notification.protocol}`
                                : notification.source === 'stock-unit'
                                  ? `Estoque · ${notification.protocol}`
                                  : `#${notification.protocol}`}
                              {' · '}
                              {notification.actor_name}
                            </span>
                            <small>{formatDate(notification.created_at)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Você não tem notificações.</p>
                  )}
                </div>
              )}
            </div>
            <span className="topbar-admin">{user.role === 'admin' ? 'Administração' : 'Workspace'}</span>
          </div>
        </header>
        <div className={`page-content ${(page === 'tickets' && ticketView === 'kanban') || (page === 'legal-processes' && legalView === 'board') ? 'page-content-kanban' : ''}`}>
          <Suspense fallback={<ATechLoading message="Carregando página..." subtitle="Preparando ambiente de trabalho..." />}>
          {page === 'not-found' ? (
            <NotFoundPage onGoHome={() => openPage('home')} onGoTickets={() => openPage('tickets')} />
          ) : isForbidden ? (
            <NotFoundPage kind="forbidden" pageKey={page} onGoHome={() => openPage('home')} onGoTickets={() => openPage('tickets')} />
          ) : page === 'home' ? (
            <HomeDashboard
              user={user}
              users={users}
              loading={loading}
              pageAccess={pageAccess}
              onOpenCollaborators={() => openPage('collaborators')}
              onOpenPage={openPage}
            />
          ) : page === 'api-validation' && canAccessPage('api-validation') ? (
            <ApiValidationPage onGoToTickets={() => setPage('tickets')} />
          ) : page === 'tickets' && canAccessPage('tickets') ? (
            <TicketBoardPage
              canManageIntegration={user.role === 'admin'}
              onOpenValidation={user.role === 'admin' ? () => setPage('api-validation') : undefined}
              currentUser={{ id: user.id, role: user.role, displayName: user.displayName }}
              initialTicketId={initialTicketId}
              onTicketOpened={clearInitialTicket}
            />
          ) : page === 'letter-filling' && canAccessPage('letter-filling') ? (
            <TicketLetterPage />
          ) : page === 'schedule' && canAccessPage('schedule') ? (
            <ProgrammingPage isAdmin={user.role === 'admin'} />
          ) : page === 'collaborators' && canAccessPage('collaborators') ? (
            <CollaboratorsPage
              initialCollaboratorId={initialCollaboratorId}
              onCollaboratorOpened={clearInitialCollaborator}
            />
          ) : page === 'inventory' && canAccessPage('inventory') ? (
            <InventoryPage />
          ) : page === 'stock-units' && canAccessPage('stock-units') ? (
            <StockUnitsPage
              currentUser={user}
              initialUnitId={initialStockUnitId}
              onUnitOpened={clearInitialStockUnit}
            />
          ) : page === 'information' && canAccessPage('information') ? (
            <EnterpriseInformationPage />
          ) : page === 'warranties' && canAccessPage('warranties') ? (
            <WarrantyManagementPage />
          ) : page === 'legal-processes' && canAccessPage('legal-processes') ? (
            <LegalProcessesPage
              currentUser={{ id: user.id, role: user.role }}
              initialProcessId={initialProcessId}
              onProcessOpened={clearInitialProcess}
            />
          ) : page === 'personal-activities' && canAccessPage('personal-activities') ? (
            <PersonalActivitiesPage currentUser={user} canViewOtherActivities={canViewOtherPersonalActivities} />
          ) : page === 'work-calendar' && user.role === 'admin' ? (
            <CalendarManagementPage />
          ) : page === 'logs' && user.role === 'admin' ? (
            <AuditLogsPage />
          ) : page === 'accesses' ? (
            <>
          <div className="page-heading-row">
            <div>
              <div className="eyebrow page-eyebrow">CONFIGURAÇÕES E PERMISSÕES</div>
              <h1>Acessos e configurações gerais</h1>
              <p>Gerencie pessoas, permissões de acesso e personalize o filtro de contagem da página inicial.</p>
            </div>
            <span className="domain-badge"><ShieldCheck size={15} /> @{domain}</span>
          </div>
          {notice && <div className={`notice notice-${notice.kind}`} role="status"><span className="notice-symbol">{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

          <Suspense fallback={<div className="table-message">Carregando configurações...</div>}>
            <HomepageTicketsFilterSettings />
          </Suspense>

          <Suspense fallback={null}>
            <SessionTimeoutSettings />
          </Suspense>

          <Suspense fallback={null}>
            <WhatsAppSettings />
          </Suspense>

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
            <div className="user-table-wrap"><table className="user-table"><thead><tr><th>USUÁRIO</th><th>PERMISSÃO</th><th>PÁGINAS LIBERADAS</th><th>STATUS</th><th>ASSINATURA & PIN</th><th>ÚLTIMO ACESSO</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
              {loading ? <tr><td colSpan={7} className="table-message">Carregando usuários...</td></tr> : filteredUsers.length === 0 ? <tr><td colSpan={7} className="table-message">{users.length ? 'Nenhum resultado para esta busca.' : 'Ainda não há usuários cadastrados.'}</td></tr> : filteredUsers.map((member) => (
                <tr key={member.id}>
                  <td><div className="user-cell"><span className={`user-avatar ${member.role === 'admin' ? 'user-avatar-admin' : ''}`}>{member.displayName.slice(0, 1).toUpperCase()}</span><span className="user-identity"><strong>{member.displayName}{member.id === user.id && <span className="you-tag">VOCÊ</span>}</strong><small>{member.email}</small></span></div></td>
                  <td>
                    {member.id === user.id ? (
                      <span className={`role-label ${member.role === 'admin' ? 'role-admin' : ''}`}>
                        {member.role === 'admin' ? 'Administrador' : 'Equipe técnica'}
                      </span>
                    ) : (
                      <select
                        className={`role-select ${member.role === 'admin' ? 'role-select-admin' : ''}`}
                        value={member.role}
                        disabled={member.status === 'suspended'}
                        onChange={(event) => void changeRole(member, event.target.value as UserRole)}
                        title="Alterar permissão do usuário"
                        aria-label={`Permissão de ${member.displayName}`}
                      >
                        <option value="member">Equipe técnica</option>
                        <option value="admin">Administrador</option>
                      </select>
                    )}
                  </td>
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
                  <td>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {member.hasPin || member.hasSignature ? (
                        <>
                          <span
                            className={`status-pill ${member.isPinLocked ? 'status-suspended' : 'status-active'}`}
                            title={member.isPinLocked ? 'PIN bloqueado temporariamente por excesso de tentativas incorretas' : 'Assinatura e PIN configurados'}
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                          >
                            {member.isPinLocked ? <Lock size={12} /> : <KeyRound size={12} />}
                            {member.isPinLocked ? 'PIN Bloqueado' : 'Cadastrado'}
                          </span>
                          <button
                            type="button"
                            className="filter-clear-button"
                            style={{ fontSize: '11px', padding: '3px 8px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => void resetSignaturePin(member)}
                            title="Resetar PIN de segurança e descartar assinatura atual deste usuário"
                          >
                            <RotateCcw size={12} /> Resetar
                          </button>
                        </>
                      ) : (
                        <span className="status-pill status-pending" style={{ fontSize: '11px', padding: '2px 8px' }}>
                          Não configurado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="last-seen">{member.role === 'admin' ? 'Conta principal' : formatDate(member.lastLoginAt)}</td>
                  <td className="action-cell">
                    {member.id !== user.id && (
                      <button
                        className="row-action"
                        type="button"
                        onClick={() => void changeStatus(member)}
                        title={member.status === 'suspended' ? 'Reativar acesso' : 'Suspender acesso'}
                        aria-label={member.status === 'suspended' ? `Reativar ${member.email}` : `Suspender ${member.email}`}
                      >
                        <span className="sr-only">{member.status === 'suspended' ? 'Reativar' : 'Suspender'}</span>
                        {member.status === 'suspended' ? <Check size={16} /> : <Ban size={16} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
            <div className="table-footer"><span><ShieldCheck size={14} /> A autenticação da equipe exige Google Workspace e convite ativo.</span><button className="refresh-button" type="button" onClick={() => void loadUsers()}>Atualizar lista <ArrowUpRight size={14} /></button></div>
          </section>

          {auditLogs.length > 0 && (
            <section className="directory-section audit-log-section" aria-labelledby="audit-log-heading">
              <div className="directory-heading">
                <div>
                  <h2 id="audit-log-heading"><History size={16} /> Trilha de auditoria recente</h2>
                  <p>Registro automático de alterações de permissões, configurações globais e exclusões críticas.</p>
                </div>
              </div>
              <div className="audit-log-list">
                {auditLogs.slice(0, 15).map((log) => (
                  <div className="audit-log-item" key={log.id}>
                    <div className="audit-log-main">
                      <strong>{log.summary}</strong>
                      <small>Por {log.actorName || 'Sistema'} · {log.resourceType}</small>
                    </div>
                    <time className="audit-log-time">{formatDateTime(log.createdAt)}</time>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="workspace-footer">
            <span>
              AC Engenharia · ATech ·{' '}
              <button
                type="button"
                className="footer-version-btn"
                onClick={() => setShowVersionModal(true)}
                title="Ver histórico de versões e notas de lançamento"
              >
                {APP_CURRENT_VERSION}
              </button>
              <button
                type="button"
                className="version-badge-button"
                style={{ marginLeft: 6 }}
                onClick={() => setShowPrivacyModal(true)}
                title="Política de Privacidade & Proteção de Dados (LGPD)"
              >
                Privacidade LGPD
              </button>
            </span>
            <span>Controle de administradores <i /> Domínio verificado</span>
          </footer>
            </>
          ) : (
            <FutureModulePage page={page} />
          )}
          </Suspense>
        </div>

        {/* Barra de navegação inferior fixa para telas mobile (Thumb zone ergonomia) */}
        <nav className="mobile-bottom-nav" aria-label="Navegação rápida">
          {canAccessPage('home') && (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'home' ? 'is-active' : ''}`}
              onClick={() => navigateToPage('home')}
            >
              <LayoutDashboard size={19} />
              <span>Início</span>
            </button>
          )}
          {canAccessPage('tickets') && (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'tickets' ? 'is-active' : ''}`}
              onClick={() => {
                navigateToPage('tickets')
                if (ticketView === 'dashboard') {
                  window.dispatchEvent(new CustomEvent('atech:ticket-view-navigate', { detail: { view: 'kanban' } }))
                }
              }}
            >
              <ClipboardList size={19} />
              <span>Chamados</span>
            </button>
          )}
          {canAccessPage('schedule') && (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'schedule' ? 'is-active' : ''}`}
              onClick={() => navigateToPage('schedule')}
            >
              <CalendarDays size={19} />
              <span>Programação</span>
            </button>
          )}
          {canAccessPage('legal-processes') ? (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'legal-processes' ? 'is-active' : ''}`}
              onClick={() => {
                navigateToPage('legal-processes')
                if (legalView === 'dashboard') {
                  window.dispatchEvent(new CustomEvent('atech:legal-view-navigate', { detail: { view: 'board' } }))
                }
              }}
            >
              <BriefcaseBusiness size={19} />
              <span>Jurídico</span>
            </button>
          ) : canAccessPage('inventory') ? (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'inventory' ? 'is-active' : ''}`}
              onClick={() => navigateToPage('inventory')}
            >
              <Package size={19} />
              <span>Estoque</span>
            </button>
          ) : canAccessPage('personal-activities') ? (
            <button
              type="button"
              className={`mobile-bottom-nav-item ${page === 'personal-activities' ? 'is-active' : ''}`}
              onClick={() => navigateToPage('personal-activities')}
            >
              <ListTodo size={19} />
              <span>Atividades</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`mobile-bottom-nav-item ${mobileMenuOpen ? 'is-active' : ''}`}
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Abrir menu de navegação completo"
          >
            <div className="mobile-bottom-nav-icon-wrap">
              <Menu size={19} />
              {unreadNotifications > 0 && <span className="mobile-bottom-nav-badge" />}
            </div>
            <span>Menu</span>
          </button>
        </nav>
      </section>

      {commandOpen && (
        <div className="command-palette-backdrop" role="dialog" aria-modal="true" aria-label="Busca rápida global" onClick={closeCommandPalette}>
          <div className="command-palette-modal" onClick={(event) => event.stopPropagation()}>
            <header className="command-palette-header">
              <Search size={17} />
              <input
                type="search"
                autoFocus
                value={commandQuery}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setCommandQuery(nextValue)
                  if (nextValue.trim().length < 2) {
                    setCommandResults([])
                    setCommandSearching(false)
                  }
                }}
                placeholder="Buscar chamado (#protocolo, obra), processo jurídico (CNJ, parte), colaborador ou página..."
                aria-label="Pesquisar no sistema"
              />
              <button type="button" className="command-palette-close" onClick={closeCommandPalette}>ESC</button>
            </header>
            <div className="command-palette-body">
              {commandSearching && <p className="command-palette-hint">Buscando registros...</p>}
              {commandResults.length > 0 && (
                <div className="command-palette-group">
                  <span className="command-palette-group-title">REGISTROS ENCONTRADOS</span>
                  {commandResults.map((item) => (
                    <button
                      type="button"
                      key={`${item.kind}-${item.id}`}
                      className="command-palette-item"
                      onClick={() => handleSelectQuickSearchItem(item)}
                    >
                      <span className={`command-palette-badge is-${item.kind}`}>
                        {item.kind === 'ticket' ? 'Chamado' : item.kind === 'legal-process' ? 'Jurídico' : 'Colaborador'}
                      </span>
                      <div className="command-palette-item-copy">
                        <strong>{item.title}</strong>
                        {item.subtitle && <small>{item.subtitle}</small>}
                      </div>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              {matchingNavPages.length > 0 && (
                <div className="command-palette-group">
                  <span className="command-palette-group-title">NAVEGAÇÃO RÁPIDA</span>
                  {matchingNavPages.map((entry) => (
                    <button
                      type="button"
                      key={`${entry.key}-${entry.view || 'default'}`}
                      className="command-palette-item"
                      onClick={() => {
                        closeCommandPalette()
                        openPage(entry.key)
                        if (entry.view) {
                          if (entry.key === 'tickets') {
                            window.dispatchEvent(new CustomEvent('atech:ticket-view-navigate', { detail: { view: entry.view } }))
                          } else if (entry.key === 'legal-processes') {
                            window.dispatchEvent(new CustomEvent('atech:legal-view-navigate', { detail: { view: entry.view } }))
                          }
                        }
                      }}
                    >
                      <span className="command-palette-badge is-page">Página</span>
                      <div className="command-palette-item-copy">
                        <strong>{entry.label}</strong>
                      </div>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              {!commandSearching && commandResults.length === 0 && matchingNavPages.length === 0 && (
                <p className="command-palette-hint">Nenhum resultado encontrado para “{commandQuery}”.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showProfile && <Suspense fallback={null}><UserProfileModal onClose={() => setShowProfile(false)} onSaved={onUserUpdated} onSignOut={onSignOut} /></Suspense>}
      {showVersionModal && (
        <Suspense fallback={null}>
          <VersionHistoryModal onClose={() => setShowVersionModal(false)} />
        </Suspense>
      )}
      {showPrivacyModal && (
        <Suspense fallback={null}>
          <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} />
        </Suspense>
      )}
    </main>
  )
}

function FutureModulePage({ page }: { page: AdminPage }) {
  const module = {
    tickets: { title: 'Chamados', description: 'Atendimentos técnicos e solicitações em um só lugar.', icon: ClipboardList },
    'letter-filling': { title: 'Preenchimento de cartas', description: 'Geração de notificações e termos a partir dos chamados.', icon: FileText },
    schedule: { title: 'Programação', description: 'Agenda de serviços e atividades da equipe.', icon: CalendarDays },
    information: { title: 'Informações de empreendimentos', description: 'Dados cadastrais, síndicos e habite-se de empreendimentos.', icon: Info },
    accesses: { title: 'Acessos', description: 'Contas administrativas e convites.', icon: UsersRound },
    'api-validation': { title: 'Validação da API', description: 'Painel de testes e controle da API CVCRM.', icon: Zap },
    warranties: { title: 'Prazos de garantia', description: 'Gestão dos prazos de garantia por subassunto.', icon: ShieldCheck },
    'legal-processes': { title: 'Processos Jurídicos', description: 'Gestão de processos, fases, responsáveis e pagamentos.', icon: BriefcaseBusiness },
    'personal-activities': { title: 'Minhas atividades', description: 'Seu quadro privado para organizar atividades.', icon: ListTodo },
    home: { title: 'Início', description: '', icon: LayoutDashboard },
    collaborators: { title: 'Colaboradores', description: '', icon: ContactRound },
    inventory: { title: 'Gestão de estoque', description: 'Insumos, movimentações, EPIs e ferramentas.', icon: Package },
    'stock-units': { title: 'Unidades em estoque', description: 'Controle de vistorias e unidades não vendidas via CV CRM.', icon: Building2 },
    logs: { title: 'Auditoria & Logs', description: 'Trilha de auditoria e segurança do sistema.', icon: History },
    'work-calendar': { title: 'Expediente e Calendário', description: 'Feriados, sábados trabalhados e jornada da assistência técnica.', icon: CalendarClock },
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
