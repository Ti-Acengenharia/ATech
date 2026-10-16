import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, Pencil, Plus, Printer, RefreshCw, Trash2, UsersRound } from 'lucide-react'
import { Clock3 } from 'lucide-react'
import { apiRequest } from '../api/client'
import TicketProgrammingForm from './TicketProgrammingForm'
import type { TicketSummary } from './types'
import { getProgrammingRoleVisibility, saveProgrammingRoleVisibility } from './programming-role-visibility'

interface Appointment {
  id: string
  ticket_id: string | null
  collaborator_id: string
  activity_description: string
  starts_at: string
  ends_at: string
  protocol: string | null
  subject: string | null
  standalone_location: string
  enterprise: string
  block: string
  unit: string
  common_area_location: string
  materials: string[]
  equipment: string[]
  tools: string[]
  completed: boolean
  programming_type: 'general' | 'foreman'
  collaborator_name: string
  collaborator_role: string
  collaborator_role_label: string
  collaborator_photo_url: string | null
}

interface CollaboratorDay {
  id: string
  name: string
  nickname: string
  role: string
  role_label: string
  photo_url: string | null
  is_on_leave: boolean
  appointments: Appointment[]
}

const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekdayStrip(value: string) {
  const selected = new Date(`${value}T12:00:00`)
  const monday = new Date(selected)
  monday.setDate(selected.getDate() - ((selected.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return { date: localDateString(date), number: date.getDate(), shortName: dayNames[index] }
  })
}

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function roleName(value: string, label?: string) {
  return label ?? value.replaceAll('_', ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

async function createSchedulePdf(date: string, programmingType: 'general' | 'foreman', groups: { title: string; people: CollaboratorDay[] }[], dayEvents: number) {
  const { jsPDF } = await import('jspdf')
  const document = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = document.internal.pageSize.getWidth()
  const pageHeight = document.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const bottom = pageHeight - 17
  const dateLabel = displayDate(date)
  let y = 0

  function drawPageHeader(firstPage: boolean) {
    if (firstPage) {
      document.setFillColor(24, 73, 112)
      document.rect(0, 0, pageWidth, 43, 'F')
      document.setTextColor(255, 255, 255)
      document.setFont('helvetica', 'bold')
      document.setFontSize(17)
      document.text(`ATech | ${programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados'}`, margin, 16)
      document.setFont('helvetica', 'normal')
      document.setFontSize(10)
      document.text(dateLabel, margin, 24)
      document.setTextColor(215, 232, 247)
      document.setFontSize(8)
      document.text(`${dayEvents} atividades · ${groups.reduce((total, group) => total + group.people.filter((person) => person.appointments.length).length, 0)} colaboradores escalados`, margin, 33)
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
    document.setFont('helvetica', 'bold')
    document.setFontSize(9.5)
    document.setTextColor(38, 69, 96)
    document.text(person.name, margin + 5, y + 7)
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
          { label: appointment.protocol ? 'PROTOCOLO' : 'ATIVIDADE', value: appointment.protocol ? `#${appointment.protocol}  ·  ${appointment.subject || 'Atendimento'}` : 'Atividade avulsa', bold: true },
          { label: 'EMPREENDIMENTO', value: appointment.protocol ? appointment.enterprise || 'Não informado' : 'Não se aplica' },
          { label: 'LOCAL', value: appointment.standalone_location || (appointment.common_area_location
            ? `Área comum: ${appointment.common_area_location}`
            : `Bloco ${appointment.block || '—'}  ·  Unidade ${appointment.unit || '—'}`) },
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
        document.roundedRect(margin + 2, y, contentWidth - 4, 8, 1.5, 1.5, 'F')
        document.setFont('helvetica', 'bold')
        document.setFontSize(8.5)
        document.setTextColor(40, 91, 132)
        document.text(`${displayTime(appointment.starts_at)}–${displayTime(appointment.ends_at)}`, margin + 5, y + 5.5)
        y += 11
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

export default function ProgrammingPage() {
  const [date, setDate] = useState(() => localDateString(new Date()))
  const [programmingType, setProgrammingType] = useState<'general' | 'foreman'>('general')
  const [staff, setStaff] = useState<CollaboratorDay[]>([])
  const [tickets, setTickets] = useState<TicketSummary[]>([])
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
    Promise.all([
      apiRequest<{ date: string; collaborators: CollaboratorDay[] }>(`/api/programming?${params}`),
      apiRequest<{ tickets: TicketSummary[] }>('/api/tickets'),
    ]).then(([program, calls]) => {
      if (cancelled) return
      setStaff(program.collaborators)
      setTickets(calls.tickets)
    }).catch((requestError: unknown) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a programação.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, programmingType, refresh])

  function shiftWeek(amount: number) {
    const next = new Date(`${date}T12:00:00`)
    next.setDate(next.getDate() + amount * 7)
    setDate(localDateString(next))
  }

  async function deleteAppointment(appointment: Appointment) {
    const description = appointment.protocol
      ? `programação do protocolo ${appointment.protocol}`
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
      {(showForm || editingAppointment) && <section className="programming-form-panel"><header><div><span className="eyebrow">{editingAppointment ? 'EDITAR ATIVIDADE' : 'NOVA ATIVIDADE'}</span><h2>{editingAppointment ? editingAppointment.protocol ? `Editar protocolo ${editingAppointment.protocol}` : 'Editar atividade avulsa' : 'Programar atividade'}</h2></div><button className="secondary-button" type="button" onClick={() => { setShowForm(false); setEditingAppointment(null) }}><ArrowLeft size={15} /> Voltar à agenda</button></header><TicketProgrammingForm tickets={tickets} initialDate={date} programmingType={programmingType} editingAppointment={editingAppointment ?? undefined} onCancel={() => { setShowForm(false); setEditingAppointment(null) }} onSaved={() => { setShowForm(false); setEditingAppointment(null); setRefresh((value) => value + 1) }} /></section>}

      <section className="programming-calendar" aria-label="Programação diária da equipe">
        <header className="calendar-toolbar"><div><span className="eyebrow">DIA SELECIONADO</span><h2>{displayDate(date)}</h2><p><UsersRound size={14} /> {visibleStaff.length} colaboradores · {visibleDayEvents} atividades visíveis</p></div><div className="calendar-controls"><button className="icon-button no-print" type="button" aria-label="Semana anterior" title="Semana anterior" onClick={() => shiftWeek(-1)}><ArrowLeft size={17} /></button><label className="calendar-date-picker no-print"><CalendarDays size={15} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Selecionar data da agenda" /></label><button className="icon-button no-print" type="button" aria-label="Próxima semana" title="Próxima semana" onClick={() => shiftWeek(1)}><ArrowRight size={17} /></button><button className="secondary-button today-button no-print" type="button" onClick={() => setDate(localDateString(new Date()))}>Hoje</button><button className="icon-button no-print" type="button" aria-label="Atualizar agenda" title="Atualizar agenda" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /></button><button className="secondary-button no-print" type="button" disabled={loading || visibleDayEvents === 0 || generatingPdf} onClick={() => void downloadPdf()}><Printer size={15} /> {generatingPdf ? 'Gerando PDF...' : 'Baixar relatório PDF'}</button></div></header>
        <div className="calendar-week-strip no-print">{week.map((day) => <button type="button" key={day.date} className={`calendar-day ${day.date === date ? 'calendar-day-selected' : ''}`} onClick={() => setDate(day.date)} aria-pressed={day.date === date}><span>{day.shortName}</span><strong>{day.number}</strong></button>)}</div>
        {programmingType === 'general' && <div className="schedule-role-filters no-print" aria-label="Filtrar programação por função">
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
                  <article className={`schedule-staff-card ${collaborator.is_on_leave ? 'schedule-staff-away' : ''} ${collaborator.appointments.length ? '' : 'schedule-staff-unscheduled'}`} key={collaborator.id}>
                    <header className="schedule-person">
                      {collaborator.photo_url
                        ? <img className="collaborator-avatar schedule-avatar" src={collaborator.photo_url} alt={`Foto de ${collaborator.name}`} />
                        : <span className="collaborator-avatar schedule-avatar">{collaborator.name.slice(0, 1).toUpperCase()}</span>}
                      <span><strong>{collaborator.name}</strong><small>{roleName(collaborator.role, collaborator.role_label)}{collaborator.is_on_leave ? ' · Afastado' : ''}</small></span>
                    </header>
                    {collaborator.appointments.length ? collaborator.appointments.map((appointment) => (
                      <div className="schedule-appointment-summary" key={appointment.id}>
                        <strong>{displayTime(appointment.starts_at)}–{displayTime(appointment.ends_at)} · {appointment.protocol ? `Protocolo #${appointment.protocol}` : 'Atividade avulsa'}</strong>
                        <span>{appointment.protocol ? `${appointment.subject || 'Atendimento'} · ${appointment.enterprise}` : 'Sem vínculo com chamado'}</span>
                        <span>{appointment.standalone_location || (appointment.common_area_location
                          ? `Área comum: ${appointment.common_area_location}`
                          : `Bloco ${appointment.block} · Unidade ${appointment.unit}`)}</span>
                        <small>{appointment.activity_description}</small>
                        {[
                          ['Materiais', appointment.materials],
                          ['Equipamentos', appointment.equipment],
                          ['Ferramentas', appointment.tools],
                        ].filter(([, items]) => Array.isArray(items) && items.length > 0).map(([label, items]) => (
                          <span className="schedule-kit-line" key={label as string}><strong>{label as string}:</strong> {(items as string[]).join(', ')}</span>
                        ))}
                        <div className="schedule-appointment-actions no-print"><label className={`schedule-completion-check ${appointment.completed ? 'is-complete' : ''}`}><input type="checkbox" checked={appointment.completed} disabled={updatingAppointments.has(appointment.id)} onChange={(event) => void updateAppointmentCompletion(appointment, event.target.checked)} /><span>{appointment.completed ? 'Realizada' : 'Marcar como realizada'}</span></label><button type="button" className="text-action-btn" onClick={() => { setShowForm(false); setEditingAppointment(appointment) }}><Pencil size={13} /> Editar</button><button type="button" className="text-action-btn danger-action" onClick={() => void deleteAppointment(appointment)}><Trash2 size={13} /> Excluir</button></div>
                      </div>
                    )) : <p className="schedule-free-label">Sem atividades programadas</p>}
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
