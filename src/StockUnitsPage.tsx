import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock,
  Eye,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './StockUnitsPage.css'

export interface StockUnit {
  id: number
  enterpriseId: number
  enterpriseName: string
  unitId: number
  unitName: string
  blockId: number | null
  blockName: string | null
  stageName: string | null
  floor: string | null
  typology: string | null
  position: string | null
  privateArea: number | null
  statusId: number | null
  statusName: string
  statusReason: string | null
  isDelivered?: boolean
  enterpriseStatus?: string | null
  enterpriseDeliveryDate?: string | null
  nextInspectionDate: string | null
  lastInspectionDate: string | null
  lastInspectionStatus: string | null
  lastInspectionTechnician: string | null
  syncedAt: string
  inspectionsCount: number
}

export interface EnterpriseSummary {
  enterpriseId: number
  enterpriseName: string
  isDelivered?: boolean
  enterpriseStatus?: string | null
  enterpriseDeliveryDate?: string | null
  totalUnits: number
  scheduledInspections: number
  inspectedUnits: number
  unitsWithIssues: number
  overdueInspections?: number
  withoutInspections?: number
}

export interface StockSummary {
  total_in_stock: number
  total_delivered: number
  total_scheduled: number
  total_overdue: number
  total_inspected: number
  total_with_issues: number
  total_without_inspection: number
  last_sync: string | null
}

export interface InspectionPhoto {
  id: string
  itemKey: string
  fileName: string
  fileSize: number
  contentType: string
}

export interface InspectionItemResult {
  key: string
  name: string
  status: 'approved' | 'reproved'
  observation: string | null
  photosCount: number
}

export interface UnitInspection {
  id: string
  inspectionDate: string
  technicianId: number | null
  technicianName: string
  collaboratorId: number | null
  collaboratorName: string | null
  overallStatus: 'approved' | 'has_issues'
  approvedCount: number
  reprovedCount: number
  items: InspectionItemResult[]
  generalNotes: string | null
  createdAt: string
  photos: InspectionPhoto[]
}

const INSPECTION_ITEMS_CATALOG = [
  { key: 'esquadrias_madeira', name: 'Esquadrias de madeira' },
  { key: 'esquadrias_aluminio', name: 'Esquadrias de aluminio' },
  { key: 'pisos_revestimentos', name: 'Pisos e Revestimentos' },
  { key: 'metais', name: 'Metais' },
  { key: 'loucas', name: 'Louças' },
  { key: 'pedras_granitos', name: 'Pedras e Granitos' },
  { key: 'eletrica', name: 'Elétrica' },
  { key: 'hidraulica', name: 'Hidráulica' },
] as const

interface FormItemState {
  key: string
  name: string
  status: 'approved' | 'reproved'
  observation: string
  photos: Array<{
    fileName: string
    contentType: string
    dataUrl: string
  }>
}

interface StockUnitsPageProps {
  currentUser: {
    id: number
    displayName: string
    role: string
  }
  initialUnitId?: string | null
  onUnitOpened?: () => void
}

function formatDateBr(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const parts = isoDate.slice(0, 10).split('-')
  if (parts.length !== 3) return isoDate
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

// Comprime e redimensiona imagens no cliente (máx 1280px, JPEG 0.76) para economizar RAM, rede e banco
async function compressInspectionImage(file: File): Promise<{
  fileName: string
  contentType: string
  dataUrl: string
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const MAX_DIM = 1280
        let { width, height } = img
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width >= height) {
            height = Math.round((height * MAX_DIM) / width)
            width = MAX_DIM
          } else {
            width = Math.round((width * MAX_DIM) / height)
            height = MAX_DIM
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(objectUrl)
          reject(new Error('Canvas indisponível'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.76)
        URL.revokeObjectURL(objectUrl)
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'foto'
        resolve({
          fileName: `${baseName}.jpg`,
          contentType: 'image/jpeg',
          dataUrl,
        })
      } catch (err) {
        URL.revokeObjectURL(objectUrl)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Falha ao processar imagem'))
    }
    img.src = objectUrl
  })
}

function readUnitIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('unitId')
}

