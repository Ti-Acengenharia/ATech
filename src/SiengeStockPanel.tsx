import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { AlertCircle, ArrowLeftRight, ChevronLeft, ChevronRight, LoaderCircle, PackageCheck, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, Truck } from 'lucide-react'
import { apiRequest } from './api/client'
import './SiengeStockPanel.css'

interface CostCenter {
  costCenterId: number
  departmentId: number | null
  itemCount: number | null
  synchronizedAt: string | null
  needsRefresh?: boolean
}

interface StockLocation {
  id: number
  name: string
  isActive: boolean
  costCenters: CostCenter[]
}

interface Collaborator {
  id: number
  name: string
  isActive: boolean
  isOnLeave: boolean
}

interface StockItem {
  snapshotItemId: number | null
  costCenterId: number | null
  locationId: number | null
  locationName: string
  resourceId: number
  resourceDescription: string
  detailId: number | null
  detailDescription: string | null
  trademarkId: number | null
  trademarkDescription: string | null
  quantity: number
  unitOfMeasure: string
  averagePrice: number | null
  synchronizedAt: string | null
  needsRefresh?: boolean
  centerQuantities: {
    snapshotItemId: number
    costCenterId: number
    quantity: number
    unitOfMeasure: string
    synchronizedAt: string
    needsRefresh: boolean
  }[]
}

interface StockPage {
  items: StockItem[]
  total: number
  offset: number
  limit: number
  view: 'center' | 'location'
}

interface UnresolvedMovement {
  id: number
  operationType: string
  status: string
  costCenterId: number
  destinationCostCenterId: number | null
  resourceId: number
  quantity: number
  unitOfMeasure: string
  actorName: string
  createdAt: string
  errorMessage: string | null
  itemCount: number
}

interface Appropriation {
  buildingUnitId: string
  sheetItemId: string
  percentage: string
}

type MovementType = 'issue' | 'transfer' | 'epi_delivery'
interface MovementLineForm {
  item: StockItem
  quantity: string
  destinationResourceId: string
  destinationDetailId: string
  destinationTrademarkId: string
}

const PAGE_SIZE = 100
const emptyAppropriation = (): Appropriation => ({ buildingUnitId: '', sheetItemId: '', percentage: '100' })
const emptyStockPage = (view: 'center' | 'location' = 'center'): StockPage => ({
  items: [], total: 0, offset: 0, limit: PAGE_SIZE, view,
})

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function createRequestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function displayQuantity(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value)
}

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Nunca sincronizado'
}

function SignaturePad({ value, onChange }: { value: string | null; onChange: (signature: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const inkRef = useRef(false)

  function point(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>) {
    const bounds = canvas.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) }
  }

  function begin(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget
    const context = canvas.getContext('2d')
    if (!context) return
    const position = point(canvas, event)
    canvas.setPointerCapture(event.pointerId)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.beginPath()
    context.moveTo(position.x, position.y)
    drawingRef.current = true
    inkRef.current = false
    onChange(null)
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const position = point(event.currentTarget, event)
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#183f70'
    context.lineTo(position.x, position.y)
    context.stroke()
    inkRef.current = true
  }

  function finish() {
    drawingRef.current = false
    if (inkRef.current) onChange(canvasRef.current?.toDataURL('image/png').split(',')[1] ?? null)
  }

  function clear() {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, 720, 180)
    inkRef.current = false
    onChange(null)
  }

  return (
    <div className="sienge-signature">
      <label>Assinatura de quem recebe *</label>
      <canvas ref={canvasRef} width={720} height={180} onPointerDown={begin} onPointerMove={draw} onPointerUp={finish} onPointerCancel={finish} aria-label="Assinatura de quem recebe" />
      <div><small>{value ? 'Assinatura coletada' : 'Assine dentro do quadro'}</small><button type="button" onClick={clear}>Limpar</button></div>
    </div>
  )
}

