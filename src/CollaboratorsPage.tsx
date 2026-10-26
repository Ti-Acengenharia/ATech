import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { apiRequest } from './api/client'

interface RoleOption {
  value: string
  label: string
}

const defaultRoleOptions: RoleOption[] = [
  { value: 'pedreiro', label: 'Pedreiro' },
  { value: 'ajudante', label: 'Ajudante' },
  { value: 'pintor', label: 'Pintor' },
  { value: 'eletricista', label: 'Eletricista' },
  { value: 'encanador', label: 'Encanador' },
  { value: 'fornecedor_terceirizado', label: 'Fornecedor terceirizado' },
  { value: 'analista', label: 'Analista' },
  { value: 'assistente', label: 'Assistente' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'encarregado', label: 'Encarregado' },
] as const

const genderOptions = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'outro', label: 'Outro' },
  { value: 'nao_informar', label: 'Prefere não informar' },
] as const

type CollaboratorRole = string
type CollaboratorGender = typeof genderOptions[number]['value']

interface Collaborator {
  id: string
  photo_url: string | null
  name: string
  nickname: string
  registration_number: string | null
  role: CollaboratorRole
  role_label: string
  age_years: number
  age_months: number
  age_days: number
  elapsed_years: number
  elapsed_months: number
  elapsed_days: number
  is_active: boolean
  is_on_leave: boolean
  programming_count: number
  shirt_size: string | null
  shirt_short_sleeve_qty: number
  shirt_long_sleeve_qty: number
  pants_size: number | null
  boot_size: number | null
}

interface ChildRecord {
  name: string
  birthDate: string
  gender: CollaboratorGender
}

interface CollaboratorReport {
  id: string
  name: string
  nickname: string
  registrationNumber: string
  role: CollaboratorRole
  cpf: string
  phone: string
  gender: CollaboratorGender
  birthDate: string
  admissionDate: string
  terminationDate: string | null
  isOnLeave: boolean
  leaveStartDate: string | null
  expectedReturnDate: string | null
  leaveReason: string | null
  hasChildren: boolean
  children: ChildRecord[]
  photoUrl: string | null
  uniform: {
    shirtSizeId: number | null
    shirtSize: string | null
    shirtShortSleeveQty: number
    shirtLongSleeveQty: number
    pantsSize: number | null
    bootSize: number | null
  }
  leaveHistory: { id: number; startDate: string; expectedReturnDate: string; reason: string; current: boolean; endedAt: string | null }[]
  uniformDeliveries: {
    id: number
    deliveryDate: string
    shirtSize: string | null
    shirtShortSleeveQty: number
    shirtLongSleeveQty: number
    pantsSize: number | null
    pantsQty: number
    bootSize: number | null
    bootQty: number
    delivererName: string
    delivererSignatureBase64: string
    recipientSignatureBase64: string
  }[]
  inventoryDeliveries: {
    id: number
    deliveryDate: string
    type: 'epi_delivery' | 'tool_delivery' | 'tool_return'
    delivererName: string
    delivererSignatureBase64: string
    recipientSignatureBase64: string
    items: { name: string; quantity: number; unitName: string }[]
  }[]
}

interface UniformOptions {
  shirtSizes: { id: number; name: string }[]
  pantsSizes: number[]
  bootSizes: number[]
}

interface UniformDeliveryForm {
  deliveryDate: string
  shirtSizeId: number | null
  shirtShortSleeveQty: number
  shirtLongSleeveQty: number
  pantsSize: number | null
  pantsQty: number
  bootSize: number | null
  bootQty: number
}

interface CollaboratorForm {
  name: string
  nickname: string
  registrationNumber: string
  role: CollaboratorRole
  cpf: string
  phone: string
  gender: CollaboratorGender
  birthDate: string
  admissionDate: string
  terminationDate: string
  isOnLeave: boolean
  leaveStartDate: string
  expectedReturnDate: string
  leaveReason: string
  hasChildren: boolean
  children: ChildRecord[]
}

function emptyForm(): CollaboratorForm {
  return {
    name: '',
    nickname: '',
    registrationNumber: '',
    role: 'pedreiro',
    cpf: '',
    phone: '',
    gender: 'nao_informar',
    birthDate: '',
    admissionDate: localDateString(new Date()),
    terminationDate: '',
    isOnLeave: false,
    leaveStartDate: '',
    expectedReturnDate: '',
    leaveReason: '',
    hasChildren: false,
    children: [],
  }
}

function cpfMask(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function formatCpf(value: string) {
  return cpfMask(value)
}

function formatDate(value: string | null) {
  if (!value) return 'Não informado'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function formatAge(person: Collaborator) {
  return `${person.age_years}a ${person.age_months}m ${person.age_days}d`
}

function formatElapsed(person: Collaborator) {
  return `${person.elapsed_years}a ${person.elapsed_months}m ${person.elapsed_days}d`
}

function roleLabel(value: CollaboratorRole, roles: RoleOption[], label?: string) {
  return label ?? roles.find((role) => role.value === value)?.label ?? value.replaceAll('_', ' ')
}

function dateForInput(value: string) {
  return value.slice(0, 10)
}

async function imageDataUrl(url: string) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Não foi possível carregar uma foto para o relatório.')
  const blob = await response.blob()
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      throw new Error('Não foi possível converter a foto para o PDF.')
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' as const }
  }
  return await new Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Não foi possível preparar a foto para o relatório.'))
        return
      }
      resolve({ dataUrl: reader.result, format: blob.type === 'image/png' ? 'PNG' : 'JPEG' })
    }
    reader.onerror = () => reject(new Error('Não foi possível preparar a foto para o relatório.'))
    reader.readAsDataURL(blob)
  })
}

