import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpFromLine, Check, CircleAlert, Download, Package, Pencil, Plus, RotateCcw, Search, ShieldCheck, ToolCase, Trash2, UserRound } from 'lucide-react'
import { apiRequest } from './api/client'
import './InventoryPage.css'

type DocumentType = 'entry' | 'exit' | 'epi_delivery' | 'tool_delivery' | 'tool_return' | 'transfer'

interface InventoryLocation {
  id: number
  name: string
  isActive: boolean
}

interface InventoryType {
  id: number
  label: string
  isSystem: boolean
}

interface Conversion {
  unitName: string
  factorToBase: number
}

interface InventoryItem {
  id: number
  name: string
  typeId: number
  typeLabel: string
  baseUnit: string
  minimumStock: number
  isActive: boolean
  stockQuantity: number
  locationStock: { locationId: number; locationName: string; quantity: number }[]
  conversions: Conversion[]
}

interface InventoryCollaborator {
  id: number
  name: string
  roleLabel: string
  isActive: boolean
  isOnLeave: boolean
}

interface ToolAssignment {
  sourceDeliveryItemId: number
  documentId: number
  transactionDate: string
  locationId: number
  locationName: string
  collaboratorId: number
  collaboratorName: string
  itemId: number
  itemName: string
  baseUnit: string
  issuedQuantity: number
  returnedQuantity: number
  outstandingQuantity: number
}

interface InventoryData {
  types: InventoryType[]
  locations: InventoryLocation[]
  items: InventoryItem[]
  collaborators: InventoryCollaborator[]
  toolAssignments: ToolAssignment[]
}

interface ItemForm {
  name: string
  typeId: number
  baseUnit: string
  minimumStock: string
  conversions: { unitName: string; factorToBase: string }[]
  isActive: boolean
}

interface DocumentLine {
  itemId: number
  quantity: string
  unitName: string
  sourceDeliveryItemId?: number
}

const documentLabels: Record<DocumentType, string> = {
  entry: 'Entrada de estoque',
  exit: 'Saída de estoque',
  epi_delivery: 'Entrega de EPI',
  tool_delivery: 'Entrega de ferramentas',
  tool_return: 'Devolução de ferramentas',
  transfer: 'Transferência entre locais',
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR')
}

function displayQuantity(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value)
}

function displayConversionFactor(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value)
}

function emptyItemForm(typeId = 0): ItemForm {
  return { name: '', typeId, baseUnit: '', minimumStock: '0', conversions: [], isActive: true }
}

function SignaturePad({ label, value, onChange }: { label: string; value: string; onChange: (signature: string | null) => void }) {
  const [drawing, setDrawing] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  function point(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>) {
    const bounds = canvas.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) }
  }

  function begin(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget
    const context = canvas.getContext('2d')
    const position = point(canvas, event)
    if (!context) return
    canvas.setPointerCapture(event.pointerId)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.beginPath()
    context.moveTo(position.x, position.y)
    setDrawing(true)
    setHasInk(false)
    onChange(null)
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const position = point(event.currentTarget, event)
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#183f70'
    context.lineTo(position.x, position.y)
    context.stroke()
    setHasInk(true)
  }

  function finish() {
    setDrawing(false)
    if (!hasInk) return
    onChange(canvasRef.current?.toDataURL('image/png').split(',')[1] ?? null)
  }

  function clear() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className="inventory-signature">
      <label>{label} *</label>
      <canvas ref={canvasRef} width={720} height={180} aria-label={`Assinatura: ${label}`} onPointerDown={begin} onPointerMove={draw} onPointerUp={finish} onPointerCancel={finish} />
      <div><small>{value ? 'Assinatura coletada' : 'Assine dentro do quadro'}</small><button type="button" className="inventory-link-button" onClick={clear}>Limpar</button></div>
    </div>
  )
}

