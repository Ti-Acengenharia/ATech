import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileSignature,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react'
import SearchableMultiSelect, { type SearchableMultiSelectOption } from '../SearchableMultiSelect'
import { apiRequest } from '../api/client'
import { useLiveSync } from '../api/liveSync'
import { getCompanyLogoDataUrl } from '../utils/companyLogo'
import TicketProgrammingForm from './TicketProgrammingForm'
import ProgrammingCancellationModal from './ProgrammingCancellationModal'
import type { TicketSummary } from './types'
import { getProgrammingRoleVisibility, saveProgrammingRoleVisibility } from './programming-role-visibility'
import {
  PROGRAMMING_TIME_ZONE,
  programmingDateString,
  programmingTimeString,
} from './programming-time'

interface WorkingHoursSettings {
  monday_thursday: { start: string; end: string }
  friday: { start: string; end: string }
  work_saturday: { start: string; end: string }
}

interface CalendarEntry {
  id: string
  date: string
  description: string
  type: 'holiday' | 'work_saturday'
}

interface CollaboratorOption {
  id: string
  name: string
  nickname: string
  role: string
  role_label: string
  photo_url: string | null
  is_on_leave: boolean
}

interface WeeklyAbsence {
  id: string
  collaboratorId: string
  type: 'atestado' | 'falta_injustificada'
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  cid: string | null
  notes: string | null
  collaboratorName: string
  collaboratorRole: string
  collaboratorRoleLabel: string
}

interface Appointment {
  id: string
  ticket_id: string | null
  legal_process_id: string | null
  collaborator_id: string
  activity_description: string
  starts_at: string
  ends_at: string
  protocol: string | null
  subject: string | null
  legal_process_number: string | null
  legal_process_claimant: string | null
  standalone_location: string
  enterprise: string
  block: string
  unit: string
  common_area_location: string
  materials: string[]
  equipment: string[]
  tools: string[]
  completed: boolean
  is_finalization?: boolean
  completion_term_delivered?: boolean
  cancelled?: boolean
  cancellation_reason_type?: 'cliente' | 'reagendamento' | 'remanejamento' | 'ac_engenharia' | string | null
  cancellation_reason?: string | null
  cancellation_reassigned_to?: string | null
  cancellation_reassigned_name?: string | null
  cancelled_at?: string | null
  programming_type: 'general' | 'foreman'
  collaborator_name: string
  collaborator_role: string
  collaborator_role_label: string
  collaborator_photo_url: string | null
}

interface CollaboratorAbsenceInfo {
  id: string
  type: 'atestado' | 'falta_injustificada'
  startDate: string
  endDate: string
  startTime?: string | null
  endTime?: string | null
  cid?: string | null
  notes?: string | null
}

interface CollaboratorDay {
  id: string
  name: string
  nickname: string
  role: string
  role_label: string
  photo_url: string | null
  is_on_leave: boolean
  absence?: CollaboratorAbsenceInfo | null
  appointments: Appointment[]
}

const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
function weekdayStrip(value: string) {
  const selected = new Date(`${value}T12:00:00Z`)
  const monday = new Date(selected)
  monday.setUTCDate(selected.getUTCDate() - ((selected.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setUTCDate(monday.getUTCDate() + index)
    return { date: date.toISOString().slice(0, 10), number: date.getUTCDate(), shortName: dayNames[index] }
  })
}

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PROGRAMMING_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function displayTime(value: string) {
  return programmingTimeString(new Date(value))
}

function roleName(value: string, label?: string) {
  return label ?? value.replaceAll('_', ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
}

function appointmentMatchesSearch(
  apt: Appointment,
  rawQuery: string,
  personExtra?: { name?: string; nickname?: string; role_label?: string },
  includeCollaboratorInMatch = true,
): boolean {
  const cleaned = normalizeSearch(rawQuery).replace(/^#+/, '').trim()
  if (!cleaned) return true
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean)
  if (tokens.length === 0) return true

  const parts: Array<string | null | undefined> = [
    apt.protocol,
    apt.ticket_id,
    apt.subject,
    apt.activity_description,
    apt.enterprise,
    apt.block,
    apt.unit,
    apt.common_area_location,
    apt.standalone_location,
    apt.legal_process_number,
    apt.legal_process_claimant,
    apt.cancellation_reason,
    ...(apt.materials ?? []),
    ...(apt.equipment ?? []),
    ...(apt.tools ?? []),
  ]

  if (includeCollaboratorInMatch) {
    parts.push(
      apt.collaborator_name,
      apt.collaborator_role_label,
      personExtra?.name,
      personExtra?.nickname,
      personExtra?.role_label,
    )
  }

  const haystack = normalizeSearch(parts.filter(Boolean).join(' '))
  return tokens.every((token) => haystack.includes(token))
}

async function createSchedulePdf(date: string, programmingType: 'general' | 'foreman', groups: { title: string; people: CollaboratorDay[] }[], dayEvents: number) {
  const [{ jsPDF }, logoDataUrl] = await Promise.all([
    import('jspdf'),
    getCompanyLogoDataUrl(),
  ])
  const document = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = document.internal.pageSize.getWidth()
  const pageHeight = document.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const bottom = pageHeight - 17
  const dateLabel = displayDate(date)
  let y = 0
  const photos = new Map<string, { dataUrl: string; format: 'PNG' | 'JPEG' }>()
  for (const person of groups.flatMap((group) => group.people)) {
    if (!person.photo_url || photos.has(person.photo_url)) continue
    try {
      const response = await fetch(person.photo_url, { credentials: 'same-origin' })
      if (!response.ok) continue
      const blob = await response.blob()
      if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`Não foi possível preparar a foto de ${person.name}.`))
          reader.onerror = () => reject(new Error(`Não foi possível preparar a foto de ${person.name}.`))
          reader.readAsDataURL(blob)
        })
        photos.set(person.photo_url, { dataUrl, format: blob.type === 'image/png' ? 'PNG' : 'JPEG' })
      } else {
        const bitmap = await createImageBitmap(blob)
        const canvas = window.document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (context) {
          context.drawImage(bitmap, 0, 0)
          photos.set(person.photo_url, { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' })
        }
        bitmap.close()
      }
    } catch {
      // Falha no carregamento de foto individual não deve impedir a emissão do PDF
    }
  }

  function drawPageHeader(firstPage: boolean) {
    if (firstPage) {
      document.setFillColor(15, 59, 153)
      document.rect(0, 0, pageWidth, 43, 'F')
      let textX = margin
      if (logoDataUrl) {
        document.setFillColor(255, 255, 255)
        document.roundedRect(margin, 8, 22, 22, 2.5, 2.5, 'F')
        document.addImage(logoDataUrl, 'PNG', margin + 2, 10, 18, 18)
        textX = margin + 27
      }
      document.setTextColor(255, 255, 255)
      document.setFont('helvetica', 'bold')
      document.setFontSize(16)
      document.text(`AC Engenharia · ATech | ${programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados'}`, textX, 16)
      document.setFont('helvetica', 'normal')
      document.setFontSize(10)
      document.text(dateLabel, textX, 24)
      document.setTextColor(215, 232, 247)
      document.setFontSize(8)
      document.text(`${dayEvents} atividades · ${groups.reduce((total, group) => total + group.people.filter((person) => person.appointments.length).length, 0)} colaboradores escalados`, textX, 33)
      y = 53
    } else {
      y = 18
      document.setFont('helvetica', 'bold')
      document.setFontSize(8)
      document.setTextColor(49, 87, 119)
      document.text(`ATECH  /  ${programmingType === 'general' ? 'PROGRAMAÇÃO GERAL' : 'PROGRAMAÇÃO DE ENCARREGADOS'}  /  ${dateLabel.toLocaleUpperCase('pt-BR')}`, margin, y)
      document.setDrawColor(218, 228, 237)
      document.line(margin, y + 4, pageWidth - margin, y + 4)
      y += 12
    }
  }

  function drawRoleHeader(group: { title: string; people: CollaboratorDay[] }, continued = false) {
    document.setFillColor(231, 241, 250)
    document.roundedRect(margin, y, contentWidth, 9, 2, 2, 'F')
    document.setFont('helvetica', 'bold')
    document.setFontSize(10)
    document.setTextColor(32, 87, 134)
    document.text(group.title.toLocaleUpperCase('pt-BR'), margin + 3, y + 6)
    document.setFont('helvetica', 'normal')
    document.setFontSize(8)
    document.setTextColor(77, 105, 129)
    document.text(continued ? 'CONTINUAÇÃO' : `${group.people.filter((person) => person.appointments.length).length} colaboradores`, pageWidth - margin - 3, y + 6, { align: 'right' })
    y += 13
  }

  function drawCollaboratorHeader(person: CollaboratorDay, continued = false) {
    document.setFillColor(245, 249, 252)
    document.setDrawColor(218, 228, 237)
    document.roundedRect(margin, y, contentWidth, 11, 2, 2, 'FD')
    document.setFillColor(49, 127, 181)
    document.roundedRect(margin, y, 2, 11, 1, 1, 'F')
    const photo = person.photo_url ? photos.get(person.photo_url) : null
    if (photo) document.addImage(photo.dataUrl, photo.format, margin + 4, y + 1.5, 8, 8)
    document.setFont('helvetica', 'bold')
    document.setFontSize(9.5)
    document.setTextColor(38, 69, 96)
    document.text(person.name, margin + (photo ? 14 : 5), y + 7)
    document.setFont('helvetica', 'normal')
    document.setFontSize(8)
    document.setTextColor(74, 111, 143)
    document.text(`${roleName(person.role, person.role_label)}${continued ? '  ·  CONTINUAÇÃO' : ''}`, pageWidth - margin - 4, y + 7, { align: 'right' })
    y += 14
  }

  // Remove atividades canceladas do PDF e monta mapa de equipe por chamado
  const activeGroups = groups.map((g) => ({
    ...g,
    people: g.people.map((p) => ({
      ...p,
      appointments: p.appointments.filter((app) => !app.cancelled),
    })),
  }))

  const ticketTeamMap = new Map<string, Array<{ id: string; name: string; roleLabel: string }>>()
  for (const g of activeGroups) {
    for (const p of g.people) {
      for (const app of p.appointments) {
        const key = app.ticket_id ? String(app.ticket_id) : app.protocol ? `proto:${app.protocol}` : null
        if (!key) continue
        const list = ticketTeamMap.get(key) || []
        if (!list.some((m) => m.id === String(p.id))) {
          list.push({ id: String(p.id), name: p.name, roleLabel: roleName(p.role, p.role_label) })
          ticketTeamMap.set(key, list)
        }
      }
    }
  }

  drawPageHeader(true)
  for (const group of activeGroups) {
    const scheduledPeople = group.people.filter((person) => person.appointments.length > 0)
    if (!scheduledPeople.length) continue
    if (y + 14 > bottom) {
      document.addPage()
      drawPageHeader(false)
    }
    y += 2
    drawRoleHeader({ ...group, people: scheduledPeople })

    for (const person of scheduledPeople) {
      if (y + 20 > bottom) {
        document.addPage()
        drawPageHeader(false)
        drawRoleHeader({ ...group, people: scheduledPeople }, true)
      }
      drawCollaboratorHeader(person)
      for (const appointment of person.appointments) {
        const lines: { label: string; value: string; bold?: boolean }[] = [
          { label: appointment.protocol ? 'PROTOCOLO' : appointment.legal_process_number ? 'PROCESSO JURÍDICO' : 'ATIVIDADE', value: appointment.protocol ? `#${appointment.protocol}  ·  ${appointment.subject || 'Atendimento'}` : appointment.legal_process_number ? `${appointment.legal_process_number}${appointment.legal_process_claimant ? ` · ${appointment.legal_process_claimant}` : ''}` : 'Atividade avulsa', bold: true },
          { label: 'EMPREENDIMENTO', value: appointment.protocol || appointment.legal_process_number ? appointment.enterprise || 'Não informado' : 'Não se aplica' },
          {
            label: 'LOCAL', value: appointment.standalone_location || (appointment.common_area_location
              ? `Área comum: ${appointment.common_area_location}`
              : appointment.block || appointment.unit
                ? `Bloco ${appointment.block || '—'}  ·  Unidade ${appointment.unit || '—'}`
                : 'Local não especificado')
          },
          { label: 'SERVIÇO', value: appointment.activity_description },
        ]
        const teamKey = appointment.ticket_id ? String(appointment.ticket_id) : appointment.protocol ? `proto:${appointment.protocol}` : null
        if (teamKey) {
          const teammates = (ticketTeamMap.get(teamKey) || []).filter((m) => m.id !== String(person.id))
          if (teammates.length > 0) {
            lines.push({
              label: 'EQUIPE',
              value: teammates.map((m) => `${m.name} (${m.roleLabel})`).join(', '),
            })
          }
        }
        if (appointment.materials.length) lines.push({ label: 'MATERIAIS', value: appointment.materials.join(', ') })
        if (appointment.equipment.length) lines.push({ label: 'EQUIPAMENTOS', value: appointment.equipment.join(', ') })
        if (appointment.tools.length) lines.push({ label: 'FERRAMENTAS', value: appointment.tools.join(', ') })
        if (y + 11 > bottom) {
          document.addPage()
          drawPageHeader(false)
          drawRoleHeader({ ...group, people: scheduledPeople }, true)
          drawCollaboratorHeader(person, true)
        }
        if (appointment.cancelled) {
          document.setFillColor(254, 242, 242)
          document.roundedRect(margin + 2, y, contentWidth - 4, 7.5, 1.5, 1.5, 'F')
          document.setFont('helvetica', 'bold')
          document.setFontSize(8.5)
          document.setTextColor(185, 28, 28)
          document.text(`${displayTime(appointment.starts_at)}–${displayTime(appointment.ends_at)}  ·  [CANCELADA]${appointment.cancellation_reason ? ` (${appointment.cancellation_reason})` : ''}`, margin + 5, y + 5.2)
        } else {
          document.setFillColor(235, 243, 249)
          document.roundedRect(margin + 2, y, contentWidth - 4, 7.5, 1.5, 1.5, 'F')
          document.setFont('helvetica', 'bold')
          document.setFontSize(8.5)
          document.setTextColor(40, 91, 132)
          document.text(`${displayTime(appointment.starts_at)}–${displayTime(appointment.ends_at)}`, margin + 5, y + 5.2)
        }
        if (appointment.is_finalization) {
          y += 9.5
          if (y + 12 > bottom) {
            document.addPage()
            drawPageHeader(false)
            drawRoleHeader({ ...group, people: scheduledPeople }, true)
            drawCollaboratorHeader(person, true)
          }
          document.setFillColor(255, 247, 237)
          document.setDrawColor(249, 115, 22)
          document.roundedRect(margin + 4, y, contentWidth - 8, 6.5, 1.2, 1.2, 'FD')
          document.setFont('helvetica', 'bold')
          document.setFontSize(7.2)
          document.setTextColor(194, 65, 12)
          document.text('Atenção: Finalização do Chamado - Solicitar assinatura do cliente no termo de finalização após o serviço.', margin + 7, y + 4.4)
          y += 12.0
        } else {
          y += 12.0
        }
        for (const line of lines) {
          const wrapped = document.splitTextToSize(line.value, contentWidth - 44) as string[]
          let offset = 0
          while (offset < wrapped.length) {
            if (y + 8 > bottom) {
              document.addPage()
              drawPageHeader(false)
              drawRoleHeader({ ...group, people: scheduledPeople }, true)
              drawCollaboratorHeader(person, true)
              document.setFillColor(235, 243, 249)
              document.roundedRect(margin + 2, y, contentWidth - 4, 8, 1.5, 1.5, 'F')
              document.setFont('helvetica', 'bold')
              document.setFontSize(8)
              document.setTextColor(40, 91, 132)
              document.text(`${displayTime(appointment.starts_at)}–${displayTime(appointment.ends_at)}  ·  Continuação`, margin + 5, y + 5.5)
              y += 11
            }
            const linesAvailable = Math.max(1, Math.floor((bottom - y - 3) / 4.2))
            const content = wrapped.slice(offset, offset + linesAvailable)
            document.setFont('helvetica', 'bold')
            document.setFontSize(6.5)
            document.setTextColor(106, 126, 144)
            document.text(offset === 0 ? line.label : `${line.label} (cont.)`, margin + 5, y)
            document.setFont('helvetica', line.bold ? 'bold' : 'normal')
            document.setFontSize(7.5)
            document.setTextColor(43, 62, 79)
            document.text(content, margin + 39, y)
            y += content.length * 4.2 + 3
            offset += content.length
          }
        }
        y += 3
        document.setDrawColor(226, 234, 241)
        document.line(margin + 5, y, pageWidth - margin - 5, y)
        y += 4
      }
      y += 5
    }
  }

  const pages = document.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page)
    document.setFont('helvetica', 'normal')
    document.setFontSize(7)
    document.setTextColor(120, 137, 152)
    document.text('ATech · Documento de apoio à equipe de campo', margin, pageHeight - 8)
    document.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
  }
  document.save(`programacao-${programmingType === 'general' ? 'geral' : 'encarregados'}-${date}.pdf`)
}

