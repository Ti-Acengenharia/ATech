import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, FileSignature, Pencil, Plus, Printer, RefreshCw, ShieldAlert, Trash2, UsersRound } from 'lucide-react'
import { apiRequest } from '../api/client'
import { useLiveSync } from '../api/liveSync'
import { getCompanyLogoDataUrl } from '../utils/companyLogo'
import TicketProgrammingForm from './TicketProgrammingForm'
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
    const response = await fetch(person.photo_url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Não foi possível carregar a foto de ${person.name} para o relatório.`)
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
      if (!context) {
        bitmap.close()
        throw new Error(`Não foi possível converter a foto de ${person.name} para o relatório.`)
      }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      photos.set(person.photo_url, { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' })
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

  drawPageHeader(true)
  for (const group of groups) {
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
        if (appointment.materials.length) lines.push({ label: 'MATERIAIS', value: appointment.materials.join(', ') })
        if (appointment.equipment.length) lines.push({ label: 'EQUIPAMENTOS', value: appointment.equipment.join(', ') })
        if (appointment.tools.length) lines.push({ label: 'FERRAMENTAS', value: appointment.tools.join(', ') })
        if (y + 11 > bottom) {
          document.addPage()
          drawPageHeader(false)
          drawRoleHeader({ ...group, people: scheduledPeople }, true)
          drawCollaboratorHeader(person, true)
        }
        document.setFillColor(235, 243, 249)
        document.roundedRect(margin + 2, y, contentWidth - 4, 7.5, 1.5, 1.5, 'F')
        document.setFont('helvetica', 'bold')
        document.setFontSize(8.5)
        document.setTextColor(40, 91, 132)
        document.text(`${displayTime(appointment.starts_at)}–${displayTime(appointment.ends_at)}`, margin + 5, y + 5.2)
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
  const [staff, setStaff] = useState<CollaboratorDay[]>([])
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [ticketsLoaded, setTicketsLoaded] = useState(false)
  const [ticketsLoadError, setTicketsLoadError] = useState('')
  const [ticketsRetry, setTicketsRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [generatingPdf, setGeneratingPdf] = useState(false)
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

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  useLiveSync(['settings'], () => {
    loadCalendar()
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
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível excluir a programação.')
    }
  }

  async function updateAppointmentCompletion(appointment: Appointment, completed: boolean) {
    setUpdatingAppointments((current) => new Set(current).add(appointment.id))
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}/completion`, {
        method: 'PATCH',
        body: JSON.stringify({ completed }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
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
    setError('')
    try {
      await apiRequest(`/api/programming/${appointment.id}/term-delivery`, {
        method: 'PATCH',
        body: JSON.stringify({ delivered }),
      })
      setRefresh((value) => value + 1)
    } catch (requestError) {
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

  const week = weekdayStrip(date)
  const roles = Array.from(new Map(staff.map((person) => [
    person.role,
    { key: person.role, title: roleName(person.role, person.role_label) },
  ])).values()).sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'))
  const visibleStaff = programmingType === 'foreman'
    ? staff
    : staff.filter((person) => !hiddenRoleKeys.has(person.role))
  const visibleDayEvents = visibleStaff.reduce((total, collaborator) => total + collaborator.appointments.length, 0)
  const roleGroups = roles.filter((role) => programmingType === 'foreman' || !hiddenRoleKeys.has(role.key)).map((group) => ({
    ...group,
    people: visibleStaff.filter((person) => person.role === group.key)
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
  })).map((group) => ({
    ...group,
    hasProgrammedPeople: group.people.some((person) => person.appointments.length > 0),
  }))

  return (
    <section className="programming-page">
      <div className="programming-heading">
        <div><span className="eyebrow">AGENDA DA ASSISTÊNCIA TÉCNICA</span><h1>{programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados'}</h1><p>Atividades por colaborador, com reserva de horário sem sobreposição.</p></div>
        <button className="primary-button" type="button" onClick={() => { setEditingAppointment(null); setShowForm((value) => !value) }}><Plus size={16} /> Nova programação</button>
      </div>

      <nav className="programming-tabs no-print" aria-label="Vertentes da programação">
        <button type="button" className={programmingType === 'general' ? 'is-active' : ''} aria-pressed={programmingType === 'general'} onClick={() => { setProgrammingType('general'); setShowForm(false); setEditingAppointment(null) }}>Programação Geral</button>
        <button type="button" className={programmingType === 'foreman' ? 'is-active' : ''} aria-pressed={programmingType === 'foreman'} onClick={() => { setProgrammingType('foreman'); setShowForm(false); setEditingAppointment(null) }}>Encarregados</button>
      </nav>

      {error && <div className="notice notice-error" role="alert"><CircleAlert size={16} />{error}<button type="button" onClick={() => setError('')} aria-label="Fechar aviso">×</button></div>}
      {(showForm || editingAppointment) && <section ref={programmingFormRef} className="programming-form-panel"><header><div><span className="eyebrow">{editingAppointment ? 'EDITAR ATIVIDADE' : 'NOVA ATIVIDADE'}</span><h2>{editingAppointment ? editingAppointment.protocol ? `Editar protocolo ${editingAppointment.protocol}` : 'Editar atividade avulsa' : 'Programar atividade'}</h2></div><button className="secondary-button" type="button" onClick={() => { setShowForm(false); setEditingAppointment(null) }}><ArrowLeft size={15} /> Voltar à agenda</button></header>{ticketsLoadError ? <div className="programming-empty" role="alert">{ticketsLoadError}<button type="button" className="text-action-btn" onClick={() => { setTicketsLoadError(''); setTicketsRetry((value) => value + 1) }}>Tentar novamente</button></div> : !ticketsLoaded ? <p className="programming-empty">Carregando chamados...</p> : <TicketProgrammingForm key={editingAppointment ? `${editingAppointment.id}-${programmingType}` : `new-${programmingType}`} tickets={tickets} initialDate={date} programmingType={programmingType} editingAppointment={editingAppointment ?? undefined} onCancel={() => { setShowForm(false); setEditingAppointment(null) }} onSaved={() => { setShowForm(false); setEditingAppointment(null); setRefresh((value) => value + 1) }} />}</section>}

      <section className="programming-calendar" aria-label="Programação diária da equipe">
        <header className="calendar-toolbar"><div><span className="eyebrow">DIA SELECIONADO</span><h2>{displayDate(date)}</h2><p><UsersRound size={14} /> {visibleStaff.length} colaboradores · {visibleDayEvents} atividades visíveis</p></div><div className="calendar-controls"><button className="icon-button no-print" type="button" aria-label="Semana anterior" title="Semana anterior" onClick={() => shiftWeek(-1)}><ArrowLeft size={17} /></button><label className="calendar-date-picker no-print"><CalendarDays size={15} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Selecionar data da agenda" /></label><button className="icon-button no-print" type="button" aria-label="Próxima semana" title="Próxima semana" onClick={() => shiftWeek(1)}><ArrowRight size={17} /></button><button className="secondary-button today-button no-print" type="button" onClick={() => setDate(programmingDateString(new Date()))}>Hoje</button><button className="icon-button no-print" type="button" aria-label="Atualizar agenda" title="Atualizar agenda" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /></button><button className="secondary-button no-print" type="button" disabled={loading || visibleDayEvents === 0 || generatingPdf} onClick={() => void downloadPdf()}><Printer size={15} /> {generatingPdf ? 'Gerando PDF...' : 'Baixar relatório PDF'}</button></div></header>
        <div className="calendar-week-strip no-print">
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
          <strong>Funções na agenda</strong>
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
          {programmingType === 'general' && !roleVisibilityLoaded ? <p className="programming-empty">Carregando configuração compartilhada...</p> : loading ? <p className="programming-empty">Carregando agenda...</p> : staff.length === 0 ? <p className="programming-empty">{programmingType === 'foreman' ? 'Nenhum colaborador ativo com cargo de encarregado cadastrado.' : 'Nenhum colaborador ativo cadastrado.'}</p> : roleGroups.length === 0 ? <p className="programming-empty">Todas as funções estão ocultas. Selecione as que deseja ver na agenda.</p> : roleGroups.map((group) => (
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
                              {` · Bloqueado (${collaborator.absence.type === 'atestado' ? 'Atestado' : 'Falta'})`}
                            </span>
                          ) : collaborator.is_on_leave ? ' · Afastado' : ''}
                        </small>
                      </span>
                    </header>

                    {collaborator.absence && (
                      <div className={`schedule-card-absence-banner ${collaborator.appointments.length ? 'has-conflict' : 'is-blocked'}`}>
                        <div className="schedule-card-absence-banner-title">
                          {collaborator.appointments.length ? <AlertTriangle size={15} /> : <ShieldAlert size={15} />}
                          <strong>
                            {collaborator.appointments.length
                              ? '⚠️ ATENÇÃO: Ausência com atividades pendentes de reprogramação!'
                              : `AGENDA BLOQUEADA · ${collaborator.absence.type === 'atestado' ? 'ATESTADO MÉDICO' : 'FALTA INJUSTIFICADA'}`}
                          </strong>
                        </div>
                        <p>
                          {collaborator.absence.type === 'atestado' ? 'Atestado médico' : 'Falta injustificada'}
                          {collaborator.absence.cid ? ` (CID ${collaborator.absence.cid})` : ''} · Período de{' '}
                          {formatDatePt(collaborator.absence.startDate)} a {formatDatePt(collaborator.absence.endDate)}.
                        </p>
                        {collaborator.absence.notes && <small className="schedule-absence-notes">Obs: {collaborator.absence.notes}</small>}
                        {collaborator.appointments.length > 0 && (
                          <p className="schedule-card-absence-action-hint">
                            Existem <strong>{collaborator.appointments.length} atividade(s)</strong> agendada(s) hoje que precisam ser reprogramadas ou excluídas.
                          </p>
                        )}
                      </div>
                    )}

                    {collaborator.appointments.length ? collaborator.appointments.map((appointment) => (
                      <div className={`schedule-appointment-summary ${appointment.is_finalization ? 'is-finalization-activity' : ''}`} key={appointment.id}>
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
                        <strong>{displayTime(appointment.starts_at)}–{displayTime(appointment.ends_at)} · {appointment.protocol ? `Protocolo #${appointment.protocol}` : appointment.legal_process_number ? `Processo jurídico ${appointment.legal_process_number}` : 'Atividade avulsa'}</strong>
                        <span>{appointment.protocol ? `${appointment.subject || 'Atendimento'} · ${appointment.enterprise}` : appointment.legal_process_number ? `${appointment.legal_process_claimant || 'Requerente não informado'} · ${appointment.enterprise || 'Sem condomínio associado'}` : 'Sem vínculo com chamado'}</span>
                        <span>{appointment.standalone_location || (appointment.common_area_location
                          ? `Área comum: ${appointment.common_area_location}`
                          : appointment.block || appointment.unit
                            ? `Bloco ${appointment.block || '—'} · Unidade ${appointment.unit || '—'}`
                            : 'Local não especificado')}</span>
                        <small>{appointment.activity_description}</small>
                        {[
                          ['Materiais', appointment.materials],
                          ['Equipamentos', appointment.equipment],
                          ['Ferramentas', appointment.tools],
                        ].filter(([, items]) => Array.isArray(items) && items.length > 0).map(([label, items]) => (
                          <span className="schedule-kit-line" key={label as string}><strong>{label as string}:</strong> {(items as string[]).join(', ')}</span>
                        ))}
                        <div className="ticket-programming-footer">
                          <div className="ticket-programming-checks">
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
                          </div>
                          <div className="ticket-programming-buttons">
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
                        {collaborator.absence ? 'Agenda bloqueada por ausência/atestado' : 'Sem atividades programadas'}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <p className="programming-availability-note no-print"><Clock3 size={14} /> A disponibilidade é recalculada ao selecionar colaborador e dia; o servidor bloqueia reservas simultâneas.</p>
    </section>
  )
}