export default function InventoryPage() {
  const [data, setData] = useState<InventoryData>({ types: [], locations: [], items: [], collaborators: [], toolAssignments: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [itemForm, setItemForm] = useState<ItemForm | null>(null)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [documentType, setDocumentType] = useState<DocumentType | null>(null)
  const [transactionDate, setTransactionDate] = useState('')
  const [collaboratorId, setCollaboratorId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [destinationLocationId, setDestinationLocationId] = useState('')
  const [newLocationName, setNewLocationName] = useState('')
  const [delivererPin, setDelivererPin] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [recipientSignature, setRecipientSignature] = useState<string | null>(null)

  async function load() {
    try {
      const result = await apiRequest<InventoryData>('/api/inventory')
      setData(result)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar o estoque.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [])

  const activeItems = data.items.filter((item) => item.isActive)
  const lowStockItems = activeItems.filter((item) => item.minimumStock > 0 && item.stockQuantity <= item.minimumStock)
  const filteredItems = useMemo(() => data.items.filter((item) => [
    item.name, item.typeLabel, item.baseUnit,
  ].some((field) => field.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))), [data.items, search])
  const currentCollaborator = data.collaborators.find((person) => String(person.id) === collaboratorId)
  const toolAssignments = data.toolAssignments.filter((assignment) =>
    (!collaboratorId || assignment.collaboratorId === Number(collaboratorId)) &&
    (!locationId || assignment.locationId === Number(locationId)))
  const activeLocations = data.locations.filter((location) => location.isActive)
  const deliveryItems = activeItems.filter((item) => documentType === 'epi_delivery'
    ? item.typeLabel.toLocaleLowerCase('pt-BR') === 'epi'
    : documentType === 'tool_delivery'
      ? item.typeLabel.toLocaleLowerCase('pt-BR') === 'ferramenta'
      : documentType === 'exit'
        ? !['epi', 'ferramenta'].includes(item.typeLabel.toLocaleLowerCase('pt-BR'))
        : true)

  function beginItem(item?: InventoryItem) {
    setEditingItemId(item?.id ?? null)
    setItemForm(item ? {
      name: item.name,
      typeId: item.typeId,
      baseUnit: item.baseUnit,
      minimumStock: String(item.minimumStock),
      conversions: item.conversions.map((conversion) => ({ unitName: conversion.unitName, factorToBase: String(conversion.factorToBase) })),
      isActive: item.isActive,
    } : emptyItemForm(data.types[0]?.id ?? 0))
    setNotice(null)
  }

  function beginDocument(type: DocumentType) {
    setDocumentType(type)
    setTransactionDate(dateString(new Date()))
    setCollaboratorId('')
    setLocationId('')
    setDestinationLocationId('')
    setNotes('')
    setLines([])
    setDelivererPin('')
    setRecipientSignature(null)
    setNotice(null)
  }

  function addLine() {
    if (documentType === 'tool_return') {
      if (!collaboratorId) return
      const assignment = toolAssignments.find((entry) => !lines.some((line) => line.sourceDeliveryItemId === entry.sourceDeliveryItemId))
      if (!assignment) return
      setLines((current) => [...current, {
        itemId: assignment.itemId,
        quantity: '',
        unitName: assignment.baseUnit,
        sourceDeliveryItemId: assignment.sourceDeliveryItemId,
      }])
      return
    }
    const item = deliveryItems.find((candidate) => !lines.some((line) => line.itemId === candidate.id))
    if (!item) return
    setLines((current) => [...current, { itemId: item.id, quantity: '', unitName: item.baseUnit }])
  }

  function updateLine(index: number, update: Partial<DocumentLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line))
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemForm) return
    setBusy(true)
    setNotice(null)
    try {
      const payload = {
        ...itemForm,
        minimumStock: Number(itemForm.minimumStock),
        conversions: itemForm.conversions.map((conversion) => ({
          unitName: conversion.unitName,
          factorToBase: Number(conversion.factorToBase),
        })),
      }
      if (editingItemId) {
        await apiRequest(`/api/inventory/items/${editingItemId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiRequest('/api/inventory/items', { method: 'POST', body: JSON.stringify(payload) })
      }
      setItemForm(null)
      setNotice({ kind: 'success', text: editingItemId ? 'Insumo atualizado.' : 'Insumo cadastrado.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o insumo.' })
    } finally {
      setBusy(false)
    }
  }

  async function saveType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const label = new FormData(form).get('typeName')?.toString().trim() ?? ''
    if (!label) return
    setBusy(true)
    try {
      await apiRequest('/api/inventory/types', { method: 'POST', body: JSON.stringify({ label }) })
      form.reset()
      setNotice({ kind: 'success', text: 'Tipo de insumo cadastrado.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível cadastrar o tipo.' })
    } finally {
      setBusy(false)
    }
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newLocationName.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      await apiRequest('/api/inventory/locations', {
        method: 'POST',
        body: JSON.stringify({ name: newLocationName.trim() }),
      })
      setNewLocationName('')
      setNotice({ kind: 'success', text: 'Local de estoque cadastrado.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível cadastrar o local.' })
    } finally {
      setBusy(false)
    }
  }

  async function toggleLocation(location: InventoryLocation) {
    setBusy(true)
    setNotice(null)
    try {
      await apiRequest(`/api/inventory/locations/${location.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: location.name, isActive: !location.isActive }),
      })
      setNotice({ kind: 'success', text: location.isActive ? 'Local inativado.' : 'Local reativado.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o local.' })
    } finally {
      setBusy(false)
    }
  }

  function availableAtLocation(itemId: number, selectedLocationId: string) {
    const item = data.items.find((candidate) => candidate.id === itemId)
    return item?.locationStock.find((balance) => balance.locationId === Number(selectedLocationId))?.quantity ?? 0
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!documentType || !lines.length || lines.some((line) => !line.quantity || Number(line.quantity) <= 0)) {
      setNotice({ kind: 'error', text: 'Adicione ao menos um insumo com quantidade válida.' })
      return
    }
    const requiresSignatures = ['epi_delivery', 'tool_delivery', 'tool_return'].includes(documentType)
    if (requiresSignatures && (!/^\d{6,12}$/.test(delivererPin) || !recipientSignature)) {
      setNotice({ kind: 'error', text: 'Informe o PIN do perfil de quem entrega e colete a assinatura de quem recebe.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await apiRequest('/api/inventory/documents', {
        method: 'POST',
        body: JSON.stringify({
          documentType,
          transactionDate,
          collaboratorId: requiresSignatures ? Number(collaboratorId) : null,
          locationId: documentType === 'transfer' ? null : Number(locationId),
          sourceLocationId: documentType === 'transfer' ? Number(locationId) : null,
          destinationLocationId: documentType === 'transfer' ? Number(destinationLocationId) : null,
          delivererPin: requiresSignatures ? delivererPin : undefined,
          recipientSignatureBase64: recipientSignature ?? undefined,
          notes,
          items: lines.map((line) => ({
            itemId: line.itemId,
            quantity: Number(line.quantity),
            unitName: line.unitName,
            sourceDeliveryItemId: line.sourceDeliveryItemId,
          })),
        }),
      })
      setDocumentType(null)
      setNotice({ kind: 'success', text: 'Movimentação registrada e estoque atualizado.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível registrar a movimentação.' })
    } finally {
      setBusy(false)
    }
  }

  async function downloadReport() {
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const reportItems = data.items.filter((item) => item.isActive || item.stockQuantity !== 0)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(17)
      pdf.text('Relatório de estoque · Assistência técnica', 14, 18)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(`Emitido em ${new Date().toLocaleString('pt-BR')} · ${reportItems.length} insumos com saldo ou ativos`, 14, 25)
      let y = 36
      const columns = ['Insumo', 'Tipo', 'Local', 'Estoque', 'Unidade-base', 'Mínimo', 'Situação']
      const positions = [14, 83, 131, 178, 215, 249, 273]
      pdf.setFillColor(27, 70, 108)
      pdf.rect(12, y - 6, 273, 9, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold')
      columns.forEach((column, index) => pdf.text(column, positions[index], y))
      y += 10
      pdf.setTextColor(43, 62, 79)
      pdf.setFont('helvetica', 'normal')
      for (const item of reportItems) {
        const balances = item.locationStock.length
          ? item.locationStock
          : [{ locationId: 0, locationName: '—', quantity: item.stockQuantity }]
        for (const balance of balances) {
          if (y > 190) {
            pdf.addPage()
            y = 18
          }
          const low = item.minimumStock > 0 && item.stockQuantity <= item.minimumStock
          const values = [
            item.name.slice(0, 38),
            item.typeLabel.slice(0, 25),
            balance.locationName.slice(0, 25),
            displayQuantity(balance.quantity),
            item.baseUnit,
            item.minimumStock > 0 ? displayQuantity(item.minimumStock) : '—',
            !item.isActive ? 'Inativo' : low ? 'Estoque baixo' : 'Regular',
          ]
          values.forEach((value, index) => pdf.text(value, positions[index], y))
          pdf.setDrawColor(224, 232, 239)
          pdf.line(12, y + 3, 285, y + 3)
          y += 9
        }
      }
      pdf.save('relatorio-estoque-assistencia-tecnica.pdf')
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível gerar o relatório.' })
    }
  }

  const pageHeading = (
    <div className="page-heading-row inventory-heading">
      <div><div className="eyebrow page-eyebrow">ASSISTÊNCIA TÉCNICA</div><h1>Gestão de estoque</h1><p>Insumos, movimentações, kits de EPI e ferramentas da equipe.</p></div>
      <div className="inventory-heading-actions"><button className="secondary-button" type="button" onClick={() => void downloadReport()}><Download size={15} /> Emitir relatório</button><button className="primary-button" type="button" onClick={() => beginItem()}><Plus size={16} /> Cadastrar insumo</button></div>
    </div>
  )

  return (
    <section className="inventory-page" aria-label="Gestão de estoque">
      {pageHeading}
      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
      {!itemForm && !documentType && <>
        <div className="inventory-summary-grid">
          <article><Package size={18} /><span>Insumos ativos</span><strong>{activeItems.length}</strong></article>
          <article className={lowStockItems.length ? 'inventory-summary-alert' : ''}><AlertTriangle size={18} /><span>Estoque no mínimo</span><strong>{lowStockItems.length}</strong></article>
          <article><ShieldCheck size={18} /><span>Itens EPI</span><strong>{activeItems.filter((item) => item.typeLabel.toLocaleLowerCase('pt-BR') === 'epi').length}</strong></article>
          <article><ToolCase size={18} /><span>Ferramentas em uso</span><strong>{data.toolAssignments.length}</strong></article>
        </div>
        {lowStockItems.length > 0 && <aside className="inventory-low-stock" role="status"><AlertTriangle size={17} /><div><strong>Atenção: estoque mínimo atingido</strong><span>{lowStockItems.map((item) => `${item.name}: ${displayQuantity(item.stockQuantity)} ${item.baseUnit} no total (mínimo ${displayQuantity(item.minimumStock)} ${item.baseUnit})`).join(' · ')}</span></div></aside>}
        <div className="inventory-actions">
          <label className="inventory-search"><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo ou tipo" /></label>
          <div>
            <button type="button" className="secondary-button" onClick={() => beginDocument('entry')}><ArrowDownToLine size={15} /> Entrada</button>
            <button type="button" className="secondary-button" onClick={() => beginDocument('exit')}><ArrowUpFromLine size={15} /> Saída</button>
            <button type="button" className="secondary-button" onClick={() => beginDocument('epi_delivery')}><ShieldCheck size={15} /> Kit de EPI</button>
            <button type="button" className="secondary-button" onClick={() => beginDocument('tool_delivery')}><ToolCase size={15} /> Entregar ferramenta</button>
            <button type="button" className="secondary-button" onClick={() => beginDocument('tool_return')}><RotateCcw size={15} /> Devolver ferramenta</button>
            <button type="button" className="secondary-button" onClick={() => beginDocument('transfer')}><ArrowLeftRight size={15} /> Transferir</button>
          </div>
        </div>
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead><tr><th>Insumo</th><th>Tipo</th><th>Estoque total</th><th>Unidade</th><th>Estoque por local</th><th>Mínimo total</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>{loading && !data.items.length
              ? <tr><td colSpan={8} className="inventory-empty">Carregando estoque...</td></tr>
              : filteredItems.length ? filteredItems.map((item) => {
                const low = item.isActive && item.minimumStock > 0 && item.stockQuantity <= item.minimumStock
                return <tr key={item.id} className={!item.isActive ? 'inventory-item-inactive' : ''}>
                  <td><strong>{item.name}</strong></td><td>{item.typeLabel}</td>
                  <td><strong className={low ? 'inventory-stock-low' : ''}>{displayQuantity(item.stockQuantity)}</strong></td>
                  <td>{item.baseUnit}{item.conversions.length > 0 && <small className="inventory-unit-conversions">{item.conversions.map((unit) => `1 ${unit.unitName} = ${displayConversionFactor(unit.factorToBase)} ${item.baseUnit}`).join(' · ')}</small>}</td>
                  <td><div className="inventory-location-balances">{item.locationStock.map((balance) => <span key={balance.locationId}><strong>{balance.locationName}</strong>{displayQuantity(balance.quantity)} {item.baseUnit}</span>)}</div></td>
                  <td>{item.minimumStock > 0 ? `${displayQuantity(item.minimumStock)} ${item.baseUnit}` : '—'}</td>
                  <td><span className={`inventory-status ${low ? 'low' : item.isActive ? 'good' : 'inactive'}`}>{!item.isActive ? 'Inativo' : low ? 'Estoque baixo' : 'Regular'}</span></td>
                  <td><button className="icon-button" type="button" aria-label={`Editar ${item.name}`} title="Editar insumo" onClick={() => beginItem(item)}><Pencil size={15} /></button></td>
                </tr>
              }) : <tr><td colSpan={8} className="inventory-empty">Nenhum insumo encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
        <section className="inventory-types-section">
          <div><h2>Tipos de insumo</h2><p>Tipos padrão e categorias personalizadas.</p></div>
          <form onSubmit={(event) => void saveType(event)}><input name="typeName" minLength={2} maxLength={60} placeholder="Novo tipo de insumo" aria-label="Nome do novo tipo de insumo" required /><button className="secondary-button" type="submit" disabled={busy}><Plus size={14} /> Adicionar tipo</button></form>
          <div className="inventory-type-chips">{data.types.map((type) => <span key={type.id}>{type.label}{type.isSystem && <small>Padrão</small>}</span>)}</div>
        </section>
        <section className="inventory-types-section inventory-locations-section">
          <div><h2>Locais de estoque</h2><p>Os saldos e transferências são controlados separadamente por local.</p></div>
          <form onSubmit={(event) => void saveLocation(event)}><input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} minLength={2} maxLength={120} placeholder="Novo local de estoque" aria-label="Nome do novo local" required /><button className="secondary-button" type="submit" disabled={busy}><Plus size={14} /> Adicionar local</button></form>
          <div className="inventory-type-chips">{data.locations.map((location) => <span key={location.id} className={!location.isActive ? 'inventory-location-inactive' : ''}>{location.name}<small>{location.isActive ? 'Ativo' : 'Inativo'}</small><button type="button" onClick={() => void toggleLocation(location)} disabled={busy} aria-label={`${location.isActive ? 'Inativar' : 'Reativar'} ${location.name}`}>{location.isActive ? 'Inativar' : 'Reativar'}</button></span>)}</div>
        </section>
      </>}

      {itemForm && <section className="inventory-editor">
        <header><div><span className="eyebrow">CATÁLOGO DE INSUMOS</span><h2>{editingItemId ? 'Editar insumo' : 'Cadastrar insumo'}</h2></div><button className="secondary-button" type="button" onClick={() => setItemForm(null)}><ArrowLeft size={15} /> Voltar ao estoque</button></header>
        <form onSubmit={(event) => void saveItem(event)}>
          <div className="inventory-form-grid">
            <label><span>Nome do insumo *</span><input value={itemForm.name} maxLength={160} onChange={(event) => setItemForm((form) => form && ({ ...form, name: event.target.value }))} required /></label>
            <label><span>Tipo *</span><select value={itemForm.typeId || ''} onChange={(event) => setItemForm((form) => form && ({ ...form, typeId: Number(event.target.value) }))} required><option value="">Selecione</option>{data.types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
            <label><span>Unidade-base *</span><input value={itemForm.baseUnit} maxLength={32} placeholder="Ex.: kg, unidade, litro" onChange={(event) => setItemForm((form) => form && ({ ...form, baseUnit: event.target.value }))} required /></label>
            <label><span>Estoque mínimo</span><input type="number" min="0" step="0.0001" value={itemForm.minimumStock} onChange={(event) => setItemForm((form) => form && ({ ...form, minimumStock: event.target.value }))} /><small>Use zero para não ativar o alerta.</small></label>
          </div>
          <section className="inventory-conversions">
            <div><div><h3>Unidades de conversão</h3><p>Informe quantas unidades-base existem em cada embalagem ou apresentação.</p></div><button className="secondary-button" type="button" onClick={() => setItemForm((form) => form && ({ ...form, conversions: [...form.conversions, { unitName: '', factorToBase: '' }] }))}><Plus size={14} /> Adicionar conversão</button></div>
            <p className="inventory-base-unit-note">Unidade-base: <strong>{itemForm.baseUnit || 'informe acima'}</strong> (1 = 1 unidade-base)</p>
            {itemForm.conversions.map((conversion, index) => <div className="inventory-conversion-row" key={index}>
              <label><span>Nome da unidade</span><input value={conversion.unitName} maxLength={32} placeholder="Ex.: saco de 20 kg" onChange={(event) => setItemForm((form) => form && ({ ...form, conversions: form.conversions.map((entry, i) => i === index ? { ...entry, unitName: event.target.value } : entry) }))} required /></label>
              <span className="inventory-equals">1 unidade =</span>
              <label><span>Quantidade na unidade-base</span><input type="number" min="0.000001" step="0.000001" value={conversion.factorToBase} onChange={(event) => setItemForm((form) => form && ({ ...form, conversions: form.conversions.map((entry, i) => i === index ? { ...entry, factorToBase: event.target.value } : entry) }))} required /></label>
              <strong>{itemForm.baseUnit || 'unidade-base'}</strong><button className="icon-button danger" type="button" aria-label="Remover conversão" onClick={() => setItemForm((form) => form && ({ ...form, conversions: form.conversions.filter((_, i) => i !== index) }))}><Trash2 size={15} /></button>
            </div>)}
          </section>
          {editingItemId && <label className="inventory-active-toggle"><input type="checkbox" checked={itemForm.isActive} onChange={(event) => setItemForm((form) => form && ({ ...form, isActive: event.target.checked }))} /> Insumo ativo no estoque</label>}
          <footer><button className="secondary-button" type="button" onClick={() => setItemForm(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar insumo'}</button></footer>
        </form>
      </section>}

      {documentType && <section className="inventory-editor">
        <header><div><span className="eyebrow">MOVIMENTAÇÃO DE ESTOQUE</span><h2>{documentLabels[documentType]}</h2><p>As quantidades são convertidas para a unidade-base do insumo.</p></div><button className="secondary-button" type="button" onClick={() => setDocumentType(null)}><ArrowLeft size={15} /> Voltar ao estoque</button></header>
        <form onSubmit={(event) => void saveDocument(event)}>
          <div className="inventory-form-grid">
            <label><span>Data da movimentação *</span><input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} required /></label>
            {documentType === 'transfer' ? <>
              <label><span>Local de origem *</span><select value={locationId} onChange={(event) => { setLocationId(event.target.value); setLines([]) }} required><option value="">Selecione a origem</option>{activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label><span>Local de destino *</span><select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)} required><option value="">Selecione o destino</option>{activeLocations.filter((location) => String(location.id) !== locationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            </> : <label><span>{documentType === 'tool_return' ? 'Local de devolução *' : 'Local de estoque *'}</span><select value={locationId} onChange={(event) => { setLocationId(event.target.value); if (documentType === 'tool_return') setLines([]) }} required>
              <option value="">Selecione o local</option>
              {(documentType === 'tool_return'
                ? activeLocations.filter((location) => data.toolAssignments.some((assignment) =>
                  (!collaboratorId || assignment.collaboratorId === Number(collaboratorId)) && assignment.locationId === location.id))
                : activeLocations
              ).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select></label>}
            {['epi_delivery', 'tool_delivery', 'tool_return'].includes(documentType) && <label><span>Colaborador *</span><select value={collaboratorId} onChange={(event) => { setCollaboratorId(event.target.value); setLines([]); if (documentType === 'tool_return') setLocationId('') }} required>
              <option value="">Selecione o colaborador</option>
              {(documentType === 'tool_return'
                ? [...new Map(data.toolAssignments.map((assignment) => [assignment.collaboratorId, { id: assignment.collaboratorId, name: assignment.collaboratorName }])).values()]
                : data.collaborators.filter((person) => person.isActive && !person.isOnLeave)
              ).map((person) => <option key={person.id} value={person.id}>{person.name}{'roleLabel' in person && person.roleLabel ? ` · ${person.roleLabel}` : ''}</option>)}
            </select></label>}
            {currentCollaborator && <p className="inventory-collaborator-note"><UserRound size={15} /> A entrega será vinculada ao histórico de {currentCollaborator.name}.</p>}
          </div>
          <section className="inventory-document-lines">
            <div><div><h3>Insumos</h3><p>{documentType === 'tool_return' ? 'Informe as quantidades que estão sendo devolvidas.' : documentType === 'transfer' ? 'A transferência diminui o saldo na origem e aumenta no destino.' : 'É possível reunir vários itens na mesma movimentação ou kit.'}</p></div>
              <button className="secondary-button" type="button" onClick={addLine} disabled={documentType === 'tool_return'
                ? !collaboratorId || !locationId || !toolAssignments.some((entry) => !lines.some((line) => line.sourceDeliveryItemId === entry.sourceDeliveryItemId))
                : !deliveryItems.some((item) => !lines.some((line) => line.itemId === item.id))}><Plus size={14} /> Adicionar item</button>
            </div>
            {!lines.length && <p className="inventory-lines-empty">Adicione ao menos um insumo.</p>}
            {lines.map((line, index) => {
              const item = data.items.find((candidate) => candidate.id === line.itemId)
              const assignment = line.sourceDeliveryItemId ? data.toolAssignments.find((entry) => entry.sourceDeliveryItemId === line.sourceDeliveryItemId) : undefined
              const units = item ? [{ unitName: item.baseUnit, factorToBase: 1 }, ...item.conversions] : []
              const selectedUnit = units.find((unit) => unit.unitName === line.unitName)
              const quantityLimit = assignment && selectedUnit
                ? assignment.outstandingQuantity / selectedUnit.factorToBase
                : item && selectedUnit && ['exit', 'epi_delivery', 'tool_delivery', 'transfer'].includes(documentType)
                  ? availableAtLocation(item.id, locationId) / selectedUnit.factorToBase
                  : undefined
              return <div className="inventory-document-line" key={`${line.sourceDeliveryItemId ?? line.itemId}-${index}`}>
                {documentType === 'tool_return' ? <label><span>Ferramenta entregue *</span><select value={line.sourceDeliveryItemId ?? ''} onChange={(event) => {
                  const next = data.toolAssignments.find((entry) => entry.sourceDeliveryItemId === Number(event.target.value))
                  if (next) updateLine(index, { itemId: next.itemId, sourceDeliveryItemId: next.sourceDeliveryItemId, unitName: next.baseUnit, quantity: '' })
                }}>
                  {toolAssignments.filter((entry) => entry.sourceDeliveryItemId === line.sourceDeliveryItemId || !lines.some((other, otherIndex) => otherIndex !== index && other.sourceDeliveryItemId === entry.sourceDeliveryItemId)).map((entry) => <option key={entry.sourceDeliveryItemId} value={entry.sourceDeliveryItemId}>{entry.itemName} · pendente {displayQuantity(entry.outstandingQuantity)} {entry.baseUnit} · {entry.locationName} · entrega {displayDate(entry.transactionDate)}</option>)}
                </select></label> : <label><span>Insumo *</span><select value={line.itemId} onChange={(event) => {
                  const next = deliveryItems.find((candidate) => candidate.id === Number(event.target.value))
                  if (next) updateLine(index, { itemId: next.id, unitName: next.baseUnit })
                }}>{deliveryItems.filter((candidate) => candidate.id === line.itemId || !lines.some((other, otherIndex) => otherIndex !== index && other.itemId === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.typeLabel}</option>)}</select></label>}
                <label className="inventory-line-quantity"><span>Quantidade *</span><input type="number" min="0.0001" step="0.0001" max={quantityLimit} value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} required /></label>
                <label><span>Unidade *</span><select value={line.unitName} onChange={(event) => updateLine(index, { unitName: event.target.value })}>{units.map((unit) => <option key={unit.unitName} value={unit.unitName}>{unit.unitName}</option>)}</select></label>
                {assignment && <small className="inventory-return-remaining">Disponível para devolução: {displayQuantity(assignment.outstandingQuantity)} {assignment.baseUnit}</small>}
                <button className="icon-button danger" type="button" aria-label="Remover insumo" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={15} /></button>
              </div>
            })}
          </section>
          {['epi_delivery', 'tool_delivery', 'tool_return'].includes(documentType) && <section className="inventory-signatures">
            <h3>Confirmação de entrega</h3><p>A assinatura de quem entrega será recuperada do perfil e usada após a validação do PIN. A assinatura de quem recebe será armazenada criptografada na ficha do colaborador.</p>
            <div className="inventory-deliverer-pin"><label><span>PIN de assinatura do perfil *</span><input type="password" inputMode="numeric" autoComplete="current-password" minLength={6} maxLength={12} pattern="[0-9]{6,12}" value={delivererPin} onChange={(event) => setDelivererPin(event.target.value)} required /><small>O PIN será validado no servidor ao registrar a movimentação.</small></label><ShieldCheck size={24} /></div>
            <div><SignaturePad label="Assinatura de quem recebe" value={recipientSignature ?? ''} onChange={setRecipientSignature} /></div>
          </section>}
          <label className="inventory-notes"><span>Observações</span><textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
          <footer><button className="secondary-button" type="button" onClick={() => setDocumentType(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Registrando...' : 'Registrar movimentação'}</button></footer>
        </form>
      </section>}
    </section>
  )
}