export default function CollaboratorsPage() {
  const reportPickerRef = useRef<HTMLElement>(null)
  const deliveryPanelRef = useRef<HTMLElement>(null)
  const recipientCanvasRef = useRef<HTMLCanvasElement>(null)
  const recipientDrawing = useRef(false)
  const recipientInk = useRef(false)
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>(defaultRoleOptions)
  const [newRoleLabel, setNewRoleLabel] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(() => new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState<CollaboratorForm>(() => emptyForm())
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportPickerOpen, setReportPickerOpen] = useState(false)
  const [selectedReportType, setSelectedReportType] = useState<'list' | 'uniforms' | 'report' | null>(null)
  const [selectedReportCollaborator, setSelectedReportCollaborator] = useState('')
  const [reportCollaborators, setReportCollaborators] = useState<Collaborator[]>([])
  const [report, setReport] = useState<CollaboratorReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uniformOptions, setUniformOptions] = useState<UniformOptions>({ shirtSizes: [], pantsSizes: [], bootSizes: [] })
  const [newShirtSize, setNewShirtSize] = useState('')
  const [uniformForm, setUniformForm] = useState<UniformDeliveryForm>(() => ({
    ...emptyDeliveryForm(),
    shirtShortSleeveQty: 0,
    shirtLongSleeveQty: 0,
    pantsQty: 0,
    bootQty: 0,
  }))
  const [deliveryCollaborator, setDeliveryCollaborator] = useState<Collaborator | null>(null)
  const [deliveryForm, setDeliveryForm] = useState<UniformDeliveryForm>(() => emptyDeliveryForm())
  const [deliveryPin, setDeliveryPin] = useState('')
  const [delivererSignatureUnlocked, setDelivererSignatureUnlocked] = useState(false)
  const [recipientSignature, setRecipientSignature] = useState<string | null>(null)
  const [deliverySubmitting, setDeliverySubmitting] = useState(false)
  const [deliveryError, setDeliveryError] = useState('')

  const collaboratorGroups = Array.from(
    collaborators.reduce((groups, person) => {
      const group = groups.get(person.role) ?? {
        label: roleLabel(person.role, roleOptions, person.role_label),
        people: [] as Collaborator[],
      }
      group.people.push(person)
      groups.set(person.role, group)
      return groups
    }, new Map<string, { label: string; people: Collaborator[] }>()),
    ([key, group]) => ({ key, ...group }),
  ).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'))
  const collaboratorRows = collaboratorGroups.flatMap((group) => [
    <tr className="collaborator-role-divider" key={`role-${group.key}`}>
      <th colSpan={5}>
        {group.label}
        <span>{group.people.length} {group.people.length === 1 ? 'colaborador' : 'colaboradores'}</span>
        <button
          type="button"
          aria-expanded={!collapsedRoles.has(group.key)}
          onClick={() => setCollapsedRoles((current) => {
            const next = new Set(current)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })}
        >{collapsedRoles.has(group.key) ? 'Mostrar' : 'Recolher'}</button>
      </th>
    </tr>,
    ...(!collapsedRoles.has(group.key) ? group.people.map((person) => (
      <tr key={person.id}>
        <td><div className="collaborator-person">{person.photo_url ? <img className="collaborator-avatar collaborator-photo" src={person.photo_url} alt={`Foto de ${person.name}`} /> : <span className="collaborator-avatar">{person.name.trim().slice(0, 1).toUpperCase()}</span>}<span><strong>{person.name}</strong><small>{[person.nickname ? `“${person.nickname}”` : '', person.registration_number ? `Matrícula ${person.registration_number}` : ''].filter(Boolean).join(' · ') || 'Sem apelido ou matrícula'}</small></span></div></td>
        <td><span className="collaborator-role">{roleLabel(person.role, roleOptions, person.role_label)}</span></td>
        <td><span className="collaborator-age">{formatAge(person)}</span></td>
        <td><div className="collaborator-status-stack"><span className={`collaborator-status ${person.is_active ? 'is-active' : 'is-terminated'}`}><i />{person.is_active ? 'Ativo' : 'Desligado'} · {formatElapsed(person)}</span>{person.is_on_leave && <span className="collaborator-leave-status">Afastado</span>}</div></td>
        <td className="collaborator-actions"><button className="icon-button" type="button" title="Registrar entrega de fardamento" aria-label={`Registrar entrega para ${person.name}`} onClick={() => startDelivery(person)}><Plus size={16} /></button><button className="icon-button" type="button" title="Relatório com dados pessoais" aria-label={`Abrir relatório de ${person.name}`} onClick={() => void openReport(person.id)}><FileText size={16} /></button><button className="icon-button" type="button" title="Editar cadastro" aria-label={`Editar ${person.name}`} onClick={() => void openReport(person.id)}><Pencil size={16} /></button><button className="icon-button collaborator-delete-button" type="button" title="Excluir cadastro" aria-label={`Excluir ${person.name}`} disabled={deletingId === person.id} onClick={() => void deleteCollaborator(person.id, person.name)}><Trash2 size={16} /></button></td>
      </tr>
    )) : []),
  ])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ roles: RoleOption[] }>('/api/collaborators/roles')
      .then((result) => { if (!cancelled) setRoleOptions(result.roles) })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar as funções.' })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ search, role: roleFilter, status: statusFilter })
      apiRequest<{ collaborators: Collaborator[] }>(`/api/collaborators?${params}`)
        .then((result) => { if (!cancelled) setCollaborators(result.collaborators) })
        .catch((error: unknown) => {
          if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar colaboradores.' })
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [search, roleFilter, statusFilter, refreshKey])

  useEffect(() => {
    apiRequest<UniformOptions>('/api/collaborators/uniform-options')
      .then(setUniformOptions)
      .catch((error: unknown) => setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os tamanhos de fardamento.' }))
  }, [])

  useEffect(() => {
    if (reportPickerOpen) reportPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [reportPickerOpen])

  useEffect(() => {
    if (deliveryCollaborator) deliveryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [deliveryCollaborator])

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setPhotoFile(null)
    setPhotoPreview(null)
    setUniformForm({ ...emptyDeliveryForm(), shirtShortSleeveQty: 0, shirtLongSleeveQty: 0, pantsQty: 0, bootQty: 0 })
    setNotice(null)
    setFormOpen(true)
  }

  async function openReport(id: string) {
    setReport(null)
    setReportOpen(true)
    setReportLoading(false)
    setEditingId(id)
  }

  async function revealReport() {
    if (!editingId) return
    setReportLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ report: CollaboratorReport }>(`/api/collaborators/${editingId}/report`)
      setReport(result.report)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir o relatório.' })
      setReportOpen(false)
    } finally {
      setReportLoading(false)
    }
  }

  function editReport() {
    if (!report) return
    setForm({
      name: report.name,
      nickname: report.nickname,
      registrationNumber: report.registrationNumber,
      role: report.role,
      cpf: formatCpf(report.cpf),
      phone: report.phone,
      gender: report.gender,
      birthDate: dateForInput(report.birthDate),
      admissionDate: dateForInput(report.admissionDate),
      terminationDate: report.terminationDate ? dateForInput(report.terminationDate) : '',
      isOnLeave: report.isOnLeave,
      leaveStartDate: report.leaveStartDate ? dateForInput(report.leaveStartDate) : '',
      expectedReturnDate: report.expectedReturnDate ? dateForInput(report.expectedReturnDate) : '',
      leaveReason: report.leaveReason ?? '',
      hasChildren: report.hasChildren,
      children: report.children.map((child) => ({ ...child, birthDate: dateForInput(child.birthDate) })),
    })
    setPhotoFile(null)
    setPhotoPreview(collaborators.find((person) => person.id === report.id)?.photo_url ?? null)
    setUniformForm({
      ...emptyDeliveryForm(),
      shirtSizeId: report.uniform.shirtSizeId,
      shirtShortSleeveQty: report.uniform.shirtShortSleeveQty,
      shirtLongSleeveQty: report.uniform.shirtLongSleeveQty,
      pantsSize: report.uniform.pantsSize,
      bootSize: report.uniform.bootSize,
    })
    setReportOpen(false)
    setReport(null)
    setFormOpen(true)
  }

  function closeReport() {
    setReportOpen(false)
    setReport(null)
    setEditingId(null)
  }

  async function beginReportSelection() {
    setSelectedReportType(null)
    setSelectedReportCollaborator('')
    try {
      const result = await apiRequest<{ collaborators: Collaborator[] }>('/api/collaborators?search=&role=all&status=all&limit=5000')
      setReportCollaborators(result.collaborators)
      setReportPickerOpen(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar a lista de colaboradores.' })
    }
  }

  function confirmReportSelection() {
    if (!selectedReportType) return
    setReportPickerOpen(false)
    if (selectedReportType === 'report') {
      if (!selectedReportCollaborator) {
        setReportPickerOpen(true)
        setNotice({ kind: 'error', text: 'Selecione o colaborador para emitir a ficha individual.' })
        return
      }
      void openReport(selectedReportCollaborator)
      return
    }
    void downloadPdf(selectedReportType)
  }

  function startDelivery(person: Collaborator) {
    setDeliveryCollaborator(person)
    setDeliveryForm(emptyDeliveryForm())
    setDeliveryPin('')
    setDelivererSignatureUnlocked(false)
    setRecipientSignature(null)
    setDeliveryError('')
  }

  function confirmDelivererPin() {
    setDeliveryError('')
    if (!/^\d{6,12}$/.test(deliveryPin)) {
      setDeliveryError('Informe o PIN numérico de 6 a 12 dígitos cadastrado no seu perfil.')
      return
    }
    setDelivererSignatureUnlocked(true)
  }

  function recipientCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = recipientCanvasRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) }
  }

  function startRecipientSignature(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = recipientCanvasRef.current
    const context = canvas?.getContext('2d')
    const position = recipientCanvasPoint(event)
    if (!canvas || !context || !position) return
    canvas.setPointerCapture(event.pointerId)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.beginPath()
    context.moveTo(position.x, position.y)
    recipientDrawing.current = true
    recipientInk.current = false
    setRecipientSignature(null)
  }

  function drawRecipientSignature(event: PointerEvent<HTMLCanvasElement>) {
    if (!recipientDrawing.current) return
    const context = recipientCanvasRef.current?.getContext('2d')
    const position = recipientCanvasPoint(event)
    if (!context || !position) return
    context.lineWidth = 3
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#183f70'
    context.lineTo(position.x, position.y)
    context.stroke()
    recipientInk.current = true
  }

  function finishRecipientSignature() {
    if (!recipientDrawing.current) return
    recipientDrawing.current = false
    if (!recipientInk.current) return
    setRecipientSignature(recipientCanvasRef.current?.toDataURL('image/png').split(',')[1] ?? null)
    recipientInk.current = false
  }

  async function saveUniformDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deliveryCollaborator || !delivererSignatureUnlocked || !recipientSignature) {
      setDeliveryError('Desbloqueie a assinatura de quem entrega e colete a assinatura de quem recebe.')
      return
    }
    setDeliverySubmitting(true)
    setDeliveryError('')
    try {
      await apiRequest(`/api/collaborators/${deliveryCollaborator.id}/uniform-deliveries`, {
        method: 'POST',
        body: JSON.stringify({ ...deliveryForm, delivererPin: deliveryPin, recipientSignatureBase64: recipientSignature }),
      })
      setDeliveryCollaborator(null)
      setNotice({ kind: 'success', text: `Entrega de fardamento registrada para ${deliveryCollaborator.name}.` })
      if (report?.id === deliveryCollaborator.id) {
        setReport(null)
        setReportOpen(false)
      }
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : 'Não foi possível registrar a entrega.')
    } finally {
      setDeliverySubmitting(false)
    }
  }

  async function addShirtSize() {
    const name = newShirtSize.trim()
    if (!name) return
    setDeliveryError('')
    try {
      const result = await apiRequest<{ shirtSize: { id: number; name: string } }>('/api/collaborators/shirt-sizes', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setUniformOptions((current) => ({ ...current, shirtSizes: [...current.shirtSizes, result.shirtSize].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }))
      setNewShirtSize('')
      setNotice({ kind: 'success', text: `Tamanho de camisa "${result.shirtSize.name}" adicionado ao catálogo.` })
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : 'Não foi possível adicionar o tamanho.')
    }
  }

  async function downloadPdf(kind: 'list' | 'uniforms' | 'report') {
    try {
      const { jsPDF } = await import('jspdf')
      const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      if (kind === 'report' && !report) throw new Error('Abra a ficha do colaborador antes de gerar o PDF.')
      const people = kind === 'report' ? [] : (await apiRequest<{ collaborators: Collaborator[] }>('/api/collaborators?search=&role=all&status=all&limit=5000')).collaborators
      if (kind !== 'report' && !people.length) {
        setNotice({ kind: 'error', text: 'Não há colaboradores para incluir neste relatório.' })
        return
      }

      const pageWidth = document.internal.pageSize.getWidth()
      const pageHeight = document.internal.pageSize.getHeight()
      const margin = 14
      const contentWidth = pageWidth - margin * 2
      const titles = {
        list: 'COLABORADORES E FUNÇÕES',
        uniforms: 'FARDAMENTOS E TAMANHOS',
        report: 'FICHA INDIVIDUAL DO COLABORADOR',
      }
      let y = 0
      const drawHeader = () => {
        document.setFillColor(22, 62, 96)
        document.rect(0, 0, pageWidth, 27, 'F')
        document.setFillColor(79, 158, 211)
        document.rect(0, 27, pageWidth, 1.4, 'F')
        document.setTextColor(255, 255, 255)
        document.setFont('helvetica', 'bold')
        document.setFontSize(13)
        document.text('ATECH  /  RELATÓRIOS DA EQUIPE', margin, 11)
        document.setFontSize(10)
        document.text(titles[kind], margin, 20)
        document.setFont('helvetica', 'normal')
        document.setFontSize(8)
        document.setTextColor(218, 232, 244)
        document.text(`Emitido em ${formatDate(localDateString(new Date()))}`, pageWidth - margin, 19, { align: 'right' })
        document.setTextColor(42, 61, 78)
        y = 36
      }
      const addPage = () => {
        document.addPage()
        drawHeader()
      }
      const ensureSpace = (height = 10) => {
        if (y + height > pageHeight - 17) addPage()
      }
      const drawSection = (label: string) => {
        ensureSpace(12)
        document.setFillColor(232, 241, 249)
        document.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F')
        document.setTextColor(38, 89, 129)
        document.setFont('helvetica', 'bold')
        document.setFontSize(8)
        document.text(label.toLocaleUpperCase('pt-BR'), margin + 3, y + 5.4)
        document.setTextColor(42, 61, 78)
        y += 12
      }
      const addPhoto = async (url: string | null, x: number, top: number, size = 12) => {
        if (!url) return
        const image = await imageDataUrl(url)
        document.addImage(image.dataUrl, image.format, x, top, size, size)
      }

      drawHeader()
      if (kind === 'report' && report) {
        document.setFillColor(247, 250, 253)
        document.setDrawColor(220, 230, 239)
        document.roundedRect(margin, y, contentWidth, 31, 3, 3, 'FD')
        await addPhoto(report.photoUrl, margin + 4, y + 4, 23)
        document.setTextColor(35, 65, 91)
        document.setFont('helvetica', 'bold')
        document.setFontSize(15)
        document.text(report.name, margin + 33, y + 11)
        document.setTextColor(71, 111, 145)
        document.setFont('helvetica', 'normal')
        document.setFontSize(9)
        document.text(roleLabel(report.role, roleOptions), margin + 33, y + 18)
        document.setFontSize(8)
        document.text(`Matrícula: ${report.registrationNumber || 'Não informada'}`, margin + 33, y + 24)
        y += 37

        drawSection('Dados pessoais e profissionais')
        const facts = [
          ['CPF', formatCpf(report.cpf) || 'Não informado'],
          ['Telefone', report.phone || 'Não informado'],
          ['Gênero', genderOptions.find((gender) => gender.value === report.gender)?.label ?? report.gender],
          ['Nascimento', formatDate(report.birthDate)],
          ['Admissão', formatDate(report.admissionDate)],
          ['Desligamento', formatDate(report.terminationDate)],
          ['Situação', report.terminationDate ? 'Desligado' : report.isOnLeave ? 'Afastado' : 'Ativo'],
          ['Filhos', report.hasChildren ? report.children.map((child) => child.name).join(', ') : 'Não'],
        ]
        const cardGap = 4
        const cardWidth = (contentWidth - cardGap * 2) / 3
        for (let index = 0; index < facts.length; index += 3) {
          ensureSpace(17)
          facts.slice(index, index + 3).forEach(([label, value], column) => {
            const x = margin + column * (cardWidth + cardGap)
            document.setFillColor(250, 252, 254)
            document.setDrawColor(229, 236, 243)
            document.roundedRect(x, y, cardWidth, 14, 1.5, 1.5, 'FD')
            document.setFont('helvetica', 'normal')
            document.setFontSize(7)
            document.setTextColor(112, 132, 151)
            document.text(label.toUpperCase(), x + 3, y + 5)
            document.setFont('helvetica', 'bold')
            document.setFontSize(8)
            document.setTextColor(47, 69, 89)
            document.text(document.splitTextToSize(value, cardWidth - 6).slice(0, 1), x + 3, y + 10)
          })
          y += 17
        }
        drawSection('Fardamento atual')
        document.setFont('helvetica', 'normal')
        document.setFontSize(9)
        document.text(`Camisa ${report.uniform.shirtSize ?? '—'}  ·  Manga curta: ${report.uniform.shirtShortSleeveQty}  ·  Manga longa: ${report.uniform.shirtLongSleeveQty}  ·  Calça: ${report.uniform.pantsSize ?? '—'}  ·  Bota: ${report.uniform.bootSize ?? '—'}`, margin + 2, y)
        y += 7

        drawSection('Histórico de afastamentos')
        if (!report.leaveHistory.length) {
          document.setFont('helvetica', 'normal')
          document.setFontSize(8)
          document.setTextColor(112, 132, 151)
          document.text('Nenhum afastamento registrado.', margin + 2, y)
          y += 7
        }
        for (const leave of report.leaveHistory) {
          const text = `${formatDate(leave.startDate)} a ${formatDate(leave.expectedReturnDate)} · ${leave.current ? 'Afastamento atual' : `Encerrado em ${formatDate(leave.endedAt)}`} · ${leave.reason}`
          const wrapped = document.splitTextToSize(text, contentWidth - 12) as string[]
          ensureSpace(wrapped.length * 4 + 8)
          document.setFillColor(250, 252, 254)
          document.roundedRect(margin, y - 3, contentWidth, wrapped.length * 4 + 6, 1.5, 1.5, 'F')
          document.setFillColor(68, 135, 183)
          document.rect(margin, y - 3, 1.4, wrapped.length * 4 + 6, 'F')
          document.setFont('helvetica', 'normal')
          document.setFontSize(8)
          document.setTextColor(54, 73, 91)
          wrapped.forEach((line, index) => document.text(line, margin + 4, y + index * 4))
          y += wrapped.length * 4 + 7
        }
        drawSection('Histórico de entregas de fardamento')
        if (!report.uniformDeliveries.length) {
          document.setFont('helvetica', 'normal')
          document.setFontSize(8)
          document.setTextColor(112, 132, 151)
          document.text('Nenhuma entrega registrada.', margin + 2, y)
          y += 7
        }
        for (const delivery of report.uniformDeliveries) {
          const details = document.splitTextToSize(
            `${formatDate(delivery.deliveryDate)} · Camisa ${delivery.shirtSize ?? '—'} (curta ${delivery.shirtShortSleeveQty}, longa ${delivery.shirtLongSleeveQty}) · Calça ${delivery.pantsSize ?? '—'} (${delivery.pantsQty}) · Bota ${delivery.bootSize ?? '—'} (${delivery.bootQty}) · Entregue por ${delivery.delivererName}`,
            contentWidth - 8,
          ) as string[]
          ensureSpace(details.length * 4 + 30)
          document.setFillColor(250, 252, 254)
          document.setDrawColor(229, 236, 243)
          document.roundedRect(margin, y - 3, contentWidth, details.length * 4 + 29, 2, 2, 'FD')
          for (const line of details) { document.setFont('helvetica', 'normal'); document.setFontSize(8); document.text(line, margin + 4, y); y += 4 }
          document.setFontSize(7)
          document.setTextColor(102, 122, 140)
          document.text('RESPONSÁVEL PELA ENTREGA', margin + 4, y + 3)
          document.text('RECEBIDO POR', margin + 91, y + 3)
          document.addImage(`data:image/png;base64,${delivery.delivererSignatureBase64}`, 'PNG', margin + 4, y + 4, 72, 18)
          document.addImage(`data:image/png;base64,${delivery.recipientSignatureBase64}`, 'PNG', margin + 91, y + 4, 72, 18)
          y += 27
        }
        drawSection('Histórico de EPI e ferramentas')
        if (!report.inventoryDeliveries.length) {
          document.setFont('helvetica', 'normal')
          document.setFontSize(8)
          document.setTextColor(112, 132, 151)
          document.text('Nenhuma entrega de EPI ou ferramenta registrada.', margin + 2, y)
          y += 7
        }
        for (const delivery of report.inventoryDeliveries) {
          const label = delivery.type === 'epi_delivery' ? 'Entrega de EPI'
            : delivery.type === 'tool_delivery' ? 'Entrega de ferramentas' : 'Devolução de ferramentas'
          const details = document.splitTextToSize(
            `${formatDate(delivery.deliveryDate)} · ${label} · ${delivery.items.map((item) => `${item.name} (${item.quantity} ${item.unitName})`).join(' · ')} · Registrado por ${delivery.delivererName}`,
            contentWidth - 8,
          ) as string[]
          ensureSpace(details.length * 4 + 30)
          document.setFillColor(250, 252, 254)
          document.setDrawColor(229, 236, 243)
          document.roundedRect(margin, y - 3, contentWidth, details.length * 4 + 29, 2, 2, 'FD')
          for (const line of details) { document.setFont('helvetica', 'normal'); document.setFontSize(8); document.text(line, margin + 4, y); y += 4 }
          document.setFontSize(7)
          document.setTextColor(102, 122, 140)
          document.text('RESPONSÁVEL PELA ENTREGA', margin + 4, y + 3)
          document.text('RECEBIDO POR', margin + 91, y + 3)
          document.addImage(`data:image/png;base64,${delivery.delivererSignatureBase64}`, 'PNG', margin + 4, y + 4, 72, 18)
          document.addImage(`data:image/png;base64,${delivery.recipientSignatureBase64}`, 'PNG', margin + 91, y + 4, 72, 18)
          y += 27
        }
      } else {
        const photoCache = new Map<string, { dataUrl: string; format: 'PNG' | 'JPEG' }>()
        const photo = async (url: string | null, x: number, top: number) => {
          if (!url) return
          let image = photoCache.get(url)
          if (!image) {
            image = await imageDataUrl(url)
            photoCache.set(url, image)
          }
          document.addImage(image.dataUrl, image.format, x, top, 13, 13)
        }
        const headers: [string, number][] = kind === 'list'
          ? [['COLABORADOR', 33], ['FUNÇÃO', 145], ['MATRÍCULA', 208], ['SITUAÇÃO', 253]]
          : [['COLABORADOR', 33], ['CAMISAS', 143], ['CALÇA', 215], ['BOTA', 250]]
        document.setFillColor(238, 243, 248)
        document.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F')
        document.setFont('helvetica', 'bold')
        document.setFontSize(7)
        document.setTextColor(82, 103, 122)
        for (const [label, x] of headers) document.text(label, x, y + 5.3)
        y += 11
        for (const person of people) {
          ensureSpace(19)
          if (Math.floor(y) % 2 === 0) {
            document.setFillColor(250, 252, 254)
            document.roundedRect(margin, y - 4, contentWidth, 17, 1.5, 1.5, 'F')
          }
          await photo(person.photo_url, margin + 2, y - 2)
          const nameX = person.photo_url ? margin + 20 : margin + 3
          document.setFont('helvetica', 'bold')
          document.setFontSize(8)
          document.setTextColor(40, 63, 84)
          document.text(document.splitTextToSize(person.name, 76).slice(0, 1), nameX, y + 3)
          document.setFont('helvetica', 'normal')
          document.setFontSize(7)
          document.setTextColor(105, 125, 143)
          document.text(person.nickname ? `“${person.nickname}”` : '—', nameX, y + 8)
          if (kind === 'list') {
            document.setTextColor(55, 79, 101)
            document.text(document.splitTextToSize(roleLabel(person.role, roleOptions, person.role_label), 46).slice(0, 1), 145, y + 4)
            document.text(person.registration_number || '—', 208, y + 4)
            document.setTextColor(person.is_active ? 52 : 156, person.is_active ? 113 : 91, person.is_active ? 81 : 82)
            document.text(person.is_active ? 'ATIVO' : 'DESLIGADO', 253, y + 4)
          } else {
            document.setTextColor(55, 79, 101)
            document.text(`${person.shirt_size ?? '—'} · curta ${person.shirt_short_sleeve_qty} · longa ${person.shirt_long_sleeve_qty}`, 143, y + 4)
            document.text(person.pants_size === null ? '—' : String(person.pants_size), 215, y + 4)
            document.text(person.boot_size === null ? '—' : String(person.boot_size), 250, y + 4)
          }
          y += 18
        }
      }
      for (let page = 1; page <= document.getNumberOfPages(); page += 1) {
        document.setPage(page)
        document.setDrawColor(222, 231, 238)
        document.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12)
        document.setFont('helvetica', 'normal')
        document.setFontSize(7)
        document.setTextColor(120, 136, 150)
        document.text('Documento interno · ATech', margin, pageHeight - 7)
        document.text(`Página ${page} de ${document.getNumberOfPages()}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
      }
      document.save(kind === 'list' ? 'colaboradores-funcoes.pdf' : kind === 'uniforms' ? 'fardamentos-colaboradores.pdf' : `ficha-${report?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível gerar o PDF.' })
    }
  }

  async function deleteCollaborator(id: string, name: string) {
    const collaborator = collaborators.find((person) => person.id === id)
    const scheduleWarning = collaborator?.programming_count
      ? `\n\nAs ${collaborator.programming_count} programação(ões) vinculada(s) também serão removidas da agenda. O histórico dos chamados será preservado.`
      : ''
    if (!window.confirm(`Excluir permanentemente o cadastro de ${name}? Os dados pessoais e foto serão removidos.${scheduleWarning}`)) return

    setDeletingId(id)
    setNotice(null)
    try {
      await apiRequest(`/api/collaborators/${id}`, { method: 'DELETE' })
      setReportOpen(false)
      setReport(null)
      setFormOpen(false)
      setEditingId(null)
      setNotice({ kind: 'success', text: `Cadastro de ${name} excluído. O histórico dos chamados foi mantido.` })
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o colaborador.' })
    } finally {
      setDeletingId(null)
    }
  }

  function updateField<K extends keyof CollaboratorForm>(field: K, value: CollaboratorForm[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function createRole() {
    const label = newRoleLabel.trim()
    if (label.length < 2) {
      setNotice({ kind: 'error', text: 'Informe um nome de função com pelo menos 2 caracteres.' })
      return
    }
    setSavingRole(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ role: RoleOption }>('/api/collaborators/roles', {
        method: 'POST',
        body: JSON.stringify({ label }),
      })
      setRoleOptions((current) => [...current, result.role].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')))
      updateField('role', result.role.value)
      setNewRoleLabel('')
      setNotice({ kind: 'success', text: `Função “${result.role.label}” cadastrada e selecionada.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível cadastrar a função.' })
    } finally {
      setSavingRole(false)
    }
  }

  function updateChild(index: number, field: keyof ChildRecord, value: string) {
    setForm((current) => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child),
    }))
  }

  async function saveCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setNotice(null)

    const payload = {
      ...form,
      cpf: form.cpf.replace(/\D/g, ''),
      terminationDate: form.terminationDate || null,
      leaveStartDate: form.isOnLeave ? form.leaveStartDate || null : null,
      expectedReturnDate: form.isOnLeave ? form.expectedReturnDate || null : null,
      leaveReason: form.isOnLeave ? form.leaveReason || null : null,
      children: form.hasChildren ? form.children : [],
    }

    try {
      let collaboratorId = editingId
      if (editingId) {
        await apiRequest(`/api/collaborators/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        const created = await apiRequest<{ id: string }>('/api/collaborators', { method: 'POST', body: JSON.stringify(payload) })
        collaboratorId = created.id
      }
      if (photoFile && collaboratorId) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto.'))
          reader.onerror = () => reject(new Error('Não foi possível ler a foto.'))
          reader.readAsDataURL(photoFile)
        })
        await apiRequest(`/api/collaborators/${collaboratorId}/photo`, {
          method: 'PUT',
          body: JSON.stringify({ contentType: photoFile.type, contentBase64: dataUrl.split(',')[1] }),
        })
      }
      if (collaboratorId) {
        await apiRequest(`/api/collaborators/${collaboratorId}/uniform`, {
          method: 'PUT',
          body: JSON.stringify({
            shirtSizeId: uniformForm.shirtSizeId,
            shirtShortSleeveQty: uniformForm.shirtShortSleeveQty,
            shirtLongSleeveQty: uniformForm.shirtLongSleeveQty,
            pantsSize: uniformForm.pantsSize,
            bootSize: uniformForm.bootSize,
          }),
        })
      }
      setFormOpen(false)
      setReportOpen(false)
      setReport(null)
      setEditingId(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setNotice({ kind: 'success', text: editingId ? 'Cadastro atualizado.' : 'Colaborador cadastrado.' })
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o cadastro.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="collaborators-page" aria-labelledby="collaborators-title">
      {!formOpen && !reportOpen && <>
      <div className="collaborators-heading">
        <div>
          <span className="eyebrow">EQUIPE DA ASSISTÊNCIA TÉCNICA</span>
          <h1 id="collaborators-title">Colaboradores</h1>
          <p>Cadastro e situação da equipe própria e terceirizada.</p>
        </div>
        <div className="collaborator-heading-actions">
          <button className="secondary-button" type="button" onClick={beginReportSelection}><FileText size={16} /> Emitir relatório</button>
          <button className="primary-button collaborator-add" type="button" onClick={startCreate}><Plus size={17} /> Novo colaborador</button>
        </div>
      </div>

      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

      <div className="collaborator-filters">
        <label className="search-box collaborator-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou apelido" aria-label="Pesquisar por nome ou apelido" /></label>
        <label className="filter-control"><span>Função</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">Todas</option>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
        <label className="filter-control"><span>Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todas</option><option value="active">Ativos</option><option value="terminated">Desligados</option></select></label>
        <button className="filter-clear-button" type="button" disabled={!search && roleFilter === 'all' && statusFilter === 'all'} onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all') }}><X size={14} /> Limpar filtros</button>
      </div>

      <div className="collaborator-list-header"><span><UsersRound size={15} /> {loading ? 'Carregando equipe...' : `${collaborators.length} ${collaborators.length === 1 ? 'colaborador' : 'colaboradores'}`}</span><span>Dados pessoais restritos</span></div>
      <div className="collaborator-table-wrap">
        <table className="collaborator-table">
          <thead><tr><th>COLABORADOR</th><th>FUNÇÃO</th><th>IDADE</th><th>SITUAÇÃO</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {loading && collaborators.length === 0 ? <tr><td colSpan={5} className="collaborator-empty">Carregando colaboradores...</td></tr> : collaborators.length === 0 ? <tr><td colSpan={5} className="collaborator-empty"><UserPlus size={22} /><strong>Nenhum colaborador encontrado</strong><span>Cadastre uma pessoa ou ajuste os filtros.</span></td></tr> : collaboratorRows}
          </tbody>
        </table>
      </div>
      <p className="collaborator-privacy-note"><ShieldAlert size={15} /> CPF, telefone e dados dos filhos não aparecem nesta lista. O relatório registra cada visualização.</p>
      {reportPickerOpen && (
        <div className="collaborator-report-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportPickerOpen(false) }}>
          <section ref={reportPickerRef} className="collaborator-report-picker" role="dialog" aria-modal="true" aria-labelledby="report-picker-title">
            <header>
              <div><span className="eyebrow">CENTRAL DE RELATÓRIOS</span><h2 id="report-picker-title">Emitir relatório</h2><p>Escolha o documento que deseja gerar em PDF.</p></div>
              <button className="icon-button" type="button" aria-label="Fechar" onClick={() => setReportPickerOpen(false)}><X size={18} /></button>
            </header>
            <div className="collaborator-report-picker-options">
              <button className={`collaborator-report-picker-option ${selectedReportType === 'list' ? 'is-selected' : ''}`} type="button" aria-pressed={selectedReportType === 'list'} onClick={() => setSelectedReportType('list')}><UsersRound size={20} /><span><strong>Lista de colaboradores e funções</strong><small>Equipe, funções, matrícula, situação e foto disponível.</small></span></button>
              <button className={`collaborator-report-picker-option ${selectedReportType === 'uniforms' ? 'is-selected' : ''}`} type="button" aria-pressed={selectedReportType === 'uniforms'} onClick={() => setSelectedReportType('uniforms')}><FileText size={20} /><span><strong>Fardamentos e tamanhos</strong><small>Tamanhos cadastrados e quantidade de camisas por tipo.</small></span></button>
              <button className={`collaborator-report-picker-option ${selectedReportType === 'report' ? 'is-selected' : ''}`} type="button" aria-pressed={selectedReportType === 'report'} onClick={() => setSelectedReportType('report')}><ShieldAlert size={20} /><span><strong>Ficha individual</strong><small>Dados pessoais, histórico e assinaturas; o acesso fica auditado.</small></span></button>
            </div>
            {selectedReportType === 'report' && <label className="form-field"><span>Colaborador *</span><select value={selectedReportCollaborator} onChange={(event) => setSelectedReportCollaborator(event.target.value)}><option value="">Selecione</option>{reportCollaborators.map((person) => <option key={person.id} value={person.id}>{person.name} · {roleLabel(person.role, roleOptions, person.role_label)}</option>)}</select></label>}
            <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setReportPickerOpen(false)}>Cancelar</button><button className="primary-button" type="button" disabled={!selectedReportType || (selectedReportType === 'report' && !selectedReportCollaborator)} onClick={confirmReportSelection}>Continuar</button></footer>
          </section>
        </div>
      )}
      </>}

      {reportOpen && (
          <section className="full-page-data report-dialog" role="region" aria-labelledby="report-title">
            <header className="dialog-header"><div><span className="eyebrow">RELATÓRIO INDIVIDUAL</span><h2 id="report-title">{report ? report.name : 'Acesso a dados pessoais'}</h2></div><button className="secondary-button page-back-button" type="button" onClick={closeReport}><ArrowLeft size={16} /> Voltar para colaboradores</button></header>
            {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
            {!report ? (
              <div className="report-warning"><span className="report-warning-icon"><ShieldAlert size={22} /></span><h3>Este relatório contém dados pessoais</h3><p>CPF, telefone, nascimento, filhos e motivo de afastamento são dados pessoais. Ao continuar, o acesso será registrado para fins de auditoria.</p><div className="report-warning-actions"><button className="secondary-button" type="button" onClick={closeReport}>Cancelar</button><button className="primary-button" type="button" onClick={() => void revealReport()} disabled={reportLoading}>{reportLoading ? 'Carregando...' : 'Confirmar e visualizar'}</button></div></div>
            ) : (
              <>
                <div className="report-data-warning"><ShieldAlert size={16} /><span>Contém dados pessoais. Compartilhe apenas quando necessário.</span></div>
                {report.photoUrl && <img className="collaborator-report-photo" src={report.photoUrl} alt={`Foto de ${report.name}`} />}
                <dl className="report-grid">
                  <div><dt>Nome</dt><dd>{report.name}</dd></div><div><dt>Apelido</dt><dd>{report.nickname || 'Não informado'}</dd></div>
                  <div><dt>Matrícula</dt><dd>{report.registrationNumber || 'Não informada'}</dd></div>
                  <div><dt>Função</dt><dd>{roleLabel(report.role, roleOptions)}</dd></div><div><dt>CPF · dado pessoal</dt><dd className="sensitive-value">{report.cpf ? formatCpf(report.cpf) : 'Não informado'}</dd></div>
                  <div><dt>Telefone · dado pessoal</dt><dd className="sensitive-value">{report.phone || 'Não informado'}</dd></div><div><dt>Gênero</dt><dd>{genderOptions.find((gender) => gender.value === report.gender)?.label ?? report.gender}</dd></div>
                  <div><dt>Data de nascimento</dt><dd>{formatDate(report.birthDate)}</dd></div><div><dt>Data de admissão</dt><dd>{formatDate(report.admissionDate)}</dd></div>
                  <div><dt>Data de desligamento</dt><dd>{formatDate(report.terminationDate)}</dd></div>
                  <div><dt>Situação</dt><dd>{report.terminationDate ? 'Desligado' : report.isOnLeave ? 'Atualmente afastado' : 'Ativo'}</dd></div>
                  {report.isOnLeave && <><div><dt>Data do afastamento</dt><dd>{formatDate(report.leaveStartDate)}</dd></div><div><dt>Retorno previsto</dt><dd>{formatDate(report.expectedReturnDate)}</dd></div><div className="report-children"><dt>Motivo do afastamento</dt><dd>{report.leaveReason}</dd></div></>}
                  <div><dt>Fardamento atual</dt><dd>Camisa {report.uniform.shirtSize ?? '—'} · curta {report.uniform.shirtShortSleeveQty} · longa {report.uniform.shirtLongSleeveQty} · calça {report.uniform.pantsSize ?? '—'} · bota {report.uniform.bootSize ?? '—'}</dd></div>
                  <div className="report-children"><dt>Filhos</dt><dd>{report.hasChildren ? report.children.map((child, index) => <span className="report-child" key={`${child.name}-${index}`}>{child.name} · {formatDate(child.birthDate)} · {genderOptions.find((gender) => gender.value === child.gender)?.label ?? 'Não informado'}</span>) : 'Não'}</dd></div>
                </dl>
                <section className="collaborator-history-section"><h3>Histórico de afastamentos</h3>{report.leaveHistory.length ? report.leaveHistory.map((leave) => <p key={leave.id}>{formatDate(leave.startDate)} a {formatDate(leave.expectedReturnDate)} · {leave.current ? 'Atual' : `Encerrado em ${formatDate(leave.endedAt)}`} · {leave.reason}</p>) : <p>Nenhum afastamento registrado.</p>}</section>
                <section className="collaborator-history-section"><h3>Entregas de fardamento</h3>{report.uniformDeliveries.length ? report.uniformDeliveries.map((delivery) => <div className="collaborator-delivery-record" key={delivery.id}><p>{formatDate(delivery.deliveryDate)} · Camisa {delivery.shirtSize ?? '—'} (curta {delivery.shirtShortSleeveQty}, longa {delivery.shirtLongSleeveQty}) · Calça {delivery.pantsSize ?? '—'} ({delivery.pantsQty}) · Bota {delivery.bootSize ?? '—'} ({delivery.bootQty}) · Entregue por {delivery.delivererName}</p><div><span>Quem entrega<img src={`data:image/png;base64,${delivery.delivererSignatureBase64}`} alt={`Assinatura de quem entregou em ${formatDate(delivery.deliveryDate)}`} /></span><span>Quem recebe<img src={`data:image/png;base64,${delivery.recipientSignatureBase64}`} alt={`Assinatura de quem recebeu em ${formatDate(delivery.deliveryDate)}`} /></span></div></div>) : <p>Nenhuma entrega registrada.</p>}</section>
                <section className="collaborator-history-section"><h3>Histórico de EPI e ferramentas</h3>{report.inventoryDeliveries.length ? report.inventoryDeliveries.map((delivery) => <div className="collaborator-delivery-record" key={`inventory-${delivery.id}`}><p>{formatDate(delivery.deliveryDate)} · {delivery.type === 'epi_delivery' ? 'Entrega de EPI' : delivery.type === 'tool_delivery' ? 'Entrega de ferramentas' : 'Devolução de ferramentas'} · {delivery.items.map((item) => `${item.name} (${item.quantity} ${item.unitName})`).join(' · ')} · Registrado por {delivery.delivererName}</p><div><span>Quem entrega<img src={`data:image/png;base64,${delivery.delivererSignatureBase64}`} alt={`Assinatura de quem entregou em ${formatDate(delivery.deliveryDate)}`} /></span><span>Quem recebe<img src={`data:image/png;base64,${delivery.recipientSignatureBase64}`} alt={`Assinatura de quem recebeu em ${formatDate(delivery.deliveryDate)}`} /></span></div></div>) : <p>Nenhuma entrega de EPI ou ferramenta registrada.</p>}</section>
                <footer className="dialog-footer"><button className="secondary-button danger-button" type="button" disabled={deletingId === report.id} onClick={() => void deleteCollaborator(report.id, report.name)}><Trash2 size={15} />{deletingId === report.id ? 'Excluindo...' : 'Excluir colaborador'}</button><button className="secondary-button" type="button" onClick={() => void downloadPdf('report')}>Ficha do colaborador (PDF)</button><button className="secondary-button" type="button" onClick={editReport}><Pencil size={15} /> Editar cadastro</button><button className="primary-button" type="button" onClick={closeReport}>Concluir</button></footer>
              </>
            )}
          </section>
      )}

      {formOpen && (
          <section className="full-page-data collaborator-form-dialog" aria-labelledby="form-title">
            <header className="dialog-header"><div><span className="eyebrow">CADASTRO DA EQUIPE</span><h2 id="form-title">{editingId ? 'Editar colaborador' : 'Novo colaborador'}</h2></div><button className="secondary-button page-back-button" type="button" onClick={() => setFormOpen(false)}><ArrowLeft size={16} /> Voltar para lista</button></header>
            {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
            <form onSubmit={(event) => void saveCollaborator(event)}>
              <div className="collaborator-form-grid">
                <label className="form-field form-field-wide"><span>Nome completo *</span><input autoComplete="name" maxLength={160} value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
                <div className="form-field form-field-wide collaborator-photo-field">
                  <span>Foto do colaborador <small>JPEG, PNG ou WebP · até 2 MiB</small></span>
                  <div className="collaborator-photo-input">
                    {photoPreview ? <img className="collaborator-photo-preview" src={photoPreview} alt="Prévia da foto do colaborador" /> : <span className="collaborator-photo-preview collaborator-photo-placeholder">{form.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
                    <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Selecionar foto do colaborador" onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      if (!file) return
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
                        setNotice({ kind: 'error', text: 'Selecione uma foto JPEG, PNG ou WebP de até 2 MiB.' })
                        event.target.value = ''
                        return
                      }
                      setPhotoFile(file)
                      setPhotoPreview(URL.createObjectURL(file))
                    }} />
                  </div>

                </div>
                <label className="form-field"><span>Matrícula</span><input maxLength={80} value={form.registrationNumber} onChange={(event) => updateField('registrationNumber', event.target.value)} /></label>
                <label className="form-field"><span>Apelido</span><input maxLength={80} value={form.nickname} onChange={(event) => updateField('nickname', event.target.value)} /></label>
                <label className="form-field"><span>Função *</span><select value={form.role} onChange={(event) => updateField('role', event.target.value)}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                <div className="form-field form-field-wide role-creation">
                  <span>Adicionar uma função à plataforma</span>
                  <div className="role-creation-controls">
                    <input maxLength={80} value={newRoleLabel} onChange={(event) => setNewRoleLabel(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createRole()
                      }
                    }} placeholder="Ex.: Técnico de refrigeração" aria-label="Nome da nova função" />
                    <button className="secondary-button" type="button" onClick={() => void createRole()} disabled={savingRole || newRoleLabel.trim().length < 2}><Plus size={15} />{savingRole ? 'Salvando...' : 'Cadastrar função'}</button>
                  </div>
                </div>
                <label className="form-field"><span>CPF <small>opcional · criptografado</small></span><input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000.000.000-00" value={form.cpf} onChange={(event) => updateField('cpf', cpfMask(event.target.value))} /></label>
                <label className="form-field"><span>Telefone <small>opcional · criptografado</small></span><input type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
                <label className="form-field"><span>Gênero *</span><select value={form.gender} onChange={(event) => updateField('gender', event.target.value as CollaboratorGender)}>{genderOptions.map((gender) => <option key={gender.value} value={gender.value}>{gender.label}</option>)}</select></label>
                <label className="form-field"><span>Data de nascimento *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.birthDate} onChange={(event) => updateField('birthDate', event.target.value)} required /></span></label>
                <label className="form-field"><span>Data de admissão *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.admissionDate} onChange={(event) => updateField('admissionDate', event.target.value)} required /></span></label>
                <label className="form-field"><span>Data de desligamento</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.terminationDate} onChange={(event) => updateField('terminationDate', event.target.value)} /></span></label>
                <label className="children-toggle leave-toggle"><input type="checkbox" checked={form.isOnLeave} onChange={(event) => setForm((current) => ({ ...current, isOnLeave: event.target.checked, leaveStartDate: event.target.checked ? current.leaveStartDate : '', expectedReturnDate: event.target.checked ? current.expectedReturnDate : '', leaveReason: event.target.checked ? current.leaveReason : '' }))} /><span>Colaborador afastado</span></label>
                {form.isOnLeave && <>
                  <label className="form-field"><span>Data do afastamento *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.leaveStartDate} onChange={(event) => updateField('leaveStartDate', event.target.value)} required /></span></label>
                  <label className="form-field"><span>Data prevista do retorno *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.expectedReturnDate} onChange={(event) => updateField('expectedReturnDate', event.target.value)} required /></span></label>
                  <label className="form-field form-field-wide"><span>Motivo do afastamento *</span><textarea maxLength={2000} rows={3} value={form.leaveReason} onChange={(event) => updateField('leaveReason', event.target.value)} required /></label>
                </>}
                <label className="children-toggle"><input type="checkbox" checked={form.hasChildren} onChange={(event) => setForm((current) => ({ ...current, hasChildren: event.target.checked, children: event.target.checked ? current.children : [] }))} /><span>O colaborador tem filhos</span></label>
              </div>

              <section className="collaborator-uniform-editor" aria-label="Fardamento atual">
                <div className="children-editor-heading"><div><h3>Fardamento atual</h3><p>Quantidades de camisas somadas limitadas a 3.</p></div></div>
                <div className="collaborator-uniform-fields">
                  <label className="form-field"><span>Tamanho da camisa</span><select value={uniformForm.shirtSizeId ?? ''} onChange={(event) => setUniformForm((current) => ({ ...current, shirtSizeId: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.shirtSizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select></label>
                  <label className="form-field"><span>Camisas manga curta</span><input type="number" min="0" max={3 - uniformForm.shirtLongSleeveQty} value={uniformForm.shirtShortSleeveQty} onChange={(event) => setUniformForm((current) => ({ ...current, shirtShortSleeveQty: Math.max(0, Math.min(Number(event.target.value) || 0, 3 - current.shirtLongSleeveQty)) }))} /></label>
                  <label className="form-field"><span>Camisas manga longa</span><input type="number" min="0" max={3 - uniformForm.shirtShortSleeveQty} value={uniformForm.shirtLongSleeveQty} onChange={(event) => setUniformForm((current) => ({ ...current, shirtLongSleeveQty: Math.max(0, Math.min(Number(event.target.value) || 0, 3 - current.shirtShortSleeveQty)) }))} /></label>
                  <label className="form-field"><span>Calça</span><select value={uniformForm.pantsSize ?? ''} onChange={(event) => setUniformForm((current) => ({ ...current, pantsSize: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.pantsSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                  <label className="form-field"><span>Bota</span><select value={uniformForm.bootSize ?? ''} onChange={(event) => setUniformForm((current) => ({ ...current, bootSize: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.bootSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                </div>
                <div className="collaborator-size-create"><label className="form-field"><span>Novo tamanho de camisa</span><input maxLength={24} value={newShirtSize} onChange={(event) => setNewShirtSize(event.target.value)} placeholder="Ex.: XGG" /></label><button className="secondary-button" type="button" onClick={() => void addShirtSize()} disabled={!newShirtSize.trim()}><Plus size={15} /> Adicionar ao catálogo global</button></div>
                {deliveryError && <p className="form-error" role="alert">{deliveryError}</p>}
              </section>

              {form.hasChildren && <section className="children-editor" aria-label="Cadastro de filhos"><div className="children-editor-heading"><div><h3>Filhos</h3><p>Nome, nascimento e gênero</p></div><button className="secondary-button add-child-button" type="button" onClick={() => setForm((current) => ({ ...current, children: [...current.children, { name: '', birthDate: '', gender: 'nao_informar' }] }))}><Plus size={15} /> Adicionar filho</button></div>
                {form.children.map((child, index) => <div className="child-form-row" key={index}><label className="form-field"><span>Nome *</span><input value={child.name} onChange={(event) => updateChild(index, 'name', event.target.value)} required /></label><label className="form-field"><span>Nascimento *</span><input type="date" value={child.birthDate} onChange={(event) => updateChild(index, 'birthDate', event.target.value)} required /></label><label className="form-field"><span>Gênero *</span><select value={child.gender} onChange={(event) => updateChild(index, 'gender', event.target.value as CollaboratorGender)}>{genderOptions.map((gender) => <option key={gender.value} value={gender.value}>{gender.label}</option>)}</select></label><button className="icon-button child-remove" type="button" title="Remover filho" aria-label={`Remover filho ${index + 1}`} onClick={() => setForm((current) => ({ ...current, children: current.children.filter((_, childIndex) => childIndex !== index) }))}><Trash2 size={16} /></button></div>)}
                {form.children.length === 0 && <p className="children-empty">Adicione ao menos um filho ou desmarque a opção.</p>}
              </section>}

              <div className="form-privacy-note"><ShieldAlert size={15} /><span>CPF, telefone e dados dos filhos são opcionais e, quando informados, ficam criptografados. CPF e telefone só aparecem no relatório auditado.</span></div>
              {notice?.kind === 'error' && <p className="form-error" role="alert">{notice.text}</p>}
              <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar colaborador'}</button></footer>
            </form>
          </section>
      )}
    {deliveryCollaborator && (
      <section ref={deliveryPanelRef} className="full-page-data collaborator-delivery-dialog" role="region" aria-labelledby="delivery-title">
        <header className="dialog-header"><div><span className="eyebrow">CONTROLE DE FARDAMENTO</span><h2 id="delivery-title">Registrar entrega · {deliveryCollaborator.name}</h2></div><button className="secondary-button page-back-button" type="button" onClick={() => setDeliveryCollaborator(null)}><ArrowLeft size={16} /> Voltar</button></header>
        <form onSubmit={(event) => void saveUniformDelivery(event)}>
          <div className="collaborator-uniform-fields">
            <label className="form-field"><span>Data de entrega *</span><input type="date" value={deliveryForm.deliveryDate} onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveryDate: event.target.value }))} required /></label>
            <label className="form-field"><span>Tamanho da camisa</span><select value={deliveryForm.shirtSizeId ?? ''} onChange={(event) => setDeliveryForm((current) => ({ ...current, shirtSizeId: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.shirtSizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select></label>
            <label className="form-field"><span>Camisas manga curta</span><input type="number" min="0" max="99" value={deliveryForm.shirtShortSleeveQty} onChange={(event) => setDeliveryForm((current) => ({ ...current, shirtShortSleeveQty: Number(event.target.value) }))} /></label>
            <label className="form-field"><span>Camisas manga longa</span><input type="number" min="0" max="99" value={deliveryForm.shirtLongSleeveQty} onChange={(event) => setDeliveryForm((current) => ({ ...current, shirtLongSleeveQty: Number(event.target.value) }))} /></label>
            <label className="form-field"><span>Tamanho da calça</span><select value={deliveryForm.pantsSize ?? ''} onChange={(event) => setDeliveryForm((current) => ({ ...current, pantsSize: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.pantsSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
            <label className="form-field"><span>Quantidade de calças</span><input type="number" min="0" max="99" value={deliveryForm.pantsQty} onChange={(event) => setDeliveryForm((current) => ({ ...current, pantsQty: Number(event.target.value) }))} /></label>
            <label className="form-field"><span>Tamanho da bota</span><select value={deliveryForm.bootSize ?? ''} onChange={(event) => setDeliveryForm((current) => ({ ...current, bootSize: event.target.value ? Number(event.target.value) : null }))}><option value="">Não informado</option>{uniformOptions.bootSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
            <label className="form-field"><span>Quantidade de botas</span><input type="number" min="0" max="99" value={deliveryForm.bootQty} onChange={(event) => setDeliveryForm((current) => ({ ...current, bootQty: Number(event.target.value) }))} /></label>
          </div>
          <section className="collaborator-signature-section">
            <h3>Assinatura de quem entrega</h3>
            {delivererSignatureUnlocked ? <div className="signature-confirmation"><ShieldAlert size={16} /> PIN informado; o servidor verificará o PIN e recuperará a assinatura protegida ao registrar.</div> : <div className="collaborator-pin-form"><label className="form-field"><span>PIN de assinatura *</span><input type="password" inputMode="numeric" autoComplete="current-password" value={deliveryPin} onChange={(event) => { setDeliveryPin(event.target.value); setDelivererSignatureUnlocked(false) }} required /></label><button className="secondary-button" type="button" onClick={confirmDelivererPin}>Confirmar PIN</button></div>}
            <h3>Assinatura de quem recebe *</h3>
            <canvas ref={recipientCanvasRef} className="collaborator-signature-canvas" width={720} height={180} aria-label="Desenhe a assinatura de quem recebe" onPointerDown={startRecipientSignature} onPointerMove={drawRecipientSignature} onPointerUp={finishRecipientSignature} onPointerCancel={finishRecipientSignature} />
            <button className="secondary-button" type="button" onClick={() => { recipientCanvasRef.current?.getContext('2d')?.clearRect(0, 0, 720, 180); recipientInk.current = false; setRecipientSignature(null) }}>Limpar assinatura</button>
          </section>
          {deliveryError && <p className="form-error" role="alert">{deliveryError}</p>}
          <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setDeliveryCollaborator(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={deliverySubmitting}>{deliverySubmitting ? 'Salvando entrega...' : 'Registrar entrega'}</button></footer>
        </form>
      </section>
    )}
    </section>
  )
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyDeliveryForm(): UniformDeliveryForm {
  return {
    deliveryDate: localDateString(new Date()),
    shirtSizeId: null,
    shirtShortSleeveQty: 0,
    shirtLongSleeveQty: 0,
    pantsSize: null,
    pantsQty: 0,
    bootSize: null,
    bootQty: 0,
  }
}