export default function SiengeStockPanel({ isAdmin, collaborators }: { isAdmin: boolean; collaborators: Collaborator[] }) {
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [unassigned, setUnassigned] = useState<CostCenter[]>([])
  const [stockPage, setStockPage] = useState<StockPage>(() => emptyStockPage())
  const [unresolvedMovements, setUnresolvedMovements] = useState<UnresolvedMovement[]>([])
  const [reconciliationNotes, setReconciliationNotes] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [locationFilter, setLocationFilter] = useState('all')
  const [resourceSearch, setResourceSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [viewMode, setViewMode] = useState<'center' | 'location'>('center')
  const [costCenterFilter, setCostCenterFilter] = useState('all')
  const [selectedItems, setSelectedItems] = useState<StockItem[]>([])
  const [editingLocation, setEditingLocation] = useState<number | null>(null)
  const [centerIdsText, setCenterIdsText] = useState('')
  const [departmentIds, setDepartmentIds] = useState<Record<number, string>>({})
  const [operation, setOperation] = useState<{ type: MovementType } | null>(null)
  const [operationLines, setOperationLines] = useState<MovementLineForm[]>([])
  const [requestKey, setRequestKey] = useState('')
  const [transactionDate, setTransactionDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [sourceAppropriations, setSourceAppropriations] = useState<Appropriation[]>([emptyAppropriation()])
  const [destinationAppropriations, setDestinationAppropriations] = useState<Appropriation[]>([emptyAppropriation()])
  const [destinationCostCenterId, setDestinationCostCenterId] = useState('')
  const [collaboratorId, setCollaboratorId] = useState('')
  const [delivererPin, setDelivererPin] = useState('')
  const [recipientSignature, setRecipientSignature] = useState<string | null>(null)

  async function loadLocations() {
    const result = await apiRequest<{ locations: StockLocation[]; unassignedCostCenters: CostCenter[] }>('/api/inventory/sienge/locations')
    setLocations(result.locations)
    setUnassigned(result.unassignedCostCenters)
  }

  async function loadItems(
    offset = 0,
    nextLocationFilter = locationFilter,
    nextCostCenterFilter = costCenterFilter,
    nextSearch = appliedSearch,
    nextViewMode = viewMode,
  ) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
    if (nextLocationFilter !== 'all') params.set('locationId', nextLocationFilter)
    if (nextCostCenterFilter !== 'all') params.set('costCenterId', nextCostCenterFilter)
    if (nextSearch) params.set('search', nextSearch)
    params.set('view', nextViewMode)
    const result = await apiRequest<StockPage>(`/api/inventory/sienge/items?${params.toString()}`)
    setStockPage(result)
    setSelectedItems([])
  }

  const loadUnresolved = useCallback(async () => {
    if (!isAdmin) return
    const result = await apiRequest<{ movements: UnresolvedMovement[] }>('/api/inventory/sienge/movements/unresolved')
    setUnresolvedMovements(result.movements)
  }, [isAdmin])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadLocations(), loadItems(), loadUnresolved()]).catch((error) => {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar o estoque Sienge.' })
      }).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadUnresolved])

  async function refreshAll() {
    setBusy(true)
    setNotice(null)
    try {
      await Promise.all([loadLocations(), loadItems(), loadUnresolved()])
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o estoque Sienge.' })
    } finally {
      setBusy(false)
    }
  }

  async function changePage(offset: number) {
    setBusy(true)
    try {
      await loadItems(offset)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar esta página.' })
    } finally {
      setBusy(false)
    }
  }

  function searchResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = resourceSearch.trim()
    setAppliedSearch(value)
    setNotice(null)
    setBusy(true)
    void loadItems(0, locationFilter, costCenterFilter, value, viewMode).catch((error) => {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível buscar o insumo.' })
    }).finally(() => setBusy(false))
  }

  function changeLocationFilter(value: string) {
    setLocationFilter(value)
    setCostCenterFilter('all')
    setBusy(true)
    void loadItems(0, value, 'all').catch((error) => {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível filtrar o estoque.' })
    }).finally(() => setBusy(false))
  }

  function changeCostCenterFilter(value: string) {
    setCostCenterFilter(value)
    setBusy(true)
    void loadItems(0, locationFilter, value).catch((error) => {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível filtrar o centro de custo.' })
    }).finally(() => setBusy(false))
  }

  function changeViewMode(value: 'center' | 'location') {
    setViewMode(value)
    setCostCenterFilter('all')
    setSelectedItems([])
    setBusy(true)
    void loadItems(0, locationFilter, 'all', appliedSearch, value).catch((error) => {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível alterar a visão do estoque.' })
    }).finally(() => setBusy(false))
  }

  function beginCenterEdit(location: StockLocation) {
    setEditingLocation(location.id)
    setCenterIdsText(location.costCenters.map((center) => center.costCenterId).join(', '))
    setDepartmentIds(Object.fromEntries(location.costCenters.map((center) => [
      center.costCenterId,
      center.departmentId === null ? '' : String(center.departmentId),
    ])))
    setNotice(null)
  }

  function parsedCenterIds() {
    return centerIdsText.split(/[\s,;]+/).filter(Boolean).map(Number)
  }

  async function saveCenters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ids = parsedCenterIds()
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647) ||
        new Set(ids).size !== ids.length || ids.length > 500) {
      setNotice({ kind: 'error', text: 'Informe até 500 centros de custo como números inteiros positivos e sem duplicatas.' })
      return
    }
    for (const id of ids) {
      const departmentId = departmentIds[id]?.trim()
      if (departmentId && (!/^\d+$/.test(departmentId) || Number(departmentId) < 1 || Number(departmentId) > 2147483647)) {
        setNotice({ kind: 'error', text: `O departamento do centro ${id} deve ser um número inteiro positivo.` })
        return
      }
    }
    setBusy(true)
    setNotice(null)
    try {
      await apiRequest(`/api/inventory/sienge/locations/${editingLocation}/cost-centers`, {
        method: 'PUT',
        body: JSON.stringify({
          costCenters: ids.map((costCenterId) => ({
            costCenterId,
            departmentId: departmentIds[costCenterId]?.trim() ? Number(departmentIds[costCenterId]) : null,
          })),
        }),
      })
      setEditingLocation(null)
      setNotice({ kind: 'success', text: 'Centros de custo associados ao local.' })
      await loadLocations()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar os centros de custo.' })
    } finally {
      setBusy(false)
    }
  }

  async function sync(locationId?: number) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await apiRequest<{
        results: { costCenterId: number; itemCount: number | null; error: string | null }[]
        notAttemptedCenterIds: number[]
      }>('/api/inventory/sienge/sync', {
        method: 'POST',
        body: JSON.stringify(locationId ? { locationId } : {}),
      })
      const completed = result.results.filter((center) => center.error === null)
      const failed = result.results.find((center) => center.error !== null)
      const summary = `${completed.length} centro(s) sincronizado(s), ${completed.reduce((sum, center) => sum + (center.itemCount ?? 0), 0)} item(ns).`
      setNotice(failed
        ? { kind: 'error', text: `${summary} Falha no centro ${failed.costCenterId}: ${failed.error}${result.notAttemptedCenterIds.length ? ` Não iniciados: ${result.notAttemptedCenterIds.join(', ')}.` : ''}` }
        : { kind: 'success', text: summary })
      await Promise.all([loadLocations(), loadItems(), loadUnresolved()])
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível sincronizar o estoque Sienge.' })
    } finally {
      setBusy(false)
    }
  }

  async function reconcileMovement(movement: UnresolvedMovement, status: 'succeeded' | 'failed') {
    const note = reconciliationNotes[movement.id]?.trim() ?? ''
    if (note.length < 5) {
      setNotice({ kind: 'error', text: 'Descreva como o movimento foi conferido no Sienge (mínimo 5 caracteres).' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await apiRequest(`/api/inventory/sienge/movements/${movement.id}/reconcile`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      })
      setNotice({ kind: 'success', text: `Movimento #${movement.id} reconciliado. Sincronize novamente os centros envolvidos.` })
      await Promise.all([loadUnresolved(), loadLocations(), loadItems()])
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível reconciliar o movimento.' })
    } finally {
      setBusy(false)
    }
  }

  function beginOperation(type: MovementType, items: StockItem[]) {
    const usableItems = items.filter((item) => item.snapshotItemId !== null && item.costCenterId !== null)
    if (!usableItems.length || new Set(usableItems.map((item) => item.costCenterId)).size !== 1) {
      setNotice({ kind: 'error', text: 'Selecione itens de um único centro de custo para esta movimentação.' })
      return
    }
    setOperation({ type })
    setOperationLines(usableItems.map((item) => ({
      item,
      quantity: '',
      destinationResourceId: String(item.resourceId),
      destinationDetailId: item.detailId === null ? '' : String(item.detailId),
      destinationTrademarkId: item.trademarkId === null ? '' : String(item.trademarkId),
    })))
    setRequestKey(createRequestKey())
    setTransactionDate(today())
    setNotes('')
    setSourceAppropriations([emptyAppropriation()])
    setDestinationAppropriations([emptyAppropriation()])
    setDestinationCostCenterId('')
    setCollaboratorId('')
    setDelivererPin('')
    setRecipientSignature(null)
    setNotice(null)
  }

  function editOperationLine(index: number, field: keyof Omit<MovementLineForm, 'item'>, value: string) {
    setOperationLines((lines) => lines.map((line, current) =>
      current === index ? { ...line, [field]: value } : line))
  }

  function toggleSelectedItem(item: StockItem, center = item.centerQuantities[0]) {
    if (!center) return
    const stockItem: StockItem = {
      ...item,
      snapshotItemId: center.snapshotItemId,
      costCenterId: center.costCenterId,
      quantity: center.quantity,
      unitOfMeasure: center.unitOfMeasure,
      synchronizedAt: center.synchronizedAt,
      needsRefresh: center.needsRefresh,
    }
    setSelectedItems((current) => current.some((selected) => selected.snapshotItemId === stockItem.snapshotItemId)
      ? current.filter((selected) => selected.snapshotItemId !== stockItem.snapshotItemId)
      : [...current, stockItem])
  }

  function editAppropriation(
    direction: 'source' | 'destination',
    index: number,
    field: keyof Appropriation,
    value: string,
  ) {
    const setter = direction === 'source' ? setSourceAppropriations : setDestinationAppropriations
    setter((items) => items.map((item, current) => current === index ? { ...item, [field]: value } : item))
  }

  function updateAppropriations(direction: 'source' | 'destination', items: Appropriation[]) {
    const setter = direction === 'source' ? setSourceAppropriations : setDestinationAppropriations
    setter(items)
  }

  function renderAppropriations(direction: 'source' | 'destination', items: Appropriation[]) {
    return (
      <section className="sienge-appropriations">
        <div className="sienge-appropriations-heading">
          <div><strong>{direction === 'source' ? 'Apropriações da origem' : 'Apropriações do destino'}</strong><small>Informe unidade construtiva, item do orçamento e percentual. A soma deve ser 100%.</small></div>
          <button type="button" className="secondary-button" onClick={() => updateAppropriations(direction, [...items, emptyAppropriation()])}><Plus size={14} /> Rateio</button>
        </div>
        {items.map((item, index) => (
          <div className="sienge-appropriation-row" key={`${direction}-${index}`}>
            <label><span>Unidade construtiva *</span><input type="number" min="1" step="1" value={item.buildingUnitId} onChange={(event) => editAppropriation(direction, index, 'buildingUnitId', event.target.value)} required /></label>
            <label><span>Item do orçamento *</span><input type="number" min="1" step="1" value={item.sheetItemId} onChange={(event) => editAppropriation(direction, index, 'sheetItemId', event.target.value)} required /></label>
            <label><span>Percentual *</span><input type="number" min="0.000000000001" max="100" step="any" value={item.percentage} onChange={(event) => editAppropriation(direction, index, 'percentage', event.target.value)} required /></label>
            <button type="button" className="sienge-remove-rate" disabled={items.length === 1} aria-label="Remover rateio" onClick={() => updateAppropriations(direction, items.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
          </div>
        ))}
        <p className={Math.abs(items.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0) - 100) < 0.00000001 ? 'is-valid' : 'is-invalid'}>
          Soma do rateio: {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(items.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0))}%
        </p>
      </section>
    )
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!operation) return
    const allocationsValid = [sourceAppropriations, ...(operation.type === 'transfer' ? [destinationAppropriations] : [])]
      .every((items) => items.every((item) => item.buildingUnitId && item.sheetItemId && Number(item.percentage) > 0) &&
        Math.abs(items.reduce((sum, item) => sum + Number(item.percentage), 0) - 100) < 0.00000001)
    if (!allocationsValid) {
      setNotice({ kind: 'error', text: 'Complete as apropriações e confira se cada rateio totaliza 100%.' })
      return
    }
    if (operationLines.some((line) => !line.quantity || !Number.isFinite(Number(line.quantity)) ||
        Number(line.quantity) <= 0 || Number(line.quantity) > line.item.quantity)) {
      setNotice({ kind: 'error', text: 'Informe uma quantidade positiva disponível para cada insumo.' })
      return
    }
    if (operation.type === 'transfer' && (!destinationCostCenterId || operationLines.some((line) =>
      !/^\d+$/.test(line.destinationResourceId) || Number(line.destinationResourceId) < 1))) {
      setNotice({ kind: 'error', text: 'Selecione o centro de destino e informe o resourceId correspondente para cada item.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const sourceCostCenterId = operationLines[0].item.costCenterId
      if (sourceCostCenterId === null) throw new Error('O centro de custo de origem não está disponível.')
      const result = await apiRequest<{ message: string }>('/api/inventory/sienge/movements', {
        method: 'POST',
        body: JSON.stringify({
          requestKey,
          confirmed: true,
          operationType: operation.type,
          transactionDate,
          costCenterId: sourceCostCenterId,
          items: operationLines.map((line) => ({
            snapshotItemId: line.item.snapshotItemId,
            quantity: Number(line.quantity),
            sourceBuildingAppropriations: sourceAppropriations.map((item) => ({
              buildingUnitId: Number(item.buildingUnitId),
              sheetItemId: Number(item.sheetItemId),
              percentage: Number(item.percentage),
            })),
            ...(operation.type === 'transfer' ? {
              destinationResourceId: Number(line.destinationResourceId),
              destinationDetailId: line.destinationDetailId ? Number(line.destinationDetailId) : null,
              destinationTrademarkId: line.destinationTrademarkId ? Number(line.destinationTrademarkId) : null,
              destinationBuildingAppropriations: destinationAppropriations.map((item) => ({
                buildingUnitId: Number(item.buildingUnitId),
                sheetItemId: Number(item.sheetItemId),
                percentage: Number(item.percentage),
              })),
            } : {}),
          })),
          ...(operation.type === 'transfer' ? {
            destinationCostCenterId: Number(destinationCostCenterId),
          } : {}),
          ...(operation.type === 'epi_delivery' ? {
            collaboratorId: Number(collaboratorId),
            delivererPin,
            recipientSignatureBase64: recipientSignature,
          } : {}),
          notes,
        }),
      })
      setOperation(null)
      setOperationLines([])
      setSelectedItems([])
      setNotice({ kind: 'success', text: result.message })
      await Promise.all([loadLocations(), loadItems()])
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível enviar o movimento ao Sienge.' })
    } finally {
      setBusy(false)
    }
  }

  const mappedCenters = locations.flatMap((location) => location.costCenters.map((center) => ({
    ...center,
    locationName: location.name,
    locationId: location.id,
  })))
  const editingCenterIds = parsedCenterIds().filter((id) => Number.isSafeInteger(id) && id > 0)
  const sourceTotal = sourceAppropriations.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0)
  const destinationTotal = destinationAppropriations.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0)
  const currentCollaborators = collaborators.filter((person) => person.isActive && !person.isOnLeave)
  const selectedCostCenters = new Set(selectedItems.map((item) => item.costCenterId))
  const selectionHasMixedCenters = selectedCostCenters.size > 1

  return (
    <section className="sienge-stock-panel" aria-label="Estoque sincronizado com o Sienge">
      <header className="sienge-stock-header">
        <div>
          <span className="eyebrow">INTEGRAÇÃO SIENGE</span>
          <h2>Estoque por obra</h2>
          <p>Consulte por centro de custo ou por local agrupado. Cada item mantém o saldo discriminado por centro associado.</p>
        </div>
        <div className="sienge-stock-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshAll()}><RefreshCw size={15} /> Atualizar visão</button>
          {isAdmin && <button className="secondary-button" type="button" disabled={busy} onClick={() => void sync()}>
            {busy ? <LoaderCircle className="sienge-stock-spin" size={15} /> : <RefreshCw size={15} />} Sincronizar todos os centros
          </button>}
        </div>
      </header>

      {notice && <div className={`sienge-stock-notice ${notice.kind}`} role="status"><AlertCircle size={16} /><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso">×</button></div>}

      {isAdmin && unresolvedMovements.length > 0 && <section className="sienge-unresolved">
        <h3>Movimentos que precisam de conferência</h3>
        <p>Confira cada operação no Sienge antes de marcar seu resultado. Não reenvie uma operação com resultado incerto.</p>
        {unresolvedMovements.map((movement) => <article key={movement.id}>
          <div>
            <strong>#{movement.id} · {movement.operationType === 'transfer' ? 'Transferência' : movement.operationType === 'epi_delivery' ? 'Entrega de EPI' : movement.operationType === 'uniform_delivery' ? 'Entrega de fardamento' : 'Baixa'} · {movement.itemCount || 1} item(ns)</strong>
            <small>Item de referência: resourceId {movement.resourceId} · {movement.quantity} {movement.unitOfMeasure} · centro {movement.costCenterId}{movement.destinationCostCenterId ? ` → centro ${movement.destinationCostCenterId}` : ''} · {movement.actorName} · {new Date(movement.createdAt).toLocaleString('pt-BR')}</small>
            {movement.errorMessage && <small className="sienge-unresolved-error">{movement.errorMessage}</small>}
          </div>
          <label><span>Como conferiu no Sienge? *</span><input value={reconciliationNotes[movement.id] ?? ''} maxLength={500} onChange={(event) => setReconciliationNotes((current) => ({ ...current, [movement.id]: event.target.value }))} /></label>
          <div>
            <button type="button" className="secondary-button" disabled={busy || (reconciliationNotes[movement.id]?.trim().length ?? 0) < 5} onClick={() => void reconcileMovement(movement, 'failed')}>Não foi aplicado</button>
            <button type="button" className="primary-button" disabled={busy || (reconciliationNotes[movement.id]?.trim().length ?? 0) < 5} onClick={() => void reconcileMovement(movement, 'succeeded')}>Foi aplicado</button>
          </div>
        </article>)}
      </section>}

      <div className="sienge-location-grid">
        {locations.map((location) => (
          <article className="sienge-location-card" key={location.id}>
            <div className="sienge-location-title">
              <div><strong>{location.name}</strong><small>{location.costCenters.length} centro(s) associado(s)</small></div>
              {isAdmin && <div>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => beginCenterEdit(location)}><Save size={14} /> Centros</button>
                <button className="secondary-button" type="button" disabled={busy || !location.costCenters.length} onClick={() => void sync(location.id)}><RefreshCw size={14} /> Sincronizar</button>
              </div>}
            </div>
            {location.costCenters.length ? <div className="sienge-center-list">
              {location.costCenters.map((center) => <span key={center.costCenterId} className={center.needsRefresh ? 'needs-refresh' : ''}>
                <strong>Centro {center.costCenterId}</strong>
                <small>{center.itemCount === null ? 'Sem snapshot' : `${center.itemCount} itens · ${displayDate(center.synchronizedAt)}`}</small>
                {center.departmentId !== null && <small>Departamento {center.departmentId}</small>}
                {center.needsRefresh && <em>Atualização pendente após movimento</em>}
              </span>)}
            </div> : <p className="sienge-empty-centers">Nenhum centro associado a este local.</p>}
          </article>
        ))}
      </div>

      {isAdmin && unassigned.length > 0 && <p className="sienge-unassigned-note">
        Centros ainda sem local: {unassigned.map((center) => center.costCenterId).join(', ')}. Associe-os em “Centros” no local desejado.
      </p>}

      {editingLocation !== null && <form className="sienge-center-editor" onSubmit={(event) => void saveCenters(event)}>
        <header><div><h3>Centros de custo do local</h3><p>Um centro só pode pertencer a um local. IDs antigos foram mantidos como não atribuídos.</p></div><button type="button" className="sienge-close" onClick={() => setEditingLocation(null)} aria-label="Fechar">×</button></header>
        <label><span>IDs dos centros de custo *</span><textarea rows={2} value={centerIdsText} onChange={(event) => setCenterIdsText(event.target.value)} placeholder="Ex.: 7, 120, 450" /></label>
        <div className="sienge-departments-grid">{editingCenterIds.map((id) => (
          <label key={id}><span>Departamento do centro {id} (opcional)</span><input type="number" min="1" step="1" value={departmentIds[id] ?? ''} onChange={(event) => setDepartmentIds((current) => ({ ...current, [id]: event.target.value }))} /></label>
        ))}</div>
        <footer><button type="button" className="secondary-button" onClick={() => setEditingLocation(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Salvando...' : 'Salvar centros'}</button></footer>
      </form>}

      <div className="sienge-stock-toolbar">
        <form onSubmit={searchResource}>
          <label><Search size={15} /><input type="search" value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} placeholder="Buscar insumo, detalhe, marca ou código" /></label>
          <button className="secondary-button" type="submit" disabled={busy}>Buscar</button>
        </form>
        <select value={viewMode} onChange={(event) => changeViewMode(event.target.value as 'center' | 'location')} aria-label="Visão do estoque">
          <option value="center">Visão por centro de custo</option>
          <option value="location">Visão agrupada por local</option>
        </select>
        <select value={locationFilter} onChange={(event) => changeLocationFilter(event.target.value)} aria-label="Filtrar por local">
          <option value="all">Todos os locais</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        {viewMode === 'center' && <select value={costCenterFilter} onChange={(event) => changeCostCenterFilter(event.target.value)} aria-label="Filtrar por centro de custo">
          <option value="all">Todos os centros</option>
          {mappedCenters.map((center) => <option key={center.costCenterId} value={center.costCenterId}>{center.locationName} · centro {center.costCenterId}</option>)}
        </select>}
      </div>

      {selectedItems.length > 0 && <div className="sienge-batch-toolbar">
        <span>{selectedItems.length} item(ns) selecionado(s){selectionHasMixedCenters ? ' · selecione itens de um único centro' : ` · centro ${selectedItems[0].costCenterId}`}</span>
        <div>
          <button type="button" className="secondary-button" disabled={busy || selectionHasMixedCenters} onClick={() => beginOperation('issue', selectedItems)}><PackageCheck size={14} /> Baixa em lote</button>
          <button type="button" className="secondary-button" disabled={busy || selectionHasMixedCenters} onClick={() => beginOperation('transfer', selectedItems)}><ArrowLeftRight size={14} /> Transferir em lote</button>
          <button type="button" className="secondary-button" disabled={busy || selectionHasMixedCenters} onClick={() => beginOperation('epi_delivery', selectedItems)}><Truck size={14} /> Entregar EPI em lote</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setSelectedItems([])}>Limpar</button>
        </div>
      </div>}

      <div className="sienge-stock-table-wrap">
        <table className="sienge-stock-table">
          <thead><tr><th>Local</th><th>Insumo Sienge</th><th>Detalhe / marca</th><th>Saldo por centro</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={4} className="sienge-stock-empty">Carregando estoque Sienge...</td></tr>
            : stockPage.items.length ? stockPage.items.map((item) => (
              <tr key={`${item.locationId ?? 'none'}-${item.resourceId}-${item.detailId ?? 0}-${item.trademarkId ?? 0}-${item.unitOfMeasure}`}>
                <td><strong>{item.locationName}</strong>{viewMode === 'center' && item.costCenterId !== null && <small>Centro {item.costCenterId}</small>}</td>
                <td><strong>{item.resourceDescription || `Insumo ${item.resourceId}`}</strong><small>resourceId {item.resourceId}</small></td>
                <td>{item.detailDescription || '—'}<small>{item.trademarkDescription || 'Sem marca'}</small></td>
                <td><div className="sienge-center-balances">{item.centerQuantities.map((balance) => {
                  const centerItem: StockItem = {
                    ...item,
                    snapshotItemId: balance.snapshotItemId,
                    costCenterId: balance.costCenterId,
                    quantity: balance.quantity,
                    unitOfMeasure: balance.unitOfMeasure,
                    synchronizedAt: balance.synchronizedAt,
                    needsRefresh: balance.needsRefresh,
                  }
                  const checked = selectedItems.some((selected) => selected.snapshotItemId === balance.snapshotItemId)
                  const disabled = !item.locationId || balance.quantity <= 0 || balance.needsRefresh
                  return <div className="sienge-center-balance" key={balance.snapshotItemId}>
                    <label><input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleSelectedItem(item, balance)} />
                      <span><strong>Centro {balance.costCenterId}</strong> · {displayQuantity(balance.quantity)} {balance.unitOfMeasure}
                        {balance.needsRefresh && <small className="sienge-stale-label">Atualização pendente</small>}
                      </span>
                    </label>
                    <small>Atualizado {displayDate(balance.synchronizedAt)}</small>
                    <div className="sienge-item-actions">
                      <button type="button" className="secondary-button" disabled={disabled} onClick={() => beginOperation('issue', [centerItem])} title="Registrar saída diretamente no Sienge"><PackageCheck size={14} /> Baixa</button>
                      <button type="button" className="secondary-button" disabled={disabled} onClick={() => beginOperation('transfer', [centerItem])} title="Transferir entre centros de custo no Sienge"><ArrowLeftRight size={14} /> Transferir</button>
                      <button type="button" className="secondary-button" disabled={disabled} onClick={() => beginOperation('epi_delivery', [centerItem])} title="Registrar entrega de EPI diretamente no Sienge"><Truck size={14} /> EPI</button>
                    </div>
                  </div>
                })}</div></td>
              </tr>
            )) : <tr><td colSpan={4} className="sienge-stock-empty">Nenhum item no snapshot para esses filtros. Sincronize os centros associados.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sienge-stock-pagination">
        <span>{stockPage.total ? `${stockPage.offset + 1}–${Math.min(stockPage.offset + stockPage.limit, stockPage.total)} de ${stockPage.total} item(ns)` : '0 itens'}</span>
        <div>
          <button type="button" className="secondary-button" disabled={busy || stockPage.offset === 0} onClick={() => void changePage(Math.max(0, stockPage.offset - PAGE_SIZE))}><ChevronLeft size={15} /> Anterior</button>
          <button type="button" className="secondary-button" disabled={busy || stockPage.offset + stockPage.limit >= stockPage.total} onClick={() => void changePage(stockPage.offset + PAGE_SIZE)}>Próxima <ChevronRight size={15} /></button>
        </div>
      </div>

      {operation && <div className="sienge-movement-backdrop" role="presentation">
        <section className="sienge-movement-dialog" role="dialog" aria-modal="true" aria-labelledby="sienge-movement-title">
          <header><div><span className="eyebrow">MOVIMENTO DIRETO NO SIENGE</span><h3 id="sienge-movement-title">{operation.type === 'issue' ? 'Baixa de estoque' : operation.type === 'transfer' ? 'Transferência entre centros' : 'Entrega de EPI'}</h3>
            <p>{operationLines.length} item(ns) · centro de origem {operationLines[0]?.item.costCenterId}</p></div>
            <button className="sienge-close" type="button" onClick={() => setOperation(null)} aria-label="Fechar">×</button>
          </header>
          <form onSubmit={(event) => void submitMovement(event)}>
            <div className="sienge-movement-summary"><strong>Movimentação em lote · {operationLines.length} item(ns)</strong><span>Uma chamada será contabilizada na cota diária. O saldo será atualizado após nova sincronização.</span></div>
            <div className="sienge-movement-fields">
              <label><span>Data do movimento *</span><input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /></label>
            </div>

            {operation.type === 'transfer' && <section className="sienge-transfer-fields">
              <label><span>Centro de custo de destino *</span><select value={destinationCostCenterId} onChange={(event) => setDestinationCostCenterId(event.target.value)} required>
                <option value="">Selecione o destino</option>
                {mappedCenters.filter((center) => center.costCenterId !== operationLines[0]?.item.costCenterId).map((center) => <option key={center.costCenterId} value={center.costCenterId}>{center.locationName} · centro {center.costCenterId}</option>)}
              </select></label>
              <p>Informe o cadastro correspondente de destino em cada linha; o resourceId pode ser diferente da origem.</p>
            </section>}

            <section className="sienge-movement-lines">
              {operationLines.map((line, index) => <article key={line.item.snapshotItemId}>
                <header><div><strong>{line.item.resourceDescription || `Insumo ${line.item.resourceId}`}</strong><small>resourceId {line.item.resourceId} · {line.item.detailDescription || 'Sem detalhe'} · {line.item.trademarkDescription || 'Sem marca'} · saldo {displayQuantity(line.item.quantity)} {line.item.unitOfMeasure}</small></div>
                  <button type="button" className="sienge-remove-rate" disabled={operationLines.length === 1} aria-label="Remover item da movimentação" onClick={() => setOperationLines((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={15} /></button>
                </header>
                <div className="sienge-movement-fields">
                  <label><span>Quantidade ({line.item.unitOfMeasure}) *</span><input type="number" min="0.0001" max={line.item.quantity} step="0.0001" value={line.quantity} onChange={(event) => editOperationLine(index, 'quantity', event.target.value)} required /></label>
                  {operation.type === 'transfer' && <>
                    <label><span>resourceId no destino *</span><input type="number" min="1" step="1" value={line.destinationResourceId} onChange={(event) => editOperationLine(index, 'destinationResourceId', event.target.value)} required /></label>
                    <label><span>detailId no destino</span><input type="number" min="1" step="1" value={line.destinationDetailId} onChange={(event) => editOperationLine(index, 'destinationDetailId', event.target.value)} /></label>
                    <label><span>trademarkId no destino</span><input type="number" min="1" step="1" value={line.destinationTrademarkId} onChange={(event) => editOperationLine(index, 'destinationTrademarkId', event.target.value)} /></label>
                  </>}
                </div>
              </article>)}
            </section>

            {renderAppropriations('source', sourceAppropriations)}
            {operation.type === 'transfer' && renderAppropriations('destination', destinationAppropriations)}

            {operation.type === 'epi_delivery' && <>
              <label className="sienge-collaborator-select"><span>Colaborador *</span><select value={collaboratorId} onChange={(event) => setCollaboratorId(event.target.value)} required>
                <option value="">Selecione o colaborador</option>
                {currentCollaborators.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select></label>
              <label className="sienge-pin-field"><span>PIN de quem entrega *</span><input type="password" inputMode="numeric" pattern="\d{6,12}" minLength={6} maxLength={12} value={delivererPin} onChange={(event) => setDelivererPin(event.target.value)} required /><small>A assinatura cadastrada no perfil do usuário será validada no envio.</small></label>
              <SignaturePad value={recipientSignature} onChange={setRecipientSignature} />
            </>}
            <label className="sienge-notes-field"><span>Observações</span><textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="sienge-confirmation">
              <ShieldCheck size={16} />
              <p>A operação será enviada em um único documento ao Sienge. Revise centro, itens, quantidades e apropriações.</p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setOperation(null)}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={busy || operationLines.some((line) =>
                !line.quantity || Number(line.quantity) <= 0 || Number(line.quantity) > line.item.quantity) ||
                Math.abs(sourceTotal - 100) > 0.00000001 ||
                (operation.type === 'transfer' && (!destinationCostCenterId || Math.abs(destinationTotal - 100) > 0.00000001 ||
                  operationLines.some((line) => !line.destinationResourceId || Number(line.destinationResourceId) < 1))) ||
                (operation.type === 'epi_delivery' && (!collaboratorId || !recipientSignature))}>
                {busy ? <LoaderCircle className="sienge-stock-spin" size={15} /> : <ShieldCheck size={15} />}
                {busy ? 'Enviando...' : 'Confirmar e enviar'}
              </button>
            </footer>
          </form>
        </section>
      </div>}
    </section>
  )
}