function formatDatePt(value: string) {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function formatShortDatePt(value: string) {
  if (!value) return ''
  const [, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}`
}

export default function ProgrammingPage({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const programmingFormRef = useRef<HTMLElement>(null)
  const [date, setDate] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('date')
      if (urlParam && /^\d{4}-\d{2}-\d{2}$/.test(urlParam)) {
        return urlParam
      }
    }
    return programmingDateString(new Date())
  })

  useEffect(() => {
    const checkUrlDate = () => {
      const urlParam = new URLSearchParams(window.location.search).get('date')
      if (urlParam && /^\d{4}-\d{2}-\d{2}$/.test(urlParam) && urlParam !== date) {
        setDate(urlParam)
      }
    }
    window.addEventListener('popstate', checkUrlDate)
    return () => window.removeEventListener('popstate', checkUrlDate)
  }, [date])
  const [programmingType, setProgrammingType] = useState<'general' | 'foreman'>('general')
  const [viewMode, setViewMode] = useState<'daily' | 'collaborator'>(() => {
    if (typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('view')
      if (urlParam === 'collaborator') return 'collaborator'
    }
    return 'daily'
  })
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('collaboratorId')
      if (urlParam) {
        return urlParam.split(',').map((id) => id.trim()).filter(Boolean)
      }
    }
    return []
  })
  const [weeklyLayout, setWeeklyLayout] = useState<'by-day' | 'by-collaborator'>('by-day')
  const [allCollaborators, setAllCollaborators] = useState<CollaboratorOption[]>([])
  const [weekLoading, setWeekLoading] = useState(false)
  const [weekAppointments, setWeekAppointments] = useState<Appointment[]>([])
  const [weekAbsences, setWeekAbsences] = useState<WeeklyAbsence[]>([])
  const [collaboratorSearch, setCollaboratorSearch] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<Appointment[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchExpanded, setGlobalSearchExpanded] = useState(true)
  const [staff, setStaff] = useState<CollaboratorDay[]>([])
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [ticketsLoaded, setTicketsLoaded] = useState(false)
  const [ticketsLoadError, setTicketsLoadError] = useState('')
  const [ticketsRetry, setTicketsRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [cancellingAppointment, setCancellingAppointment] = useState<Appointment | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false)
  const [syncingCvcrm, setSyncingCvcrm] = useState(false)
  const [cvcrmSyncStatus, setCvcrmSyncStatus] = useState<{
    enabled: boolean
    dispatchTime: string
    pendingTicketsCount: number
    pendingItemsCount: number
    cvcrmConfigured: boolean
  } | null>(null)
  const [whatsappNotice, setWhatsappNotice] = useState<{ kind: 'success'; text: string } | null>(null)
  const [hiddenRoleKeys, setHiddenRoleKeys] = useState<Set<string>>(() => new Set())
  const [roleVisibilityLoaded, setRoleVisibilityLoaded] = useState(false)
  const [savingRoleVisibility, setSavingRoleVisibility] = useState(false)
  const [updatingAppointments, setUpdatingAppointments] = useState<Set<string>>(() => new Set())
  const [calendarData, setCalendarData] = useState<{
    holidays: CalendarEntry[]
    workSaturdays: CalendarEntry[]
    workingHours: WorkingHoursSettings
  } | null>(null)

  const loadCalendar = useCallback(() => {
    apiRequest<{
      holidays: CalendarEntry[]
      workSaturdays: CalendarEntry[]
      workingHours: WorkingHoursSettings
    }>('/api/calendar')
      .then((data) => setCalendarData(data))
      .catch(() => {})
  }, [])

  const loadCvcrmSyncStatus = useCallback(() => {
    apiRequest<{
      enabled: boolean
      dispatchTime: string
      pendingTicketsCount: number
      pendingItemsCount: number
      cvcrmConfigured: boolean
    }>('/api/programming/cvcrm-sync/status')
      .then((status) => setCvcrmSyncStatus(status))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  useEffect(() => {
    loadCvcrmSyncStatus()
  }, [loadCvcrmSyncStatus, refresh])

  useLiveSync(['settings', 'programming'], () => {
    loadCalendar()
    loadCvcrmSyncStatus()
  })

  const holidayMap = useMemo(() => new Map(calendarData?.holidays.map((h) => [h.date, h]) ?? []), [calendarData])
  const workSaturdayMap = useMemo(() => new Map(calendarData?.workSaturdays.map((s) => [s.date, s]) ?? []), [calendarData])

  useEffect(() => {
    if (showForm || editingAppointment) {
      programmingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [showForm, editingAppointment])

  useEffect(() => {
    let cancelled = false
    const loadVisibility = () => getProgrammingRoleVisibility()
      .then((result) => {
        if (!cancelled) {
          setHiddenRoleKeys(new Set(result.hiddenRoleKeys))
          setRoleVisibilityLoaded(true)
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a configuração compartilhada das funções.')
      })
    void loadVisibility()
    const interval = window.setInterval(() => { void loadVisibility() }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ date, type: programmingType })
    apiRequest<{ date: string; collaborators: CollaboratorDay[] }>(`/api/programming?${params}`)
      .then((program) => {
        if (cancelled) return
        setStaff(program.collaborators)
      }).catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a programação.')
      }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, programmingType, refresh])

  useEffect(() => {
    if ((!showForm && !editingAppointment) || ticketsLoaded) return
    let cancelled = false
    apiRequest<{ tickets: TicketSummary[] }>('/api/tickets')
      .then((result) => {
        if (cancelled) return
        setTickets(result.tickets)
        setTicketsLoaded(true)
        setTicketsLoadError('')
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          const message = requestError instanceof Error ? requestError.message : 'Não foi possível carregar os chamados para programação.'
          setTicketsLoadError(message)
          setError(message)
        }
      })
    return () => { cancelled = true }
  }, [showForm, editingAppointment, ticketsLoaded, ticketsRetry])

  const week = weekdayStrip(date)

  useEffect(() => {
    let cancelled = false
    apiRequest<{ collaborators: CollaboratorOption[] }>('/api/programming/collaborators')
      .then((res) => {
        if (!cancelled) setAllCollaborators(res.collaborators)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [refresh])

  useEffect(() => {
    const hasSearchQuery = collaboratorSearch.trim().length > 0
    if (viewMode !== 'collaborator' || (selectedCollaboratorIds.length === 0 && !hasSearchQuery)) {
      setWeekAppointments([])
      setWeekAbsences([])
      return
    }
    let cancelled = false
    setWeekLoading(true)
    const startDate = week[0].date
    const endDate = week[6].date
    const params = new URLSearchParams({
      startDate,
      endDate,
    })
    if (selectedCollaboratorIds.length > 0) {
      params.set('collaboratorIds', selectedCollaboratorIds.join(','))
    }
    apiRequest<{
      appointments: Appointment[]
      absences: WeeklyAbsence[]
    }>(`/api/programming/week?${params}`)
      .then((data) => {
        if (!cancelled) {
          setWeekAppointments(data.appointments)
          setWeekAbsences(data.absences)
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a programação semanal.')
        }
      })
      .finally(() => {
        if (!cancelled) setWeekLoading(false)
      })
    return () => { cancelled = true }
  }, [viewMode, selectedCollaboratorIds, collaboratorSearch, week[0].date, week[6].date, refresh])

  useEffect(() => {
    const cleaned = collaboratorSearch.trim().replace(/^#+/, '').trim()
    if (cleaned.length < 2) {
      setGlobalSearchResults([])
      setGlobalSearchLoading(false)
      return
    }
    let cancelled = false
    setGlobalSearchLoading(true)
    const timer = window.setTimeout(() => {
      apiRequest<{ appointments: Appointment[] }>(`/api/programming/search?q=${encodeURIComponent(cleaned)}`)
        .then((res) => {
          if (!cancelled) {
            setGlobalSearchResults(res.appointments)
          }
        })
        .catch(() => {
          if (!cancelled) setGlobalSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setGlobalSearchLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [collaboratorSearch, refresh])

  function shiftWeek(amount: number) {
    const next = new Date(`${date}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + amount * 7)
    setDate(programmingDateString(next))
  }

  async function deleteAppointment(appointment: Appointment) {
    const description = appointment.protocol
      ? `programação do protocolo ${appointment.protocol}`
      : appointment.legal_process_number
        ? `programação do processo jurídico ${appointment.legal_process_number}`
        : `atividade avulsa em ${appointment.standalone_location}`
    if (!window.confirm(`Excluir a ${description}?`)) return
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}`, { method: 'DELETE' })
      setWeekAppointments((current) => current.filter((item) => item.id !== appointment.id))
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir a programação.')
    }
  }

  async function reactivateAppointment(appointment: Appointment) {
    if (!window.confirm(`Deseja reativar a atividade de ${appointment.collaborator_name}?`)) return
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}/reactivate`, { method: 'POST' })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível reativar a programação.')
    }
  }

  async function updateAppointmentCompletion(appointment: Appointment, completed: boolean) {
    setUpdatingAppointments((current) => new Set(current).add(appointment.id))
    setWeekAppointments((current) =>
      current.map((item) => (item.id === appointment.id ? { ...item, completed } : item)),
    )
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}/completion`, {
        method: 'PATCH',
        body: JSON.stringify({ completed }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setWeekAppointments((current) =>
        current.map((item) => (item.id === appointment.id ? { ...item, completed: !completed } : item)),
      )
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar a realização da programação.')
    } finally {
      setUpdatingAppointments((current) => {
        const next = new Set(current)
        next.delete(appointment.id)
        return next
      })
    }
  }

  async function updateAppointmentTermDelivery(appointment: Appointment, delivered: boolean) {
    setUpdatingAppointments((current) => new Set(current).add(appointment.id))
    setWeekAppointments((current) =>
      current.map((item) => (item.id === appointment.id ? { ...item, completion_term_delivered: delivered } : item)),
    )
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}/term-delivery`, {
        method: 'PATCH',
        body: JSON.stringify({ delivered }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setWeekAppointments((current) =>
        current.map((item) => (item.id === appointment.id ? { ...item, completion_term_delivered: !delivered } : item)),
      )
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o status de entrega do termo.')
    } finally {
      setUpdatingAppointments((current) => {
        const next = new Set(current)
        next.delete(appointment.id)
        return next
      })
    }
  }

  async function updateRoleVisibility(nextHiddenRoles: Set<string>) {
    const previous = hiddenRoleKeys
    setHiddenRoleKeys(nextHiddenRoles)
    setSavingRoleVisibility(true)
    setError('')
    try {
      const result = await saveProgrammingRoleVisibility([...nextHiddenRoles])
      setHiddenRoleKeys(new Set(result.hiddenRoleKeys))
    } catch (requestError) {
      setHiddenRoleKeys(previous)
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar a visibilidade compartilhada das funções.')
    } finally {
      setSavingRoleVisibility(false)
    }
  }

  async function downloadPdf() {
    setGeneratingPdf(true)
    setError('')
    try {
      await createSchedulePdf(date, programmingType, roleGroups, visibleDayEvents)
    } catch (requestError) {
      setError(requestError instanceof Error ? `Não foi possível gerar o relatório PDF: ${requestError.message}` : 'Não foi possível gerar o relatório PDF.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  async function handleSendWhatsapp() {
    setSendingWhatsapp(true)
    setError('')
    setWhatsappNotice(null)
    try {
      const res = await apiRequest<{
        success: boolean
        message: string
      }>('/api/programming/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({
          date,
          programmingType,
        }),
      })
      setWhatsappNotice({
        kind: 'success',
        text: res.message,
      })
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? `Não foi possível enviar a programação pelo WhatsApp: ${requestError.message}`
          : 'Não foi possível enviar a programação pelo WhatsApp.',
      )
    } finally {
      setSendingWhatsapp(false)
    }
  }

  async function handleSyncCvcrmNow() {
    setSyncingCvcrm(true)
    setError('')
    setWhatsappNotice(null)
    try {
      const res = await apiRequest<{
        ran: boolean
        ticketsSynced: number
        itemsSynced: number
        ticketsFailed: number
        message: string
      }>('/api/programming/cvcrm-sync/run', {
        method: 'POST',
      })
      loadCvcrmSyncStatus()
      if (res.ticketsFailed > 0) {
        setError(res.message)
      } else {
        setWhatsappNotice({
          kind: 'success',
          text: res.message,
        })
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? `Não foi possível sincronizar comentários com o CVCRM: ${requestError.message}`
          : 'Não foi possível sincronizar comentários com o CVCRM.',
      )
    } finally {
      setSyncingCvcrm(false)
    }
  }

  const collaboratorSelectOptions: SearchableMultiSelectOption[] = useMemo(() => {
    return allCollaborators.map((c) => ({
      value: c.id,
      label: c.nickname ? `${c.name} (${c.nickname})` : c.name,
      meta: roleName(c.role, c.role_label),
    }))
  }, [allCollaborators])

  const selectedCollaboratorsList = useMemo(() => {
    return allCollaborators.filter((c) => selectedCollaboratorIds.includes(c.id))
  }, [allCollaborators, selectedCollaboratorIds])

  const rolesWithCount = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; ids: string[] }>()
    for (const c of allCollaborators) {
      const existing = map.get(c.role)
      if (existing) {
        existing.count++
        existing.ids.push(c.id)
      } else {
        map.set(c.role, {
          key: c.role,
          label: roleName(c.role, c.role_label),
          count: 1,
          ids: [c.id],
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [allCollaborators])

  const isCurrentWeek = useMemo(() => {
    const today = programmingDateString(new Date())
    return today >= week[0].date && today <= week[6].date
  }, [week])

  const weekLabel = useMemo(() => {
    return `Semana de ${formatShortDatePt(week[0].date)} a ${formatDatePt(week[6].date)}`
  }, [week])

  const roleOrder = ['pedreiro', 'ajudante', 'pintor', 'eletricista', 'analista', 'gestor', 'gerente']
  const roles = Array.from(new Map(staff.map((person) => [
    person.role,
    { key: person.role, title: roleName(person.role, person.role_label) },
  ])).values()).sort((left, right) => {
    const leftIndex = roleOrder.indexOf(normalizeSearch(left.key).replace(/[^a-z0-9]/g, ''))
    const rightIndex = roleOrder.indexOf(normalizeSearch(right.key).replace(/[^a-z0-9]/g, ''))
    const leftRank = leftIndex === -1 ? roleOrder.length : leftIndex
    const rightRank = rightIndex === -1 ? roleOrder.length : rightIndex
    return leftRank - rightRank || left.title.localeCompare(right.title, 'pt-BR')
  })
  const visibleStaff = programmingType === 'foreman'
    ? staff
    : staff.filter((person) => !hiddenRoleKeys.has(person.role))
  const visibleDayEvents = visibleStaff.reduce((total, collaborator) => total + collaborator.appointments.length, 0)
  const collaboratorSearchTerm = normalizeSearch(collaboratorSearch)
  const searchTokens = useMemo(
    () =>
      collaboratorSearchTerm
        .replace(/^#+/, '')
        .split(/\s+/)
        .map((t) => t.replace(/^#+/, '').trim())
        .filter(Boolean),
    [collaboratorSearchTerm],
  )

  const roleGroups = roles.filter((role) => programmingType === 'foreman' || !hiddenRoleKeys.has(role.key)).map((group) => ({
    ...group,
    people: visibleStaff.filter((person) => person.role === group.key)
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
  })).map((group) => ({
    ...group,
    hasProgrammedPeople: group.people.some((person) => person.appointments.length > 0),
  }))

  const filteredRoleGroups = roleGroups.map((group) => ({
    ...group,
    people: collaboratorSearchTerm
      ? group.people
          .map((person) => {
            const personHaystack = normalizeSearch(`${person.name} ${person.nickname} ${person.role_label}`)
            const personMatchesAllTokens = searchTokens.length > 0 && searchTokens.every((t) => personHaystack.includes(t))
            const contentMatchingAppointments = person.appointments.filter((apt) =>
              appointmentMatchesSearch(apt, collaboratorSearchTerm, person, false),
            )
            const fullMatchingAppointments = person.appointments.filter((apt) =>
              appointmentMatchesSearch(apt, collaboratorSearchTerm, person, true),
            )

            if (contentMatchingAppointments.length > 0) {
              return { ...person, appointments: contentMatchingAppointments }
            }
            if (personMatchesAllTokens) {
              return person
            }
            if (fullMatchingAppointments.length > 0) {
              return { ...person, appointments: fullMatchingAppointments }
            }
            return null
          })
          .filter((person): person is CollaboratorDay => person !== null)
      : group.people,
  })).map((group) => ({
    ...group,
    hasProgrammedPeople: group.people.some((person) => person.appointments.length > 0),
  })).filter((group) => group.people.length > 0)
  const filteredStaffCount = filteredRoleGroups.reduce((total, group) => total + group.people.length, 0)
  const filteredDayEvents = filteredRoleGroups.reduce((total, group) =>
    total + group.people.reduce((groupTotal, person) => groupTotal + person.appointments.length, 0), 0)

  const filteredWeekAppointments = useMemo(() => {
    if (!collaboratorSearchTerm) return weekAppointments
    return weekAppointments.filter((apt) => appointmentMatchesSearch(apt, collaboratorSearchTerm))
  }, [weekAppointments, collaboratorSearchTerm])

  const weeklyDisplayedCollaborators = useMemo(() => {
    const baseList = selectedCollaboratorIds.length > 0 ? selectedCollaboratorsList : allCollaborators
    if (!collaboratorSearchTerm) return selectedCollaboratorsList
    const collabIdsWithMatch = new Set(filteredWeekAppointments.map((apt) => apt.collaborator_id))
    return baseList.filter((collab) => {
      if (collabIdsWithMatch.has(collab.id)) return true
      const personHaystack = normalizeSearch(`${collab.name} ${collab.nickname} ${collab.role_label}`)
      return searchTokens.length > 0 && searchTokens.every((t) => personHaystack.includes(t))
    })
  }, [selectedCollaboratorIds, selectedCollaboratorsList, allCollaborators, collaboratorSearchTerm, filteredWeekAppointments, searchTokens])

  function jumpToProgrammingAppointment(apt: Appointment) {
    const targetDate = programmingDateString(new Date(apt.starts_at))
    setDate(targetDate)
    if (viewMode === 'collaborator' && selectedCollaboratorIds.length > 0 && !selectedCollaboratorIds.includes(apt.collaborator_id)) {
      setSelectedCollaboratorIds((current) => [...current, apt.collaborator_id])
    }
  }

  function renderGlobalSearchHistoryBanner() {
    const cleaned = collaboratorSearch.trim()
    if (cleaned.replace(/^#+/, '').trim().length < 2) return null

    return (
      <div className="programming-global-search-panel no-print">
        <div className="programming-global-search-header">
          <div className="programming-global-search-title">
            <Search size={14} />
            <strong>
              {globalSearchLoading
                ? `Buscando programações para “${cleaned}”...`
                : `${globalSearchResults.length} programação(ões) encontrada(s) no histórico para “${cleaned}”`}
            </strong>
          </div>
          <div className="programming-global-search-actions">
            {globalSearchResults.length > 0 && (
              <button
                type="button"
                className="text-action-btn"
                onClick={() => setGlobalSearchExpanded((prev) => !prev)}
              >
                {globalSearchExpanded ? 'Recolher lista' : `Ver todas (${globalSearchResults.length})`}
              </button>
            )}
            <button
              type="button"
              className="text-action-btn"
              onClick={() => setCollaboratorSearch('')}
            >
              Limpar filtro
            </button>
          </div>
        </div>

        {globalSearchExpanded && globalSearchResults.length > 0 && (
          <div className="programming-global-search-list">
            {globalSearchResults.map((apt) => {
              const aptDateIso = programmingDateString(new Date(apt.starts_at))
              const isCurrentDay = viewMode === 'daily' && aptDateIso === date
              const isInCurrentWeek = viewMode === 'collaborator' && aptDateIso >= week[0].date && aptDateIso <= week[6].date
              return (
                <div
                  key={apt.id}
                  className={`programming-global-search-item ${apt.cancelled ? 'is-cancelled' : apt.completed ? 'is-completed' : ''} ${isCurrentDay || isInCurrentWeek ? 'is-active-date' : ''}`}
                >
                  <div className="programming-global-search-item-main">
                    <div className="programming-global-search-item-top">
                      <span className="programming-global-search-date">
                        <CalendarDays size={12} />
                        {formatDatePt(aptDateIso)} · {displayTime(apt.starts_at)} às {displayTime(apt.ends_at)}
                      </span>
                      {apt.protocol && (
                        <span className="programming-global-search-protocol">
                          Protocolo #{apt.protocol}
                        </span>
                      )}
                      <span className="programming-global-search-collab">
                        <UsersRound size={12} />
                        {apt.collaborator_name}
                      </span>
                      {apt.cancelled ? (
                        <span className="programming-global-search-status is-cancelled">Cancelada</span>
                      ) : apt.completed ? (
                        <span className="programming-global-search-status is-completed">Realizada</span>
                      ) : (
                        <span className="programming-global-search-status is-scheduled">Agendada</span>
                      )}
                    </div>
                    <div className="programming-global-search-item-sub">
                      {apt.enterprise && <strong>{apt.enterprise}</strong>}
                      {(apt.common_area_location || apt.block || apt.unit || apt.standalone_location) && (
                        <span>
                          {apt.standalone_location ||
                            (apt.common_area_location
                              ? `Área comum: ${apt.common_area_location}`
                              : `Bl. ${apt.block || '—'} · Un. ${apt.unit || '—'}`)}
                        </span>
                      )}
                      <span className="programming-global-search-desc">{apt.activity_description}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary-button programming-global-jump-btn"
                    onClick={() => jumpToProgrammingAppointment(apt)}
                    title={viewMode === 'daily' ? `Ir para o dia ${formatDatePt(aptDateIso)}` : `Ir para a semana de ${formatDatePt(aptDateIso)}`}
                  >
                    {isCurrentDay
                      ? 'Neste dia'
                      : isInCurrentWeek
                        ? 'Nesta semana'
                        : viewMode === 'daily'
                          ? `Ver dia ${formatShortDatePt(aptDateIso)}`
                          : `Ver semana (${formatShortDatePt(aptDateIso)})`}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="programming-page">
      <div className="programming-heading">
        <div>
          <span className="eyebrow">PROGRAMAÇÃO DA ASSISTÊNCIA TÉCNICA</span>
          <h1>{viewMode === 'collaborator' ? 'Programação por Colaborador' : (programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados')}</h1>
          <p>{viewMode === 'collaborator' ? 'Visualização semanal das atividades agendadas por colaborador.' : 'Atividades por colaborador, com reserva de horário sem sobreposição.'}</p>
        </div>
        <div className="programming-heading-actions no-print" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="secondary-button"
            type="button"
            disabled={syncingCvcrm || (cvcrmSyncStatus !== null && !cvcrmSyncStatus.cvcrmConfigured)}
            onClick={() => void handleSyncCvcrmNow()}
            title={
              cvcrmSyncStatus
                ? `Envia comentários internos consolidados de novas programações, ajustes e cancelamentos para os chamados do CVCRM (Disparo automático: ${cvcrmSyncStatus.enabled ? `Ativo às ${cvcrmSyncStatus.dispatchTime}` : 'Pausado'})`
                : 'Enviar atualizações de programação para os chamados do CVCRM agora'
            }
          >
            {syncingCvcrm ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
            {syncingCvcrm
              ? 'Sincronizando CVCRM...'
              : cvcrmSyncStatus && cvcrmSyncStatus.pendingTicketsCount > 0
                ? `Enviar atualizações ao CVCRM agora (${cvcrmSyncStatus.pendingTicketsCount})`
                : 'Enviar atualizações ao CVCRM agora'}
          </button>
          <button className="primary-button" type="button" onClick={() => { setEditingAppointment(null); setShowForm((value) => !value) }}><Plus size={16} /> Nova programação</button>
        </div>
      </div>

      <div className="programming-top-nav no-print">
        <div className="programming-view-modes" role="tablist" aria-label="Modo de visualização da programação">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'daily'}
            className={`programming-view-mode-btn ${viewMode === 'daily' ? 'is-active' : ''}`}
            onClick={() => { setViewMode('daily'); setShowForm(false); setEditingAppointment(null) }}
          >
            <CalendarDays size={16} />
            <span>Visão Diária</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'collaborator'}
            className={`programming-view-mode-btn ${viewMode === 'collaborator' ? 'is-active' : ''}`}
            onClick={() => { setViewMode('collaborator'); setShowForm(false); setEditingAppointment(null) }}
          >
            <UsersRound size={16} />
            <span>Visão por Colaborador (Semanal)</span>
          </button>
        </div>

        {viewMode === 'daily' && (
          <nav className="programming-tabs" aria-label="Vertentes da programação">
            <button type="button" className={programmingType === 'general' ? 'is-active' : ''} aria-pressed={programmingType === 'general'} onClick={() => { setProgrammingType('general'); setShowForm(false); setEditingAppointment(null) }}>Programação Geral</button>
            <button type="button" className={programmingType === 'foreman' ? 'is-active' : ''} aria-pressed={programmingType === 'foreman'} onClick={() => { setProgrammingType('foreman'); setShowForm(false); setEditingAppointment(null) }}>Encarregados</button>
          </nav>
        )}
      </div>

      {error && <div className="notice notice-error" role="alert"><CircleAlert size={16} />{error}<button type="button" onClick={() => setError('')} aria-label="Fechar aviso">×</button></div>}
      {whatsappNotice && <div className="notice notice-success" role="status"><Check size={16} />{whatsappNotice.text}<button type="button" onClick={() => setWhatsappNotice(null)} aria-label="Fechar aviso">×</button></div>}
      {(showForm || editingAppointment) && <section ref={programmingFormRef} className="programming-form-panel"><header><div><span className="eyebrow">{editingAppointment ? 'EDITAR ATIVIDADE' : 'NOVA ATIVIDADE'}</span><h2>{editingAppointment ? editingAppointment.protocol ? `Editar protocolo ${editingAppointment.protocol}` : 'Editar atividade avulsa' : 'Programar atividade'}</h2></div><button className="secondary-button" type="button" onClick={() => { setShowForm(false); setEditingAppointment(null) }}><ArrowLeft size={15} /> Voltar à programação</button></header>{ticketsLoadError ? <div className="programming-empty" role="alert">{ticketsLoadError}<button type="button" className="text-action-btn" onClick={() => { setTicketsLoadError(''); setTicketsRetry((value) => value + 1) }}>Tentar novamente</button></div> : !ticketsLoaded ? <p className="programming-empty">Carregando chamados...</p> : <TicketProgrammingForm key={editingAppointment ? `${editingAppointment.id}-${programmingType}` : `new-${programmingType}`} tickets={tickets} initialDate={date} programmingType={programmingType} editingAppointment={editingAppointment ?? undefined} onCancel={() => { setShowForm(false); setEditingAppointment(null) }} onSaved={(savedDate) => {
  setShowForm(false)
  setEditingAppointment(null)
  if (savedDate && savedDate !== date) {
    setDate(savedDate)
  }
  setRefresh((value) => value + 1)
}} />}</section>}

      {viewMode === 'daily' ? (
        <section className="programming-calendar" aria-label="Programação diária da equipe">
          <header className="calendar-toolbar"><div><span className="eyebrow">DIA SELECIONADO</span><h2>{displayDate(date)}</h2><p><UsersRound size={14} /> {collaboratorSearchTerm ? `${filteredStaffCount} colaborador(es) encontrado(s) · ${filteredDayEvents} atividade(s)` : `${visibleStaff.length} colaboradores · ${visibleDayEvents} atividades visíveis`}</p></div><div className="calendar-controls"><button className="icon-button no-print" type="button" aria-label="Semana anterior" title="Semana anterior" onClick={() => shiftWeek(-1)}><ArrowLeft size={17} /></button><label className="calendar-date-picker no-print"><CalendarDays size={15} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Selecionar data da programação" /></label><button className="icon-button no-print" type="button" aria-label="Próxima semana" title="Próxima semana" onClick={() => shiftWeek(1)}><ArrowRight size={17} /></button><button className="secondary-button today-button no-print" type="button" onClick={() => setDate(programmingDateString(new Date()))}>Hoje</button><button className="icon-button no-print" type="button" aria-label="Atualizar programação" title="Atualizar programação" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /></button><button className="secondary-button no-print" type="button" disabled={loading || visibleDayEvents === 0 || generatingPdf} onClick={() => void downloadPdf()}><Printer size={15} /> {generatingPdf ? 'Gerando PDF...' : 'Baixar relatório PDF'}</button><button className="secondary-button no-print whatsapp-send-button" type="button" disabled={loading || visibleDayEvents === 0 || generatingPdf || sendingWhatsapp} onClick={() => void handleSendWhatsapp()} title={programmingType === 'general' ? 'Enviar programação geral diretamente no grupo do WhatsApp' : 'Gerar e enviar a programação individual para cada encarregado no WhatsApp'}>{sendingWhatsapp ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />} {sendingWhatsapp ? (programmingType === 'general' ? 'Enviando no grupo...' : 'Enviando aos encarregados...') : (programmingType === 'general' ? 'Enviar no grupo (WhatsApp)' : 'Enviar aos encarregados (WhatsApp)')}</button></div></header>
          <div className="calendar-week-strip-container no-print">
            <div className="calendar-week-strip">
              {week.map((day) => {
                const isHoliday = holidayMap.has(day.date)
                const holiday = holidayMap.get(day.date)
                const isWorkSat = workSaturdayMap.has(day.date)
                const workSat = workSaturdayMap.get(day.date)
                return (
                  <button
                    type="button"
                    key={day.date}
                    className={`calendar-day ${day.date === date ? 'calendar-day-selected' : ''} ${isHoliday ? 'is-holiday' : ''} ${isWorkSat ? 'is-work-saturday' : ''}`}
                    onClick={() => setDate(day.date)}
                    aria-pressed={day.date === date}
                    title={isHoliday ? `Feriado: ${holiday?.description}` : isWorkSat ? `Compensação: ${workSat?.description}` : undefined}
                  >
                    <span>{day.shortName}</span>
                    <strong>{day.number}</strong>
                    {isHoliday && <span className="calendar-day-tag holiday-tag">Feriado</span>}
                    {isWorkSat && <span className="calendar-day-tag saturday-tag">Compensação</span>}
                  </button>
                )
              })}
            </div>
            <div className="calendar-week-continuity-hint mobile-only-text" aria-hidden="true">
              <span>Deslize para ver outros dias</span> <ChevronRight size={13} />
            </div>
          </div>
          <label className="schedule-collaborator-search no-print">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={collaboratorSearch}
              onChange={(event) => setCollaboratorSearch(event.target.value)}
              placeholder="Filtrar por colaborador, protocolo (#) ou palavras-chave da atividade/local..."
              aria-label="Filtrar programação por colaborador, protocolo ou palavras-chave"
            />
          </label>
          {renderGlobalSearchHistoryBanner()}
          {holidayMap.has(date) && (
            <div className="calendar-day-notice holiday-notice no-print" role="alert">
              <CalendarDays size={16} />
              <div>
                <strong>Data marcada como feriado: {holidayMap.get(date)?.description}</strong>
                <p>O expediente está suspenso e novos agendamentos não são permitidos neste dia.</p>
              </div>
            </div>
          )}
          {workSaturdayMap.has(date) && (
            <div className="calendar-day-notice saturday-notice no-print">
              <CalendarDays size={16} />
              <div>
                <strong>Sábado com expediente liberado (Compensação): {workSaturdayMap.get(date)?.description}</strong>
                <p>Jornada autorizada para atendimentos e programações de campo.</p>
              </div>
            </div>
          )}
          {programmingType === 'general' && isAdmin && <div className="schedule-role-filters no-print" aria-label="Filtrar programação por função">
            <strong>Funções na programação</strong>
            {savingRoleVisibility && <span className="schedule-role-saving">Salvando para todos...</span>}
            {roles.map((role) => {
              const selected = !hiddenRoleKeys.has(role.key)
              return <button type="button" key={role.key} disabled={!roleVisibilityLoaded || savingRoleVisibility} className={`schedule-role-filter ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => {
                const next = new Set(hiddenRoleKeys)
                if (selected) next.add(role.key)
                else next.delete(role.key)
                void updateRoleVisibility(next)
              }}>{role.title}<span>{selected ? 'Visível' : 'Oculto'}</span></button>
            })}
            {roles.length > 1 && <div className="schedule-role-filter-actions">
              <button type="button" disabled={!roleVisibilityLoaded || savingRoleVisibility} onClick={() => void updateRoleVisibility(new Set())}>Mostrar todas</button>
              <button type="button" disabled={!roleVisibilityLoaded || savingRoleVisibility} onClick={() => void updateRoleVisibility(new Set(roles.map((role) => role.key)))}>Ocultar todas</button>
            </div>}
          </div>}
          <p className="programming-print-date">{displayDate(date)} · {programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados'}</p>
          <div className="schedule-day-content">
            {programmingType === 'general' && !roleVisibilityLoaded ? <p className="programming-empty">Carregando configuração compartilhada...</p> : loading ? <p className="programming-empty">Carregando programação...</p> : staff.length === 0 ? <p className="programming-empty">{programmingType === 'foreman' ? 'Nenhum colaborador ativo com cargo de encarregado cadastrado.' : 'Nenhum colaborador ativo cadastrado.'}</p> : roleGroups.length === 0 ? <p className="programming-empty">Todas as funções estão ocultas. Selecione as que deseja ver na programação.</p> : collaboratorSearchTerm && filteredRoleGroups.length === 0 ? <p className="programming-empty">Nenhuma programação ou colaborador encontrado neste dia para “{collaboratorSearch}”.</p> : filteredRoleGroups.map((group) => (
              <section className={`schedule-role-group ${group.hasProgrammedPeople ? '' : 'schedule-role-group-empty'}`} key={group.key}>
                <h3>{group.title}</h3>
                <div className="schedule-staff-cards">
                  {group.people.map((collaborator) => (
                    <article className={`schedule-staff-card ${collaborator.is_on_leave ? 'schedule-staff-away' : ''} ${collaborator.absence ? 'schedule-staff-has-absence' : ''} ${collaborator.appointments.length ? '' : 'schedule-staff-unscheduled'}`} key={collaborator.id}>
                      <header className="schedule-person">
                        {collaborator.photo_url
                          ? <img className="collaborator-avatar schedule-avatar" src={collaborator.photo_url} alt={`Foto de ${collaborator.name}`} />
                          : <span className="collaborator-avatar schedule-avatar">{collaborator.name.slice(0, 1).toUpperCase()}</span>}
                        <span>
                          <strong>{collaborator.name}</strong>
                          <small>
                            {roleName(collaborator.role, collaborator.role_label)}
                            {collaborator.absence ? (
                              <span className="schedule-absence-header-badge">
                                {collaborator.absence.startTime && collaborator.absence.endTime
                                  ? ` · ${collaborator.absence.type === 'atestado' ? 'Atestado' : 'Falta'} (${collaborator.absence.startTime} às ${collaborator.absence.endTime})`
                                  : ` · Bloqueado (${collaborator.absence.type === 'atestado' ? 'Atestado' : 'Falta'})`}
                              </span>
                            ) : collaborator.is_on_leave ? ' · Afastado' : ''}
                          </small>
                        </span>
                      </header>

                      {collaborator.absence && (
                        <div className={`schedule-card-absence-banner ${collaborator.appointments.length && !collaborator.absence.startTime ? 'has-conflict' : 'is-blocked'}`}>
                          <div className="schedule-card-absence-banner-title">
                            {collaborator.appointments.length && !collaborator.absence.startTime ? <AlertTriangle size={15} /> : <ShieldAlert size={15} />}
                            <strong>
                              {collaborator.appointments.length && !collaborator.absence.startTime
                                ? '⚠️ ATENÇÃO: Ausência com atividades pendentes de reprogramação!'
                                : collaborator.absence.startTime && collaborator.absence.endTime
                                  ? `AUSÊNCIA EM HORÁRIO ESPECÍFICO · ${collaborator.absence.type === 'atestado' ? 'ATESTADO MÉDICO' : 'FALTA INJUSTIFICADA'}`
                                  : `PROGRAMAÇÃO BLOQUEADA · ${collaborator.absence.type === 'atestado' ? 'ATESTADO MÉDICO' : 'FALTA INJUSTIFICADA'}`}
                            </strong>
                          </div>
                          <p>
                            {collaborator.absence.type === 'atestado' ? 'Atestado médico' : 'Falta injustificada'}
                            {collaborator.absence.cid ? ` (CID ${collaborator.absence.cid})` : ''} · Período de{' '}
                            {formatDatePt(collaborator.absence.startDate)} a {formatDatePt(collaborator.absence.endDate)}
                            {collaborator.absence.startTime && collaborator.absence.endTime
                              ? ` (das ${collaborator.absence.startTime} às ${collaborator.absence.endTime})`
                              : ''}.
                          </p>
                          {collaborator.absence.notes && <small className="schedule-absence-notes">Obs: {collaborator.absence.notes}</small>}
                          {collaborator.appointments.length > 0 && !collaborator.absence.startTime && (
                            <p className="schedule-card-absence-action-hint">
                              Existem <strong>{collaborator.appointments.length} atividade(s)</strong> agendada(s) hoje que precisam ser reprogramadas ou excluídas.
                            </p>
                          )}
                        </div>
                      )}

                      {collaborator.appointments.length ? collaborator.appointments.map((appointment) => (
                        <div className={`schedule-appointment-summary ${appointment.is_finalization ? 'is-finalization-activity' : ''} ${appointment.cancelled ? 'is-cancelled' : ''}`} key={appointment.id}>
                          {appointment.cancelled && (
                            <div className="ticket-programming-cancellation-banner">
                              <div className="ticket-programming-cancellation-header">
                                <span className="programming-cancellation-badge">
                                  <XCircle size={11} /> Cancelada
                                </span>
                                <span className="cancellation-reason-tag">
                                  {appointment.cancellation_reason_type === 'cliente'
                                    ? 'Pelo Cliente'
                                    : appointment.cancellation_reason_type === 'reagendamento'
                                      ? 'Reagendamento'
                                      : appointment.cancellation_reason_type === 'remanejamento'
                                        ? 'Remanejamento'
                                        : 'AC Engenharia'}
                                </span>
                              </div>
                              {appointment.cancellation_reason && (
                                <p className="ticket-programming-cancellation-desc">
                                  {appointment.cancellation_reason}
                                </p>
                              )}
                            </div>
                          )}
                          {appointment.is_finalization && (
                            <div className="ticket-programming-finalization-alert">
                              <div className="ticket-programming-finalization-alert-top">
                                <div className="ticket-programming-alert-tag">
                                  <FileSignature size={12} />
                                  <span>FINALIZAÇÃO DO CHAMADO</span>
                                </div>
                                <span className={`ticket-programming-delivery-badge ${appointment.completion_term_delivered ? 'is-delivered' : 'is-pending'}`}>
                                  {appointment.completion_term_delivered ? (
                                    <><Check size={11} /> Termo entregue ao colaborador</>
                                  ) : (
                                    <><Clock3 size={11} /> Termo pendente de entrega</>
                                  )}
                                </span>
                              </div>
                              <p className="ticket-programming-alert-msg">
                                Solicitar a assinatura do termo de finalização ao cliente após a realização do serviço.
                              </p>
                            </div>
                          )}
                          <strong>{displayTime(appointment.starts_at)}–{displayTime(appointment.ends_at)} · {appointment.cancelled ? '[CANCELADA] ' : ''}{appointment.protocol ? `Protocolo #${appointment.protocol}` : appointment.legal_process_number ? `Processo jurídico ${appointment.legal_process_number}` : 'Atividade avulsa'}</strong>
                          <span>{appointment.protocol ? `${appointment.subject || 'Atendimento'} · ${appointment.enterprise}` : appointment.legal_process_number ? `${appointment.legal_process_claimant || 'Requerente não informado'} · ${appointment.enterprise || 'Sem condomínio associado'}` : 'Sem vínculo com chamado'}</span>
                          <span>{appointment.standalone_location || (appointment.common_area_location
                            ? `Área comum: ${appointment.common_area_location}`
                            : appointment.block || appointment.unit
                              ? `Bloco ${appointment.block || '—'} · Unidade ${appointment.unit || '—'}`
                              : 'Local não especificado')}</span>
                          <small className="schedule-appointment-description">{appointment.activity_description}</small>
                          {[
                            ['Materiais', appointment.materials],
                            ['Equipamentos', appointment.equipment],
                            ['Ferramentas', appointment.tools],
                          ].filter(([, items]) => Array.isArray(items) && items.length > 0).map(([label, items]) => (
                            <span className="schedule-kit-line" key={label as string}><strong>{label as string}:</strong> {(items as string[]).join(', ')}</span>
                          ))}
                          <div className="ticket-programming-footer">
                            <div className="ticket-programming-checks">
                              {appointment.cancelled ? (
                                <span className="programming-cancelled-pill">
                                  <XCircle size={11} /> Cancelada
                                </span>
                              ) : (
                                <>
                                  <label className={`programming-pill-check ${appointment.completed ? 'is-checked' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={appointment.completed}
                                      disabled={updatingAppointments.has(appointment.id)}
                                      onChange={(event) => void updateAppointmentCompletion(appointment, event.target.checked)}
                                    />
                                    <span>{appointment.completed ? 'Realizada' : 'Marcar como realizada'}</span>
                                  </label>
                                  {appointment.is_finalization && (
                                    <label className={`programming-pill-check is-term ${appointment.completion_term_delivered ? 'is-checked' : ''}`}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(appointment.completion_term_delivered)}
                                        disabled={updatingAppointments.has(appointment.id)}
                                        onChange={(event) => void updateAppointmentTermDelivery(appointment, event.target.checked)}
                                      />
                                      <span>{appointment.completion_term_delivered ? 'Termo entregue' : 'Termo entregue ao colaborador'}</span>
                                    </label>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="ticket-programming-buttons">
                              {!appointment.cancelled ? (
                                <button
                                  type="button"
                                  className="text-action-btn cancel-action"
                                  onClick={() => setCancellingAppointment(appointment)}
                                  title="Cancelar atividade"
                                >
                                  <Ban size={12} /> Cancelar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-action-btn reactivate-action"
                                  onClick={() => void reactivateAppointment(appointment)}
                                  title="Reativar atividade na agenda"
                                >
                                  <RotateCcw size={12} /> Reativar
                                </button>
                              )}
                              <button type="button" className="text-action-btn" onClick={() => { setShowForm(false); setEditingAppointment(appointment) }}>
                                <Pencil size={12} /> Editar
                              </button>
                              <button type="button" className="text-action-btn danger-action" onClick={() => void deleteAppointment(appointment)}>
                                <Trash2 size={12} /> Excluir
                              </button>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <p className="schedule-free-label">
                          {collaborator.absence ? 'Programação bloqueada por ausência/atestado' : 'Sem atividades programadas'}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : (
        /* Visualização Semanal por Colaborador */
        <section className="collaborator-schedule-section" aria-label="Programação semanal por colaborador">
          <header className="collaborator-schedule-toolbar">
            <div className="collaborator-schedule-toolbar-left">
              <span className="eyebrow">SEMANA SELECIONADA</span>
              <div className="collaborator-schedule-week-heading">
                <h2>{weekLabel}</h2>
                {isCurrentWeek && <span className="weekly-current-week-tag"><Check size={12} /> Esta semana</span>}
              </div>
              <p>
                <UsersRound size={14} />
                {selectedCollaboratorsList.length === 0 && !collaboratorSearchTerm
                  ? 'Nenhum colaborador selecionado'
                  : selectedCollaboratorsList.length === 0 && collaboratorSearchTerm
                    ? `Filtro ativo: “${collaboratorSearch.trim()}” · ${filteredWeekAppointments.length} atividade(s) nesta semana`
                    : `${selectedCollaboratorsList.length} colaborador(es) selecionado(s) · ${filteredWeekAppointments.length} atividade(s) na semana`}
              </p>
            </div>

            <div className="collaborator-schedule-controls">
              <div className="collaborator-week-nav-group no-print">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Semana anterior"
                  title="Semana anterior"
                  onClick={() => shiftWeek(-1)}
                >
                  <ArrowLeft size={17} />
                </button>
                <label className="calendar-date-picker" title="Pular para semana">
                  <CalendarDays size={15} />
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    aria-label="Selecionar data de referência"
                  />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Próxima semana"
                  title="Próxima semana"
                  onClick={() => shiftWeek(1)}
                >
                  <ArrowRight size={17} />
                </button>
                <button
                  className="secondary-button today-button"
                  type="button"
                  onClick={() => setDate(programmingDateString(new Date()))}
                >
                  Esta semana
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Atualizar programação"
                  title="Atualizar programação"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={15} />
                </button>
              </div>

              <div className="weekly-layout-toggle no-print" role="group" aria-label="Disposição das atividades">
                <button
                  type="button"
                  className={`weekly-layout-btn ${weeklyLayout === 'by-day' ? 'is-active' : ''}`}
                  onClick={() => setWeeklyLayout('by-day')}
                  title="Exibir em colunas por dia da semana"
                >
                  <LayoutGrid size={14} />
                  <span>Grade por Dia</span>
                </button>
                <button
                  type="button"
                  className={`weekly-layout-btn ${weeklyLayout === 'by-collaborator' ? 'is-active' : ''}`}
                  onClick={() => setWeeklyLayout('by-collaborator')}
                  title="Exibir separado por colaborador"
                >
                  <List size={14} />
                  <span>Por Colaborador</span>
                </button>
              </div>
            </div>
          </header>

          <div className="collaborator-selection-bar no-print">
            <div className="collaborator-multiselect-wrap">
              <SearchableMultiSelect
                label="Colaboradores"
                options={collaboratorSelectOptions}
                value={selectedCollaboratorIds}
                onChange={setSelectedCollaboratorIds}
                emptyLabel="Nenhum colaborador encontrado."
              />
            </div>

            <label className="weekly-keyword-search-field">
              <span className="weekly-keyword-search-label">Protocolo / Palavras-chave</span>
              <div className="weekly-keyword-search-box">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={collaboratorSearch}
                  onChange={(event) => setCollaboratorSearch(event.target.value)}
                  placeholder="Protocolo (#), serviço, local ou colaborador..."
                  aria-label="Filtrar programação semanal por protocolo, palavras-chave ou colaborador"
                />
              </div>
            </label>

            <div className="collaborator-selection-actions">
              <button
                type="button"
                className="collaborator-action-btn"
                onClick={() => setSelectedCollaboratorIds(allCollaborators.map((c) => c.id))}
              >
                Selecionar todos ({allCollaborators.length})
              </button>
              {(selectedCollaboratorIds.length > 0 || collaboratorSearch.trim().length > 0) && (
                <button
                  type="button"
                  className="collaborator-action-btn is-clear"
                  onClick={() => {
                    setSelectedCollaboratorIds([])
                    setCollaboratorSearch('')
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {rolesWithCount.length > 0 && (
              <div className="collaborator-role-pills" aria-label="Atalhos por função">
                <span className="collaborator-role-pills-label">Por função:</span>
                {rolesWithCount.map((roleGroup) => {
                  const allRoleSelected = roleGroup.ids.length > 0 && roleGroup.ids.every((id) => selectedCollaboratorIds.includes(id))
                  return (
                    <button
                      key={roleGroup.key}
                      type="button"
                      className={`collaborator-role-pill ${allRoleSelected ? 'is-active' : ''}`}
                      onClick={() => {
                        if (allRoleSelected) {
                          setSelectedCollaboratorIds((current) => current.filter((id) => !roleGroup.ids.includes(id)))
                        } else {
                          setSelectedCollaboratorIds((current) => [...new Set([...current, ...roleGroup.ids])])
                        }
                      }}
                    >
                      {roleGroup.label} ({roleGroup.count})
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {renderGlobalSearchHistoryBanner()}

          {selectedCollaboratorsList.length > 0 && (
            <div className="collaborator-chips-strip no-print">
              <span className="collaborator-chips-title">Selecionados ({selectedCollaboratorsList.length}):</span>
              <div className="collaborator-chips-list">
                {selectedCollaboratorsList.map((collab) => (
                  <div key={collab.id} className="collaborator-chip">
                    {collab.photo_url ? (
                      <img className="collaborator-chip-avatar" src={collab.photo_url} alt="" />
                    ) : (
                      <span className="collaborator-chip-avatar">{collab.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="collaborator-chip-name">{collab.name}</span>
                    <span className="collaborator-chip-role">{roleName(collab.role, collab.role_label)}</span>
                    <button
                      type="button"
                      className="collaborator-chip-remove"
                      onClick={() => setSelectedCollaboratorIds((current) => current.filter((id) => id !== collab.id))}
                      title={`Remover ${collab.name} da visualização`}
                      aria-label={`Remover ${collab.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedCollaboratorIds.length === 0 && !collaboratorSearchTerm ? (
            <div className="collaborator-empty-hero">
              <div className="collaborator-empty-hero-icon">
                <UsersRound size={42} />
              </div>
              <h3>Selecione um ou mais colaboradores ou pesquise por protocolo</h3>
              <p>Escolha os colaboradores acima, utilize os atalhos por função ou digite um protocolo/palavra-chave para visualizar o cronograma semanal.</p>
              <div className="collaborator-empty-hero-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setSelectedCollaboratorIds(allCollaborators.map((c) => c.id))}
                >
                  Selecionar todos os colaboradores ({allCollaborators.length})
                </button>
              </div>
            </div>
          ) : weekLoading ? (
            <div className="programming-empty">
              <Loader2 className="animate-spin" size={24} />
              <span>Carregando programação da semana...</span>
            </div>
          ) : collaboratorSearchTerm && filteredWeekAppointments.length === 0 && weeklyDisplayedCollaborators.length === 0 ? (
            <div className="programming-empty">
              <span>Nenhuma programação encontrada nesta semana para “{collaboratorSearch}”. Verifique o histórico completo acima se a atividade ocorreu em outra data.</span>
            </div>
          ) : weeklyLayout === 'by-day' ? (
            /* Layout 1: Grade por Dia da Semana (7 colunas) */
            <div className="weekly-grid-container">
              {week.map((day) => {
                const isHoliday = holidayMap.has(day.date)
                const holiday = holidayMap.get(day.date)
                const isWorkSat = workSaturdayMap.has(day.date)
                const workSat = workSaturdayMap.get(day.date)
                const isToday = day.date === programmingDateString(new Date())

                const dayAppointments = filteredWeekAppointments.filter(
                  (apt) => programmingDateString(new Date(apt.starts_at)) === day.date,
                )
                const dayAbsences = collaboratorSearchTerm
                  ? []
                  : weekAbsences.filter(
                      (abs) => abs.startDate <= day.date && abs.endDate >= day.date,
                    )

                return (
                  <div
                    key={day.date}
                    className={`weekly-day-column ${isToday ? 'is-today' : ''} ${isHoliday ? 'is-holiday' : ''} ${isWorkSat ? 'is-work-saturday' : ''}`}
                  >
                    <div className="weekly-day-header">
                      <div className="weekly-day-title">
                        <span className="weekly-day-name">{day.shortName}</span>
                        <strong className="weekly-day-number">{day.number}</strong>
                      </div>
                      <div className="weekly-day-badges">
                        {isToday && <span className="weekly-day-badge is-today">Hoje</span>}
                        {isHoliday && <span className="weekly-day-badge is-holiday" title={holiday?.description}>Feriado</span>}
                        {isWorkSat && <span className="weekly-day-badge is-saturday" title={workSat?.description}>Compensação</span>}
                        {dayAppointments.length > 0 && (
                          <span className="weekly-day-count-badge" title={`${dayAppointments.length} atividade(s)`}>
                            {dayAppointments.length}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="weekly-day-body">
                      {dayAbsences.map((abs) => (
                        <div key={abs.id} className="weekly-absence-alert">
                          <div className="weekly-absence-alert-header">
                            <ShieldAlert size={13} />
                            <strong>{abs.collaboratorName}</strong>
                          </div>
                          <p>
                            {abs.type === 'atestado' ? 'Atestado médico' : 'Falta injustificada'}
                            {abs.startTime && abs.endTime ? ` (${abs.startTime} às ${abs.endTime})` : ' (Integral)'}
                            {abs.cid ? ` · CID ${abs.cid}` : ''}
                          </p>
                          {abs.notes && <small className="weekly-absence-notes">{abs.notes}</small>}
                        </div>
                      ))}

                      {dayAppointments.map((apt) => (
                        <article
                          key={apt.id}
                          className={`weekly-appointment-card ${apt.is_finalization ? 'is-finalization' : ''} ${apt.completed ? 'is-completed' : ''} ${apt.cancelled ? 'is-cancelled' : ''}`}
                        >
                          {apt.cancelled && (
                            <div className="weekly-card-cancellation-banner">
                              <div className="weekly-card-cancellation-header">
                                <span className="programming-cancellation-badge mini">
                                  <XCircle size={10} /> Cancelada
                                </span>
                                <span className="cancellation-reason-tag">
                                  {apt.cancellation_reason_type === 'cliente'
                                    ? 'Cliente'
                                    : apt.cancellation_reason_type === 'reagendamento'
                                      ? 'Reagendamento'
                                      : apt.cancellation_reason_type === 'remanejamento'
                                        ? 'Remanejamento'
                                        : 'AC Engenharia'}
                                </span>
                              </div>
                              {apt.cancellation_reason && (
                                <p className="weekly-card-cancellation-desc">
                                  {apt.cancellation_reason}
                                </p>
                              )}
                            </div>
                          )}

                          {(selectedCollaboratorIds.length > 1 || selectedCollaboratorIds.length === 0) && (
                            <div className="weekly-card-collab-row">
                              {apt.collaborator_photo_url ? (
                                <img className="weekly-collab-mini-avatar" src={apt.collaborator_photo_url} alt="" />
                              ) : (
                                <span className="weekly-collab-mini-avatar">{apt.collaborator_name.slice(0, 1).toUpperCase()}</span>
                              )}
                              <span className="weekly-collab-mini-name">{apt.collaborator_name}</span>
                              <span className="weekly-collab-mini-role">{roleName(apt.collaborator_role, apt.collaborator_role_label)}</span>
                            </div>
                          )}

                          {apt.is_finalization && (
                            <div className="weekly-card-finalization-banner">
                              <FileSignature size={12} />
                              <span>Termo de Finalização</span>
                              <span className={`weekly-card-delivery-tag ${apt.completion_term_delivered ? 'is-delivered' : 'is-pending'}`}>
                                {apt.completion_term_delivered ? 'Entregue' : 'Pendente'}
                              </span>
                            </div>
                          )}

                          <div className="weekly-card-time-row">
                            <Clock3 size={12} />
                            <strong>{displayTime(apt.starts_at)} – {displayTime(apt.ends_at)}</strong>
                          </div>

                          <div className="weekly-card-title-row">
                            {apt.protocol ? (
                              <a
                                href={`/?page=tickets&ticketId=${apt.ticket_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="weekly-card-link"
                                title="Abrir chamado em nova guia"
                              >
                                <strong>{apt.cancelled ? '[CANCELADA] ' : ''}#{apt.protocol}</strong>
                                <span>{apt.subject || 'Atendimento'}</span>
                                <ExternalLink size={10} className="weekly-external-icon" />
                              </a>
                            ) : apt.legal_process_number ? (
                              <a
                                href={`/?page=legal-processes&processId=${apt.legal_process_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="weekly-card-link"
                                title="Abrir processo em nova guia"
                              >
                                <strong>{apt.cancelled ? '[CANCELADA] ' : ''}{apt.legal_process_number}</strong>
                                <span>{apt.legal_process_claimant || 'Requerente'}</span>
                                <ExternalLink size={10} className="weekly-external-icon" />
                              </a>
                            ) : (
                              <strong className="weekly-card-standalone-label">{apt.cancelled ? '[CANCELADA] ' : ''}Atividade avulsa</strong>
                            )}
                          </div>

                          <div className="weekly-card-location">
                            {apt.enterprise && <span className="weekly-card-enterprise">{apt.enterprise}</span>}
                            <span className="weekly-card-loc-details">
                              {apt.standalone_location || (apt.common_area_location
                                ? `Área comum: ${apt.common_area_location}`
                                : apt.block || apt.unit
                                  ? `Bl. ${apt.block || '—'} · Un. ${apt.unit || '—'}`
                                  : 'Local não especificado')}
                            </span>
                          </div>

                          <p className="weekly-card-desc">{apt.activity_description}</p>

                          {(apt.materials.length > 0 || apt.equipment.length > 0 || apt.tools.length > 0) && (
                            <div className="weekly-card-kits">
                              {apt.materials.length > 0 && (
                                <div className="weekly-kit-item" title={apt.materials.join(', ')}>
                                  <strong>Mat:</strong> {apt.materials.join(', ')}
                                </div>
                              )}
                              {apt.equipment.length > 0 && (
                                <div className="weekly-kit-item" title={apt.equipment.join(', ')}>
                                  <strong>Eq:</strong> {apt.equipment.join(', ')}
                                </div>
                              )}
                              {apt.tools.length > 0 && (
                                <div className="weekly-kit-item" title={apt.tools.join(', ')}>
                                  <strong>Ferr:</strong> {apt.tools.join(', ')}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="weekly-card-footer">
                            <div className="weekly-card-checks">
                              {apt.cancelled ? (
                                <span className="programming-cancelled-pill mini">
                                  <XCircle size={10} /> Cancelada
                                </span>
                              ) : (
                                <>
                                  <label className={`programming-pill-check ${apt.completed ? 'is-checked' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={apt.completed}
                                      disabled={updatingAppointments.has(apt.id)}
                                      onChange={(e) => void updateAppointmentCompletion(apt, e.target.checked)}
                                    />
                                    <span>{apt.completed ? 'Realizada' : 'Marcar'}</span>
                                  </label>
                                  {apt.is_finalization && (
                                    <label className={`programming-pill-check is-term ${apt.completion_term_delivered ? 'is-checked' : ''}`}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(apt.completion_term_delivered)}
                                        disabled={updatingAppointments.has(apt.id)}
                                        onChange={(e) => void updateAppointmentTermDelivery(apt, e.target.checked)}
                                      />
                                      <span>{apt.completion_term_delivered ? 'Termo entregue' : 'Entregar termo'}</span>
                                    </label>
                                  )}
                                </>
                              )}
                            </div>

                            <div className="weekly-card-actions">
                              {!apt.cancelled ? (
                                <button
                                  type="button"
                                  className="text-action-btn cancel-action"
                                  onClick={() => setCancellingAppointment(apt)}
                                  title="Cancelar atividade"
                                >
                                  <Ban size={11} /> Cancelar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-action-btn reactivate-action"
                                  onClick={() => void reactivateAppointment(apt)}
                                  title="Reativar atividade"
                                >
                                  <RotateCcw size={11} /> Reativar
                                </button>
                              )}
                              <button
                                type="button"
                                className="text-action-btn"
                                onClick={() => { setShowForm(false); setEditingAppointment(apt) }}
                                title="Editar programação"
                              >
                                <Pencil size={11} /> Editar
                              </button>
                              <button
                                type="button"
                                className="text-action-btn danger-action"
                                onClick={() => void deleteAppointment(apt)}
                                title="Excluir programação"
                              >
                                <Trash2 size={11} /> Excluir
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}

                      {dayAppointments.length === 0 && dayAbsences.length === 0 && (
                        <div className="weekly-day-empty">
                          <span>Sem atividades</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Layout 2: Separado por Colaborador */
            <div className="weekly-by-collaborator-list">
              {weeklyDisplayedCollaborators.map((collab) => {
                const collabAppointments = filteredWeekAppointments.filter((apt) => apt.collaborator_id === collab.id)
                const collabAbsences = weekAbsences.filter((abs) => abs.collaboratorId === collab.id)

                return (
                  <section key={collab.id} className="weekly-collab-section">
                    <header className="weekly-collab-section-header">
                      <div className="weekly-collab-section-info">
                        {collab.photo_url ? (
                          <img className="collaborator-avatar" src={collab.photo_url} alt="" />
                        ) : (
                          <span className="collaborator-avatar">{collab.name.slice(0, 1).toUpperCase()}</span>
                        )}
                        <div>
                          <h3>{collab.name} {collab.nickname ? `(${collab.nickname})` : ''}</h3>
                          <div className="weekly-collab-section-meta">
                            <span className="role-tag">{roleName(collab.role, collab.role_label)}</span>
                            {collab.is_on_leave && <span className="status-tag is-away">Afastado</span>}
                            <span className="activity-count-tag">{collabAppointments.length} atividade(s) nesta semana</span>
                          </div>
                        </div>
                      </div>
                    </header>

                    <div className="weekly-grid-container is-nested">
                      {week.map((day) => {
                        const isHoliday = holidayMap.has(day.date)
                        const holiday = holidayMap.get(day.date)
                        const isWorkSat = workSaturdayMap.has(day.date)
                        const workSat = workSaturdayMap.get(day.date)
                        const isToday = day.date === programmingDateString(new Date())

                        const dayApts = collabAppointments.filter(
                          (apt) => programmingDateString(new Date(apt.starts_at)) === day.date,
                        )
                        const dayAbs = collabAbsences.filter(
                          (abs) => abs.startDate <= day.date && abs.endDate >= day.date,
                        )

                        return (
                          <div
                            key={day.date}
                            className={`weekly-day-column ${isToday ? 'is-today' : ''} ${isHoliday ? 'is-holiday' : ''} ${isWorkSat ? 'is-work-saturday' : ''}`}
                          >
                            <div className="weekly-day-header">
                              <div className="weekly-day-title">
                                <span className="weekly-day-name">{day.shortName}</span>
                                <strong className="weekly-day-number">{day.number}</strong>
                              </div>
                              <div className="weekly-day-badges">
                                {isToday && <span className="weekly-day-badge is-today">Hoje</span>}
                                {isHoliday && <span className="weekly-day-badge is-holiday" title={holiday?.description}>Feriado</span>}
                                {isWorkSat && <span className="weekly-day-badge is-saturday" title={workSat?.description}>Compensação</span>}
                                {dayApts.length > 0 && <span className="weekly-day-count-badge">{dayApts.length}</span>}
                              </div>
                            </div>

                            <div className="weekly-day-body">
                              {dayAbs.map((abs) => (
                                <div key={abs.id} className="weekly-absence-alert">
                                  <ShieldAlert size={13} />
                                  <div>
                                    <strong>{abs.type === 'atestado' ? 'Atestado médico' : 'Falta'}</strong>
                                    <p>
                                      {abs.startTime && abs.endTime ? `${abs.startTime} às ${abs.endTime}` : 'Dia inteiro'}
                                      {abs.cid ? ` · CID ${abs.cid}` : ''}
                                    </p>
                                  </div>
                                </div>
                              ))}

                              {dayApts.map((apt) => (
                                <article
                                  key={apt.id}
                                  className={`weekly-appointment-card ${apt.is_finalization ? 'is-finalization' : ''} ${apt.completed ? 'is-completed' : ''} ${apt.cancelled ? 'is-cancelled' : ''}`}
                                >
                                  {apt.cancelled && (
                                    <div className="weekly-card-cancellation-banner">
                                      <div className="weekly-card-cancellation-header">
                                        <span className="programming-cancellation-badge mini">
                                          <XCircle size={10} /> Cancelada
                                        </span>
                                        <span className="cancellation-reason-tag">
                                          {apt.cancellation_reason_type === 'cliente'
                                            ? 'Cliente'
                                            : apt.cancellation_reason_type === 'remanejamento'
                                              ? 'Remanejamento'
                                              : 'AC Engenharia'}
                                        </span>
                                      </div>
                                      {apt.cancellation_reason && (
                                        <p className="weekly-card-cancellation-desc">
                                          {apt.cancellation_reason}
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  {apt.is_finalization && (
                                    <div className="weekly-card-finalization-banner">
                                      <FileSignature size={12} />
                                      <span>Termo de Finalização</span>
                                      <span className={`weekly-card-delivery-tag ${apt.completion_term_delivered ? 'is-delivered' : 'is-pending'}`}>
                                        {apt.completion_term_delivered ? 'Entregue' : 'Pendente'}
                                      </span>
                                    </div>
                                  )}

                                  <div className="weekly-card-time-row">
                                    <Clock3 size={12} />
                                    <strong>{displayTime(apt.starts_at)} – {displayTime(apt.ends_at)}</strong>
                                  </div>

                                  <div className="weekly-card-title-row">
                                    {apt.protocol ? (
                                      <a
                                        href={`/?page=tickets&ticketId=${apt.ticket_id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="weekly-card-link"
                                      >
                                        <strong>{apt.cancelled ? '[CANCELADA] ' : ''}#{apt.protocol}</strong>
                                        <span>{apt.subject || 'Atendimento'}</span>
                                        <ExternalLink size={10} className="weekly-external-icon" />
                                      </a>
                                    ) : apt.legal_process_number ? (
                                      <a
                                        href={`/?page=legal-processes&processId=${apt.legal_process_id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="weekly-card-link"
                                      >
                                        <strong>{apt.cancelled ? '[CANCELADA] ' : ''}{apt.legal_process_number}</strong>
                                        <span>{apt.legal_process_claimant || 'Requerente'}</span>
                                        <ExternalLink size={10} className="weekly-external-icon" />
                                      </a>
                                    ) : (
                                      <strong className="weekly-card-standalone-label">{apt.cancelled ? '[CANCELADA] ' : ''}Atividade avulsa</strong>
                                    )}
                                  </div>

                                  <div className="weekly-card-location">
                                    {apt.enterprise && <span className="weekly-card-enterprise">{apt.enterprise}</span>}
                                    <span className="weekly-card-loc-details">
                                      {apt.standalone_location || (apt.common_area_location
                                        ? `Área comum: ${apt.common_area_location}`
                                        : apt.block || apt.unit
                                          ? `Bl. ${apt.block || '—'} · Un. ${apt.unit || '—'}`
                                          : 'Local não especificado')}
                                    </span>
                                  </div>

                                  <p className="weekly-card-desc">{apt.activity_description}</p>

                                  <div className="weekly-card-footer">
                                    <div className="weekly-card-checks">
                                      {apt.cancelled ? (
                                        <span className="programming-cancelled-pill mini">
                                          <XCircle size={10} /> Cancelada
                                        </span>
                                      ) : (
                                        <label className={`programming-pill-check ${apt.completed ? 'is-checked' : ''}`}>
                                          <input
                                            type="checkbox"
                                            checked={apt.completed}
                                            disabled={updatingAppointments.has(apt.id)}
                                            onChange={(e) => void updateAppointmentCompletion(apt, e.target.checked)}
                                          />
                                          <span>{apt.completed ? 'Realizada' : 'Marcar'}</span>
                                        </label>
                                      )}
                                    </div>
                                    <div className="weekly-card-actions">
                                      {!apt.cancelled ? (
                                        <button
                                          type="button"
                                          className="text-action-btn cancel-action"
                                          onClick={() => setCancellingAppointment(apt)}
                                          title="Cancelar atividade"
                                        >
                                          <Ban size={11} /> Cancelar
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="text-action-btn reactivate-action"
                                          onClick={() => void reactivateAppointment(apt)}
                                          title="Reativar atividade"
                                        >
                                          <RotateCcw size={11} /> Reativar
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="text-action-btn"
                                        onClick={() => { setShowForm(false); setEditingAppointment(apt) }}
                                      >
                                        <Pencil size={11} /> Editar
                                      </button>
                                      <button
                                        type="button"
                                        className="text-action-btn danger-action"
                                        onClick={() => void deleteAppointment(apt)}
                                      >
                                        <Trash2 size={11} /> Excluir
                                      </button>
                                    </div>
                                  </div>
                                </article>
                              ))}

                              {dayApts.length === 0 && dayAbs.length === 0 && (
                                <div className="weekly-day-empty">
                                  <span>Livre</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </section>
      )}
      <p className="programming-availability-note no-print"><Clock3 size={14} /> A disponibilidade é recalculada ao selecionar colaborador e dia; o servidor bloqueia reservas simultâneas.</p>

      {cancellingAppointment && (
        <ProgrammingCancellationModal
          appointment={cancellingAppointment}
          onClose={() => setCancellingAppointment(null)}
          onCancelled={() => {
            setCancellingAppointment(null)
            setRefresh((value) => value + 1)
          }}
        />
      )}
    </section>
  )
}