export default function StockUnitsPage({ currentUser, initialUnitId, onUnitOpened }: StockUnitsPageProps) {
  const [units, setUnits] = useState<StockUnit[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([])
  const [summary, setSummary] = useState<StockSummary>({
    total_in_stock: 0,
    total_delivered: 0,
    total_scheduled: 0,
    total_overdue: 0,
    total_inspected: 0,
    total_with_issues: 0,
    total_without_inspection: 0,
    last_sync: null,
  })

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  // Filtro de seleção múltipla de obras
  const [selectedEnterpriseIds, setSelectedEnterpriseIds] = useState<number[]>([])
  const [onlyDelivered, setOnlyDelivered] = useState(false)
  const [enterpriseDropdownOpen, setEnterpriseDropdownOpen] = useState(false)
  const [enterpriseSearch, setEnterpriseSearch] = useState('')
  const enterpriseDropdownRef = useRef<HTMLDivElement>(null)

  // Filtros textuais e status (com debounce para busca textual)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [inspectionFilter, setInspectionFilter] = useState('')

  // Página / Ficha Detalhada da Unidade e Vistorias
  const [selectedUnit, setSelectedUnit] = useState<StockUnit | null>(null)
  const selectedUnitIdRef = useRef<number | null>(null)
  const [unitInspections, setUnitInspections] = useState<UnitInspection[]>([])
  const [expandedInspectionIds, setExpandedInspectionIds] = useState<Set<string>>(new Set())
  const [loadingUnitDetails, setLoadingUnitDetails] = useState(false)
  const [nextDateDraft, setNextDateDraft] = useState('')
  const [savingNextDate, setSavingNextDate] = useState(false)

  // Tela de Vistoria (Fullscreen)
  const [showInspectionModal, setShowInspectionModal] = useState(false)
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [technicianName, setTechnicianName] = useState(currentUser.displayName || '')
  const [formItems, setFormItems] = useState<FormItemState[]>(() =>
    INSPECTION_ITEMS_CATALOG.map((item) => ({
      key: item.key,
      name: item.name,
      status: 'approved',
      observation: '',
      photos: [],
    })),
  )
  const [generalNotes, setGeneralNotes] = useState('')
  const [savingInspection, setSavingInspection] = useState(false)
  const [inspectionFormError, setInspectionFormError] = useState('')

  // Modal de Visualização de Foto Ampliada (Lightbox)
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  // Fecha dropdown de obras ao clicar fora
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (enterpriseDropdownRef.current && !enterpriseDropdownRef.current.contains(e.target as Node)) {
        setEnterpriseDropdownOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const syncUrlWithUnit = useCallback((unitId: number | null, replace = false) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('page', 'stock-units')
    if (unitId !== null) {
      url.searchParams.set('unitId', String(unitId))
    } else {
      url.searchParams.delete('unitId')
    }
    const target = `${url.pathname}${url.search}${url.hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
      if (replace) {
        window.history.replaceState({ page: 'stock-units', unitId }, '', target)
      } else {
        window.history.pushState({ page: 'stock-units', unitId }, '', target)
      }
    }
  }, [])

  useEffect(() => {
    if (selectedUnit) {
      document.title = `Unidade ${selectedUnit.unitName} · ${selectedUnit.enterpriseName} | ATech`
    } else {
      document.title = 'Unidades em estoque | ATech'
    }
    return () => {
      document.title = 'ATech'
    }
  }, [selectedUnit])

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (selectedEnterpriseIds.length > 0) {
        params.set('enterpriseIds', selectedEnterpriseIds.join(','))
      }
      if (onlyDelivered) {
        params.set('onlyDelivered', 'true')
      }
      if (debouncedSearch) {
        params.set('search', debouncedSearch)
      }
      if (statusFilter) {
        params.set('status', statusFilter)
      }
      if (inspectionFilter) {
        params.set('inspectionStatus', inspectionFilter)
      }

      const res = await apiRequest<{
        enterprises: EnterpriseSummary[]
        units: StockUnit[]
        summary: StockSummary
      }>(`/api/stock-units?${params.toString()}`)

      setEnterprises(res.enterprises)
      setUnits(res.units)
      setSummary(res.summary)
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Não foi possível carregar as unidades em estoque.',
      })
    } finally {
      setLoading(false)
    }
  }, [selectedEnterpriseIds, onlyDelivered, debouncedSearch, statusFilter, inspectionFilter])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // Abre a página/ficha da unidade e vincula a URL
  const openUnitModal = useCallback(async (unitOrId: StockUnit | number, options?: { fromPopState?: boolean }) => {
    const unitId = typeof unitOrId === 'number' ? unitOrId : unitOrId.id
    selectedUnitIdRef.current = unitId
    if (typeof unitOrId !== 'number') {
      setSelectedUnit(unitOrId)
      setNextDateDraft(unitOrId.nextInspectionDate ? unitOrId.nextInspectionDate.slice(0, 10) : '')
    }
    if (!options?.fromPopState) {
      syncUrlWithUnit(unitId)
    }
    setLoadingUnitDetails(true)
    try {
      const res = await apiRequest<{ unit: StockUnit; inspections: UnitInspection[] }>(
        `/api/stock-units/${unitId}`,
      )
      if (selectedUnitIdRef.current !== unitId) return
      setSelectedUnit(res.unit)
      const list = res.inspections || []
      setUnitInspections(list)
      // Expande apenas o laudo mais recente por padrão para economizar DOM e carregamento de fotos
      setExpandedInspectionIds(list.length > 0 ? new Set([list[0].id]) : new Set())
      setNextDateDraft(res.unit.nextInspectionDate ? res.unit.nextInspectionDate.slice(0, 10) : '')
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Não foi possível carregar os dados da unidade.',
      })
      if (typeof unitOrId === 'number') {
        selectedUnitIdRef.current = null
        setSelectedUnit(null)
        syncUrlWithUnit(null, true)
      }
    } finally {
      if (selectedUnitIdRef.current === unitId) {
        setLoadingUnitDetails(false)
      }
    }
  }, [syncUrlWithUnit])

  const closeUnitModal = useCallback(() => {
    selectedUnitIdRef.current = null
    setSelectedUnit(null)
    setShowInspectionModal(false)
    setUnitInspections([])
    syncUrlWithUnit(null)
  }, [syncUrlWithUnit])

  // Sincroniza com botão Voltar/Avançar do navegador (popstate)
  useEffect(() => {
    function handlePopState() {
      const urlUnitId = readUnitIdFromUrl()
      if (urlUnitId) {
        const numericId = Number(urlUnitId)
        if (Number.isInteger(numericId) && numericId > 0 && selectedUnitIdRef.current !== numericId) {
          void openUnitModal(numericId, { fromPopState: true })
        }
      } else if (selectedUnitIdRef.current !== null) {
        selectedUnitIdRef.current = null
        setSelectedUnit(null)
        setShowInspectionModal(false)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [openUnitModal])

  useLiveSync(['stock-units'], () => {
    void loadData()
    if (selectedUnitIdRef.current) {
      void openUnitModal(selectedUnitIdRef.current, { fromPopState: true })
    }
  })

  // Sincronizar com CV CRM
  async function handleSyncCvcrm() {
    setSyncing(true)
    setNotice(null)
    try {
      const res = await apiRequest<{ message: string }>('/api/stock-units/sync', { method: 'POST' })
      setNotice({ kind: 'success', text: res.message || 'Sincronização com o CV CRM concluída com sucesso!' })
      await loadData()
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Falha na sincronização com o CV CRM.',
      })
    } finally {
      setSyncing(false)
    }
  }

  // Abre unidade se veio por notificação (initialUnitId) ou link direto na URL (?unitId=...)
  useEffect(() => {
    const targetId = initialUnitId || readUnitIdFromUrl()
    if (!targetId) return
    const numericId = Number(targetId)
    if (Number.isInteger(numericId) && numericId > 0 && selectedUnitIdRef.current !== numericId) {
      void openUnitModal(numericId, { fromPopState: !initialUnitId })
      if (initialUnitId) onUnitOpened?.()
    }
  }, [initialUnitId, openUnitModal, onUnitOpened])

  // Copiar link direto da unidade
  async function handleCopyUnitLink() {
    if (!selectedUnit) return
    const url = new URL(window.location.href)
    url.searchParams.set('page', 'stock-units')
    url.searchParams.set('unitId', String(selectedUnit.id))
    try {
      await navigator.clipboard.writeText(url.toString())
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2200)
    } catch {
      // Fallback silencioso
    }
  }

  function toggleInspectionExpand(inspectionId: string) {
    setExpandedInspectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(inspectionId)) {
        next.delete(inspectionId)
      } else {
        next.add(inspectionId)
      }
      return next
    })
  }

  // Salvar data da próxima vistoria
  async function handleSaveNextInspectionDate(e: FormEvent) {
    e.preventDefault()
    if (!selectedUnit) return
    setSavingNextDate(true)
    try {
      const nextVal = nextDateDraft || null
      await apiRequest(`/api/stock-units/${selectedUnit.id}/next-inspection`, {
        method: 'PATCH',
        body: JSON.stringify({ nextInspectionDate: nextVal }),
      })
      setSelectedUnit((curr) => (curr ? { ...curr, nextInspectionDate: nextVal } : null))
      setUnits((prev) => prev.map((u) => (u.id === selectedUnit.id ? { ...u, nextInspectionDate: nextVal } : u)))
      setNotice({ kind: 'success', text: 'Data da próxima vistoria periódica atualizada com sucesso!' })
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Não foi possível atualizar a data da próxima vistoria.',
      })
    } finally {
      setSavingNextDate(false)
    }
  }

  // Predefinição rápida para data da próxima vistoria
  function setNextDatePreset(days: number) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    setNextDateDraft(d.toISOString().slice(0, 10))
  }

  // Abre a tela de vistoria em fullscreen
  function handleStartNewInspection() {
    setInspectionDate(new Date().toISOString().slice(0, 10))
    setTechnicianName(currentUser.displayName || '')
    setFormItems(
      INSPECTION_ITEMS_CATALOG.map((item) => ({
        key: item.key,
        name: item.name,
        status: 'approved',
        observation: '',
        photos: [],
      })),
    )
    setGeneralNotes('')
    setInspectionFormError('')
    setShowInspectionModal(true)
  }

  // Alterna status Aprovado / Reprovado
  function toggleItemStatus(key: string, newStatus: 'approved' | 'reproved') {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        return {
          ...item,
          status: newStatus,
          observation: newStatus === 'approved' ? '' : item.observation,
          photos: newStatus === 'approved' ? [] : item.photos,
        }
      }),
    )
  }

  function handleItemObservationChange(key: string, text: string) {
    setFormItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, observation: text } : item)),
    )
  }

  // Upload de fotos com compressão automática no cliente para reduzir consumo de memória e rede
  async function handlePhotoUpload(key: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    const compressedList = await Promise.all(
      imageFiles.map((file) =>
        compressInspectionImage(file).catch(() => null),
      ),
    )
    const validPhotos = compressedList.filter(
      (p): p is NonNullable<typeof p> => p !== null,
    )
    if (validPhotos.length === 0) return

    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        return {
          ...item,
          photos: [...item.photos, ...validPhotos],
        }
      }),
    )
  }

  function handleRemovePhoto(key: string, photoIdx: number) {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        return {
          ...item,
          photos: item.photos.filter((_, idx) => idx !== photoIdx),
        }
      }),
    )
  }

  // Submissão do Laudo de Vistoria
  async function handleSubmitInspection(e: FormEvent) {
    e.preventDefault()
    if (!selectedUnit) return

    setInspectionFormError('')

    // Validações obrigatórias para itens reprovados
    for (const item of formItems) {
      if (item.status === 'reproved') {
        if (!item.observation.trim()) {
          setInspectionFormError(`O item "${item.name}" foi reprovado e necessita de uma observação explicativa.`)
          return
        }
        if (item.photos.length === 0) {
          setInspectionFormError(`O item "${item.name}" foi reprovado e exige o anexo de ao menos 1 foto comprobatória.`)
          return
        }
      }
    }

    setSavingInspection(true)
    try {
      const payload = {
        inspectionDate,
        technicianName: technicianName.trim(),
        generalNotes: generalNotes.trim() || undefined,
        items: formItems.map((item) => ({
          key: item.key,
          name: item.name,
          status: item.status,
          observation: item.status === 'reproved' ? item.observation.trim() : undefined,
          photos: item.status === 'reproved'
            ? item.photos.map((p) => ({
                fileName: p.fileName,
                contentType: p.contentType,
                contentBase64: p.dataUrl.split(',')[1] || p.dataUrl,
              }))
            : [],
        })),
      }

      await apiRequest(`/api/stock-units/${selectedUnit.id}/inspections`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      setShowInspectionModal(false)
      // Libera as fotos da memória do formulário imediatamente
      setFormItems((prev) => prev.map((it) => ({ ...it, photos: [], observation: '' })))
      setNotice({ kind: 'success', text: 'Laudo de vistoria técnica registrado com sucesso!' })
      await openUnitModal(selectedUnit, { fromPopState: true })
      void loadData()
    } catch (err) {
      setInspectionFormError(err instanceof Error ? err.message : 'Falha ao salvar vistoria.')
    } finally {
      setSavingInspection(false)
    }
  }

  // Excluir vistoria
  async function handleDeleteInspection(inspectionId: string) {
    if (!confirm('Deseja realmente excluir este laudo de vistoria?')) return
    try {
      await apiRequest(`/api/stock-units/inspections/${inspectionId}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Vistoria excluída com sucesso.' })
      if (selectedUnit) {
        await openUnitModal(selectedUnit)
      }
      await loadData()
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Não foi possível excluir a vistoria.',
      })
    }
  }

  // Manipulação de seleção múltipla de obras
  function toggleEnterpriseSelection(id: number) {
    setSelectedEnterpriseIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  function handleSelectAllEnterprises() {
    setSelectedEnterpriseIds([])
    setOnlyDelivered(false)
  }

  function handleSelectOnlyDelivered() {
    setOnlyDelivered((prev) => !prev)
  }

  // Lista filtrada de obras para o dropdown
  const filteredEnterpriseList = useMemo(() => {
    return enterprises.filter((e) =>
      e.enterpriseName.toLowerCase().includes(enterpriseSearch.toLowerCase().trim()),
    )
  }, [enterprises, enterpriseSearch])

  // Contadores vivos para a tela cheia de vistoria
  const approvedItemsCount = formItems.filter((i) => i.status === 'approved').length
  const reprovedItemsCount = formItems.filter((i) => i.status === 'reproved').length

  return (
    <div className="stock-units-page">
      {/* Cabeçalho */}
      <div className="stock-units-heading">
        <div>
          <span className="eyebrow">ASSISTÊNCIA TÉCNICA · GESTÃO DE ESTOQUE</span>
          <h1>Unidades em estoque</h1>
          <p>
            Acompanhamento de apartamentos não vendidos, vistorias técnicas periódicas e controle de conservação em obras entregues.
          </p>
        </div>

        <div className="stock-units-actions">
          {summary.last_sync && (
            <span className="stock-sync-meta">
              Última sincronização CV CRM:
              <br />
              <strong>{new Date(summary.last_sync).toLocaleString('pt-BR')}</strong>
            </span>
          )}
          {currentUser?.role === 'admin' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleSyncCvcrm()}
              disabled={syncing}
              title="Atualizar lista com o Construtor de Vendas"
            >
              <RefreshCw size={15} className={syncing ? 'is-spinning' : ''} />
              <span>{syncing ? 'Sincronizando...' : 'Sincronizar CV CRM'}</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="alert">
          <CircleAlert size={16} />
          {notice.text}
          <button type="button" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {selectedUnit ? (
        /* PÁGINA DEDICADA DA UNIDADE SELECIONADA (vinculada à URL ?page=stock-units&unitId=...) */
        <div className="stock-unit-page-view">
          <div className="stock-unit-page-topbar">
            <div className="stock-unit-page-breadcrumb">
              <button
                type="button"
                className="stock-fullscreen-back-btn"
                onClick={closeUnitModal}
                title="Voltar para a listagem de unidades em estoque"
              >
                <ArrowLeft size={16} />
                <span>Voltar ao estoque</span>
              </button>
              <span className="stock-breadcrumb-sep">/</span>
              <span className="stock-breadcrumb-item">{selectedUnit.enterpriseName}</span>
              <span className="stock-breadcrumb-sep">/</span>
              <strong className="stock-breadcrumb-current">
                Unidade {selectedUnit.unitName} ({selectedUnit.blockName || 'Bloco Único'})
              </strong>
            </div>

            <div className="stock-unit-page-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleCopyUnitLink()}
                title="Copiar link direto para esta unidade"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}
              >
                {linkCopied ? <Check size={15} style={{ color: '#16a34a' }} /> : <Link2 size={15} />}
                <span>{linkCopied ? 'Link copiado!' : 'Copiar link da unidade'}</span>
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleStartNewInspection}
                style={{ background: '#0f3b99', display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}
              >
                <ClipboardCheck size={16} />
                <span>Cadastrar Vistoria Técnica</span>
              </button>
            </div>
          </div>

          <div className="stock-unit-page-card">
            <div className="stock-modal-header">
              <div>
                <h2>
                  Unidade {selectedUnit.unitName} · {selectedUnit.blockName || 'Bloco Único'}
                </h2>
                <p>
                  {selectedUnit.enterpriseName} · {selectedUnit.isDelivered ? 'Obra Entregue' : 'Em Andamento'} · Situação no CV CRM: <strong>{selectedUnit.statusName}</strong>
                  {selectedUnit.statusReason ? ` (${selectedUnit.statusReason})` : ''}
                </p>
              </div>
              <span
                className={`stock-status-badge ${
                  selectedUnit.statusName.toLowerCase().includes('disp')
                    ? 'status-disponivel'
                    : selectedUnit.statusName.toLowerCase().includes('bloq')
                      ? 'status-bloqueada'
                      : 'status-reservada'
                }`}
              >
                {selectedUnit.statusName}
              </span>
            </div>

            <div className="stock-modal-body" style={{ overflowY: 'visible' }}>
              {/* Informações Técnicas da Unidade */}
              <div className="stock-specs-summary">
                <div><strong>Empreendimento:</strong> {selectedUnit.enterpriseName}</div>
                <div><strong>Bloco:</strong> {selectedUnit.blockName || 'Único'}</div>
                <div><strong>Tipologia:</strong> {selectedUnit.typology || 'Padrão'}</div>
                {selectedUnit.privateArea && <div><strong>Área Privativa:</strong> {selectedUnit.privateArea} m²</div>}
                {selectedUnit.floor && <div><strong>Andar:</strong> {selectedUnit.floor}</div>}
                {selectedUnit.position && <div><strong>Posição:</strong> {selectedUnit.position}</div>}
                <div>
                  <strong>Situação da Obra:</strong>{' '}
                  <span className={selectedUnit.isDelivered ? 'tag-delivered' : 'tag-progress'}>
                    {selectedUnit.isDelivered ? 'Obra Entregue / Concluída' : 'Em Andamento'}
                  </span>
                </div>
              </div>

              {/* Painel: Cadastro da Data da Próxima Vistoria */}
              <div className="stock-next-inspection-panel">
                <div>
                  <h4>Agendamento da Próxima Vistoria Periódica</h4>
                  <p>Defina o prazo limite para a próxima inspeção técnica periódica deste apartamento.</p>
                </div>
                <form className="stock-next-inspection-form" onSubmit={(e) => void handleSaveNextInspectionDate(e)}>
                  <input
                    type="date"
                    value={nextDateDraft}
                    onChange={(e) => setNextDateDraft(e.target.value)}
                    aria-label="Data da próxima vistoria"
                  />
                  <button type="submit" className="primary-button" disabled={savingNextDate}>
                    {savingNextDate ? 'Salvando...' : 'Salvar Data'}
                  </button>
                  {selectedUnit.nextInspectionDate && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setNextDateDraft('')
                        void apiRequest(`/api/stock-units/${selectedUnit.id}/next-inspection`, {
                          method: 'PATCH',
                          body: JSON.stringify({ nextInspectionDate: null }),
                        }).then(() => {
                          setSelectedUnit((curr) => (curr ? { ...curr, nextInspectionDate: null } : null))
                          setUnits((curr) =>
                            curr.map((u) => (u.id === selectedUnit.id ? { ...u, nextInspectionDate: null } : u)),
                          )
                        })
                      }}
                      title="Limpar agendamento"
                    >
                      Limpar
                    </button>
                  )}
                </form>

                {/* Predefinições Rápidas de Periodicidade */}
                <div className="stock-presets-row">
                  <span style={{ fontSize: 12, color: '#64748b' }}>Cadência rápida:</span>
                  <button type="button" className="stock-preset-btn" onClick={() => setNextDatePreset(30)}>
                    +30 dias (Mensal)
                  </button>
                  <button type="button" className="stock-preset-btn" onClick={() => setNextDatePreset(60)}>
                    +60 dias (Bimestral)
                  </button>
                  <button type="button" className="stock-preset-btn" onClick={() => setNextDatePreset(90)}>
                    +90 dias (Trimestral)
                  </button>
                </div>
              </div>

              {/* Seção: Histórico de Vistorias Realizadas */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                    Vistorias Técnicas Realizadas ({unitInspections.length})
                  </h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Clique em uma vistoria anterior para expandir os itens e carregar as fotos sob demanda.
                  </span>
                </div>
              </div>

              {loadingUnitDetails ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748b' }}>
                  Carregando histórico de vistorias...
                </div>
              ) : unitInspections.length === 0 ? (
                <div className="stock-empty-inspections">
                  <ClipboardCheck size={32} />
                  <p>Nenhuma vistoria técnica cadastrada para esta unidade até o momento.</p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleStartNewInspection}
                    style={{ marginTop: 8 }}
                  >
                    Iniciar Primeira Vistoria Técnica
                  </button>
                </div>
              ) : (
                <div className="stock-inspections-list">
                  {unitInspections.map((insp) => {
                    const isExpanded = expandedInspectionIds.has(insp.id)
                    return (
                      <div key={insp.id} className="stock-inspection-history-card">
                        <div
                          className="stock-inspection-history-header"
                          onClick={() => toggleInspectionExpand(insp.id)}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <div>
                              <div className="stock-inspection-tech-info">
                                <User size={15} />
                                Técnico: <strong>{insp.technicianName}</strong>
                                {insp.collaboratorName && (
                                  <span style={{ color: '#64748b', fontWeight: 400 }}>({insp.collaboratorName})</span>
                                )}
                              </div>
                              <span style={{ fontSize: 12, color: '#64748b' }}>
                                Data da realização: <strong>{formatDateBr(insp.inspectionDate)}</strong>
                                {insp.photos?.length ? ` · ${insp.photos.length} foto(s)` : ''}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} onClick={(e) => e.stopPropagation()}>
                            <span
                              className={`stock-unit-inspection-badge ${
                                insp.overallStatus === 'approved' ? 'approved' : 'has-issues'
                              }`}
                            >
                              {insp.overallStatus === 'approved' ? '100% Aprovado' : `${insp.reprovedCount} Reprovado(s)`}
                            </span>
                            <button
                              type="button"
                              className="stock-inspection-delete-btn"
                              onClick={() => void handleDeleteInspection(insp.id)}
                              title="Excluir laudo de vistoria"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <>
                            {insp.generalNotes && (
                              <div className="stock-inspection-notes">
                                <strong>Outros / Observações gerais:</strong> {insp.generalNotes}
                              </div>
                            )}

                            {/* Itens Avaliados na Vistoria */}
                            <div className="stock-inspection-items-grid">
                              {insp.items.map((item) => (
                                <div
                                  key={item.key}
                                  className={`stock-history-item-pill ${
                                    item.status === 'approved' ? 'is-approved' : 'is-reproved'
                                  }`}
                                  title={item.observation || undefined}
                                >
                                  <span>{item.name}</span>
                                  {item.status === 'approved' ? (
                                    <Check size={16} />
                                  ) : (
                                    <XCircle size={16} style={{ color: '#dc2626' }} />
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Galeria de Fotos da Vistoria (carregada apenas quando expandida) */}
                            {insp.photos && insp.photos.length > 0 && (
                              <div style={{ marginTop: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
                                  Fotos das não conformidades ({insp.photos.length}):
                                </span>
                                <div className="stock-photo-previews">
                                  {insp.photos.map((photo) => {
                                    const photoUrl = `/api/stock-units/inspections/${insp.id}/photos/${photo.id}`
                                    const itemName =
                                      INSPECTION_ITEMS_CATALOG.find((i) => i.key === photo.itemKey)?.name || photo.itemKey
                                    return (
                                      <div
                                        key={photo.id}
                                        className="stock-photo-thumb"
                                        onClick={() => setViewingPhotoUrl(photoUrl)}
                                        style={{ cursor: 'pointer' }}
                                        title={`Ver foto ampliada (${itemName})`}
                                      >
                                        <img src={photoUrl} alt={photo.fileName} loading="lazy" decoding="async" />
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs da Assistência Técnica */}
          <div className="stock-kpi-grid">
            <div className="stock-kpi-card">
              <div className="stock-kpi-icon icon-blue">
                <Building2 size={22} />
              </div>
              <div className="stock-kpi-info">
                <span className="stock-kpi-value">{summary.total_in_stock}</span>
                <span className="stock-kpi-label">
                  Total em estoque ({summary.total_delivered} em obras entregues)
                </span>
              </div>
            </div>

            <div className="stock-kpi-card">
              <div className="stock-kpi-icon icon-emerald">
                <CheckCircle2 size={22} />
              </div>
              <div className="stock-kpi-info">
                <span className="stock-kpi-value">{summary.total_inspected}</span>
                <span className="stock-kpi-label">Vistorias técnicas realizadas</span>
              </div>
            </div>

            <div className="stock-kpi-card">
              <div className="stock-kpi-icon icon-amber">
                <Clock size={22} />
              </div>
              <div className="stock-kpi-info">
                <span className="stock-kpi-value">{summary.total_without_inspection}</span>
                <span className="stock-kpi-label">
                  Sem vistoria periódica ({summary.total_overdue} com vistoria atrasada)
                </span>
              </div>
            </div>

            <div className="stock-kpi-card">
              <div className="stock-kpi-icon icon-rose">
                <AlertTriangle size={22} />
              </div>
              <div className="stock-kpi-info">
                <span className="stock-kpi-value">{summary.total_with_issues}</span>
                <span className="stock-kpi-label">Com pendências ou reprovações</span>
              </div>
            </div>
          </div>

          {/* Barra de Seleção de Obras */}
          <div className="stock-enterprise-selector-container">
            <div className="stock-enterprise-selector-row">
              {/* Seletor Múltiplo Dropdown */}
              <div className="stock-enterprise-dropdown-wrap" ref={enterpriseDropdownRef}>
                <button
                  type="button"
                  className={`stock-enterprise-filter-btn ${selectedEnterpriseIds.length > 0 ? 'is-active' : ''}`}
                  onClick={() => setEnterpriseDropdownOpen((prev) => !prev)}
                  aria-expanded={enterpriseDropdownOpen}
                >
                  <Building2 size={16} />
                  <span>
                    {selectedEnterpriseIds.length === 0
                      ? 'Todas as obras'
                      : `${selectedEnterpriseIds.length} obra(s) selecionada(s)`}
                  </span>
                  <ChevronDown size={14} />
                </button>

                {enterpriseDropdownOpen && (
                  <div className="stock-enterprise-popover">
                    <div className="stock-enterprise-popover-header">
                      <strong>Selecionar Obras para Visualizar</strong>
                      <div className="stock-enterprise-popover-quick">
                        <button type="button" onClick={handleSelectAllEnterprises}>
                          Todas
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const deliveredIds = enterprises.filter((e) => e.isDelivered).map((e) => e.enterpriseId)
                            setSelectedEnterpriseIds(deliveredIds)
                          }}
                        >
                          Apenas Entregues
                        </button>
                        <button type="button" onClick={() => setSelectedEnterpriseIds([])}>
                          Limpar
                        </button>
                      </div>
                    </div>

                    <div className="stock-enterprise-popover-search">
                      <Search size={14} />
                      <input
                        type="search"
                        placeholder="Pesquisar obra..."
                        value={enterpriseSearch}
                        onChange={(e) => setEnterpriseSearch(e.target.value)}
                        autoFocus
                      />
                    </div>

                    <div className="stock-enterprise-popover-list">
                      {filteredEnterpriseList.length === 0 ? (
                        <div className="stock-popover-empty">Nenhum empreendimento encontrado.</div>
                      ) : (
                        filteredEnterpriseList.map((emp) => {
                          const isChecked = selectedEnterpriseIds.includes(emp.enterpriseId)
                          return (
                            <label key={emp.enterpriseId} className="stock-enterprise-popover-item">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleEnterpriseSelection(emp.enterpriseId)}
                              />
                              <div className="stock-popover-item-details">
                                <span className="stock-popover-item-name">{emp.enterpriseName}</span>
                                <div className="stock-popover-item-tags">
                                  {emp.isDelivered ? (
                                    <span className="stock-delivered-tag">
                                      <CheckCircle2 size={10} /> Obra Entregue
                                    </span>
                                  ) : (
                                    <span className="stock-progress-tag">Em Andamento</span>
                                  )}
                                  <span className="stock-units-tag">{emp.totalUnits} un. em estoque</span>
                                </div>
                              </div>
                            </label>
                          )
                        })
                      )}
                    </div>

                    <div className="stock-enterprise-popover-footer">
                      <span>{selectedEnterpriseIds.length} selecionada(s)</span>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ height: 28, fontSize: 12, padding: '0 10px' }}
                        onClick={() => setEnterpriseDropdownOpen(false)}
                      >
                        Concluído
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle Rápido: Apenas Obras Entregues */}
              <button
                type="button"
                className={`stock-delivered-toggle-btn ${onlyDelivered ? 'is-active' : ''}`}
                onClick={handleSelectOnlyDelivered}
                title="Exibir prioritariamente unidades em estoque de empreendimentos já concluídos e entregues"
              >
                <CheckCircle2 size={15} />
                <span>Apenas obras entregues / concluídas</span>
              </button>

              {selectedEnterpriseIds.length > 0 && (
                <button
                  type="button"
                  className="stock-clear-filter-btn"
                  onClick={handleSelectAllEnterprises}
                  title="Voltar a ver todas as obras"
                >
                  <X size={13} /> Limpar seleção de obras
                </button>
              )}
            </div>

            {/* Chips das Obras Selecionadas */}
            {selectedEnterpriseIds.length > 0 && (
              <div className="stock-selected-chips-bar">
                <span className="stock-chips-label">Obras ativas:</span>
                {selectedEnterpriseIds.map((id) => {
                  const emp = enterprises.find((e) => e.enterpriseId === id)
                  if (!emp) return null
                  return (
                    <span key={id} className="stock-selected-chip">
                      <span>{emp.enterpriseName}</span>
                      {emp.isDelivered && <span className="stock-chip-delivered-dot" title="Obra entregue" />}
                      <button
                        type="button"
                        onClick={() => toggleEnterpriseSelection(id)}
                        aria-label={`Remover ${emp.enterpriseName}`}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Barra de Filtros Complementares */}
          <div className="stock-filter-bar">
            <div className="stock-search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Buscar por unidade (ex: 104, T1-008), bloco, tipologia..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="stock-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filtrar por situação comercial"
            >
              <option value="">Todas as situações comerciais</option>
              <option value="Disponível">Disponível</option>
              <option value="Bloqueada">Bloqueada</option>
              <option value="Reservada">Reservada</option>
              <option value="Em processo de reserva">Em processo de reserva</option>
            </select>

            <select
              className="stock-filter-select"
              value={inspectionFilter}
              onChange={(e) => setInspectionFilter(e.target.value)}
              aria-label="Filtrar por status de vistoria técnica"
            >
              <option value="">Todas as vistorias periódicas</option>
              <option value="overdue">Vistoria periódica atrasada</option>
              <option value="scheduled">Próxima vistoria agendada</option>
              <option value="none">Sem vistoria cadastrada</option>
              <option value="inspected">Já vistoriadas</option>
              <option value="approved">Última vistoria 100% aprovada</option>
              <option value="has_issues">Com não conformidades/reprovações</option>
            </select>
          </div>

          {/* Grid de Unidades */}
          {loading ? (
            <div className="stock-loading-state">
              <RefreshCw size={24} className="is-spinning" />
              <span>Carregando unidades em estoque...</span>
            </div>
          ) : units.length === 0 ? (
            <div className="stock-empty-state">
              <Building2 size={36} />
              <strong>Nenhuma unidade encontrada</strong>
              <span>Altere os filtros de obras ou limpe o termo de busca para visualizar as unidades.</span>
            </div>
          ) : (
            <div className="stock-units-grid">
              {units.map((unit) => {
                const isOverdue = Boolean(
                  unit.nextInspectionDate && unit.nextInspectionDate.slice(0, 10) < todayIso,
                )

                return (
                  <div key={unit.id} className="stock-unit-card">
                    <div className="stock-unit-header">
                      {unit.blockName ? (
                        <span className="stock-unit-block-tag">{unit.blockName}</span>
                      ) : (
                        <span />
                      )}

                      <div className="stock-header-badges">
                        {unit.isDelivered ? (
                          <span className="stock-delivered-badge" title="Obra concluída e entregue">
                            <CheckCircle2 size={11} /> Obra Entregue
                          </span>
                        ) : (
                          <span className="stock-progress-badge" title="Empreendimento em andamento / obras">
                            Em Andamento
                          </span>
                        )}

                        <span
                          className={`stock-status-badge ${
                            unit.statusName.toLowerCase().includes('disp')
                              ? 'status-disponivel'
                              : unit.statusName.toLowerCase().includes('bloq')
                                ? 'status-bloqueada'
                                : 'status-reservada'
                          }`}
                        >
                          {unit.statusName}
                        </span>
                      </div>
                    </div>

                    <div className="stock-unit-name">Unidade {unit.unitName}</div>
                    <div className="stock-unit-enterprise-name">{unit.enterpriseName}</div>

                    <div className="stock-unit-specs">
                      {unit.floor && <span className="stock-unit-spec-tag">{unit.floor}º Andar</span>}
                      {unit.typology && <span className="stock-unit-spec-tag">{unit.typology}</span>}
                      {unit.privateArea && <span className="stock-unit-spec-tag">{unit.privateArea} m² priv.</span>}
                      {unit.position && <span className="stock-unit-spec-tag">{unit.position}</span>}
                    </div>

                    <div className="stock-unit-inspection-section">
                      {/* Próxima Vistoria Periódica */}
                      <div className="stock-unit-inspection-row">
                        <span className="stock-unit-inspection-date">
                          <Clock size={13} />
                          Próxima vistoria:
                        </span>
                        {unit.nextInspectionDate ? (
                          <strong className={isOverdue ? 'stock-unit-inspection-date is-overdue' : ''}>
                            {formatDateBr(unit.nextInspectionDate)}
                            {isOverdue && ' (Atrasada)'}
                          </strong>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Não agendada</span>
                        )}
                      </div>

                      {/* Última Vistoria Realizada */}
                      <div className="stock-unit-inspection-row">
                        <span className="stock-unit-inspection-date">
                          <ClipboardCheck size={13} />
                          Última vistoria:
                        </span>
                        {unit.lastInspectionDate ? (
                          <span
                            className={`stock-unit-inspection-badge ${
                              unit.lastInspectionStatus === 'has_issues' ? 'has-issues' : 'approved'
                            }`}
                          >
                            {formatDateBr(unit.lastInspectionDate)} ·{' '}
                            {unit.lastInspectionStatus === 'has_issues' ? 'Com pendências' : 'Aprovada'}
                          </span>
                        ) : (
                          <span className="stock-unit-inspection-badge none">Sem laudo</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="stock-unit-card-btn"
                      onClick={() => void openUnitModal(unit)}
                    >
                      <Eye size={15} />
                      Abrir Página da Unidade ({unit.inspectionsCount})
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* TELA DE VISTORIA TÉCNICA EM TELA INTEIRA (FULLSCREEN) COM BARRA DE ROLAGEM */}
      {showInspectionModal && selectedUnit && (
        <div className="stock-inspection-fullscreen-backdrop" role="dialog" aria-modal="true">
          <div className="stock-inspection-fullscreen-container">
            <form onSubmit={(e) => void handleSubmitInspection(e)} className="stock-inspection-fullscreen-form">
              {/* Topo Fixo com Navegação e Ações */}
              <div className="stock-inspection-fullscreen-header">
                <div className="stock-fullscreen-header-left">
                  <button
                    type="button"
                    className="stock-fullscreen-back-btn"
                    onClick={() => setShowInspectionModal(false)}
                    title="Voltar para a ficha da unidade"
                  >
                    <ArrowLeft size={17} />
                    <span>Voltar</span>
                  </button>
                  <div className="stock-fullscreen-title-box">
                    <h2>Cadastro de Vistoria Técnica Periódica</h2>
                    <p>
                      Unidade <strong>{selectedUnit.unitName}</strong> · {selectedUnit.blockName || 'Bloco Único'} ·{' '}
                      {selectedUnit.enterpriseName}
                      {selectedUnit.isDelivered ? ' · (Obra Entregue)' : ''}
                    </p>
                  </div>
                </div>

                <div className="stock-fullscreen-header-right">
                  <div className="stock-live-inspection-counter">
                    <span className="live-counter-approved">
                      <Check size={14} /> {approvedItemsCount} Aprovado(s)
                    </span>
                    {reprovedItemsCount > 0 && (
                      <span className="live-counter-reproved">
                        <X size={14} /> {reprovedItemsCount} Reprovado(s)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowInspectionModal(false)}
                    disabled={savingInspection}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="primary-button stock-save-inspection-btn"
                    disabled={savingInspection}
                  >
                    <Check size={16} />
                    {savingInspection ? 'Salvando Laudo...' : 'Salvar Laudo da Vistoria'}
                  </button>
                </div>
              </div>

              {/* Corpo Rolável com Barra de Rolagem Explícita */}
              <div className="stock-inspection-fullscreen-body">
                {inspectionFormError && (
                  <div className="notice notice-error" role="alert">
                    <CircleAlert size={18} />
                    <span>{inspectionFormError}</span>
                    <button type="button" onClick={() => setInspectionFormError('')}>×</button>
                  </div>
                )}

                {/* Orientações Técnicas */}
                <div className="stock-inspection-guidance-box">
                  <ClipboardCheck size={20} />
                  <div>
                    <strong>Instruções para Vistoria Técnica Periódica em Unidades de Estoque</strong>
                    <p>
                      Avalie cuidadosamente cada um dos 8 itens obrigatórios abaixo. Para itens com anomalias, deslize para{' '}
                      <span style={{ color: '#dc2626', fontWeight: 700 }}>Reprovado</span> e anexe obrigatoriamente a descrição e foto(s) comprovando o problema.
                    </p>
                  </div>
                </div>

                {/* Dados Iniciais do Laudo */}
                <div className="stock-inspection-meta-grid">
                  <label>
                    <span>Data da Vistoria *</span>
                    <input
                      type="date"
                      value={inspectionDate}
                      onChange={(e) => setInspectionDate(e.target.value)}
                      required
                    />
                  </label>

                  <label>
                    <span>Técnico Responsável *</span>
                    <input
                      type="text"
                      value={technicianName}
                      onChange={(e) => setTechnicianName(e.target.value)}
                      placeholder="Nome completo do técnico da assistência técnica"
                      required
                    />
                  </label>
                </div>

                <div className="stock-inspection-items-section-header">
                  <h3>Avaliação Estruturada dos 8 Itens Técnicos</h3>
                  <span>Deslize cada botão para Aprovado ou Reprovado conforme vistoria in loco.</span>
                </div>

                {/* Os 8 Itens Obrigatórios com Botão Deslizante */}
                <div className="stock-inspection-items-cards-list">
                  {formItems.map((item) => {
                    const isApproved = item.status === 'approved'
                    return (
                      <div
                        key={item.key}
                        className={`stock-inspection-item-card ${!isApproved ? 'is-reproved' : ''}`}
                      >
                        <div className="stock-inspection-item-header">
                          <div className="stock-item-title-wrap">
                            <span className="stock-inspection-item-title">{item.name}</span>
                            {!isApproved && (
                              <span className="stock-item-required-flag">
                                Requer observação e foto(s)
                              </span>
                            )}
                          </div>

                          {/* Slide Toggle Button */}
                          <div
                            className={`stock-slide-toggle ${isApproved ? 'is-approved' : 'is-reproved'}`}
                            onClick={() => toggleItemStatus(item.key, isApproved ? 'reproved' : 'approved')}
                            title="Clique para alternar entre Aprovado e Reprovado"
                          >
                            <div
                              className={`stock-slide-option opt-approved ${isApproved ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleItemStatus(item.key, 'approved')
                              }}
                            >
                              <Check size={14} />
                              Aprovado
                            </div>
                            <div
                              className={`stock-slide-option opt-reproved ${!isApproved ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleItemStatus(item.key, 'reproved')
                              }}
                            >
                              <X size={14} />
                              Reprovado
                            </div>
                          </div>
                        </div>

                        {/* Seção Condicional de Reprovação (Observação + Fotos Obrigatórias) */}
                        {!isApproved && (
                          <div className="stock-reproved-details">
                            <label>
                              <span>Observação detalhada da não conformidade *</span>
                              <textarea
                                rows={2}
                                placeholder={`Descreva especificamente o defeito encontrado em ${item.name.toLowerCase()}...`}
                                value={item.observation}
                                onChange={(e) => handleItemObservationChange(item.key, e.target.value)}
                                required
                              />
                            </label>

                            <div className="stock-photo-upload-row">
                              <label className="stock-photo-upload-btn">
                                <Camera size={15} />
                                <span>Anexar Foto(s) Comprobatória(s) *</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  style={{ display: 'none' }}
                                  onChange={(e) => void handlePhotoUpload(item.key, e.target.files)}
                                />
                              </label>

                              {item.photos.length > 0 ? (
                                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                                  ✓ {item.photos.length} {item.photos.length === 1 ? 'foto otimizada anexada' : 'fotos otimizadas anexadas'}
                                </span>
                              ) : (
                                <span style={{ fontSize: 12.5, color: '#dc2626', fontWeight: 600 }}>
                                  Foto obrigatória para item reprovado
                                </span>
                              )}
                            </div>

                            {item.photos.length > 0 && (
                              <div className="stock-photo-previews">
                                {item.photos.map((p, pIdx) => (
                                  <div key={pIdx} className="stock-photo-thumb">
                                    <img src={p.dataUrl} alt={p.fileName} decoding="async" />
                                    <button
                                      type="button"
                                      className="stock-photo-remove-btn"
                                      onClick={() => handleRemovePhoto(item.key, pIdx)}
                                      title="Remover foto"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Campo "Outros" (Observações Gerais) */}
                <div className="stock-inspection-general-notes">
                  <label>
                    <span>Outros (Observações Gerais da Vistoria Técnica)</span>
                    <textarea
                      rows={3}
                      value={generalNotes}
                      onChange={(e) => setGeneralNotes(e.target.value)}
                      placeholder="Observações complementares sobre limpeza, entrega de chaves, medidores, áreas comuns ou detalhes gerais..."
                    />
                  </label>
                </div>
              </div>

              {/* Rodapé Fixo */}
              <div className="stock-inspection-fullscreen-footer">
                <div className="stock-fullscreen-footer-summary">
                  <span>Itens avaliados: <strong>8 de 8</strong></span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>{approvedItemsCount} aprovado(s)</span>
                  {reprovedItemsCount > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>{reprovedItemsCount} reprovado(s)</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowInspectionModal(false)}
                    disabled={savingInspection}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="primary-button stock-save-inspection-btn"
                    disabled={savingInspection}
                  >
                    <Check size={16} />
                    {savingInspection ? 'Salvando Vistoria...' : 'Salvar Laudo da Vistoria'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox / Foto Ampliada */}
      {viewingPhotoUrl && (
        <div className="stock-lightbox-backdrop" onClick={() => setViewingPhotoUrl(null)}>
          <div className="stock-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={viewingPhotoUrl} alt="Foto ampliada da vistoria" />
            <button
              type="button"
              className="stock-lightbox-close"
              onClick={() => setViewingPhotoUrl(null)}
              aria-label="Fechar foto ampliada"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
