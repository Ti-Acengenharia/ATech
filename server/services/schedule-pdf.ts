import fs from 'node:fs'
import path from 'node:path'
import { jsPDF } from 'jspdf'
import { APP_TIMEZONE } from '../config.js'
import { pool } from '../db.js'
import { decryptPersonalData } from './personal-data.js'

export interface DailyAppointment {
  id: string
  ticket_id: string | null
  legal_process_id: string | null
  collaborator_id: string
  activity_description: string
  starts_at: Date
  ends_at: Date
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
  is_finalization: boolean
  completion_term_delivered: boolean
  programming_type: 'general' | 'foreman'
  collaborator_name: string
  collaborator_role: string
  collaborator_role_label: string
}

export interface DailyCollaborator {
  id: string
  name: string
  nickname: string
  role: string
  role_label: string
  phone?: string
  is_on_leave: boolean
  photo_data_url?: string | null
  appointments: DailyAppointment[]
}

export interface DailyProgrammingData {
  date: string
  collaborators: DailyCollaborator[]
}

let cachedLogoDataUrl: string | null = null

function getBackendCompanyLogoDataUrl(): string | null {
  if (cachedLogoDataUrl) return cachedLogoDataUrl
  try {
    const logoPath = path.resolve(process.cwd(), 'public/logo-ac.png')
    if (fs.existsSync(logoPath)) {
      const buffer = fs.readFileSync(logoPath)
      cachedLogoDataUrl = `data:image/png;base64,${buffer.toString('base64')}`
      return cachedLogoDataUrl
    }
  } catch {
    // Ignore error
  }
  return null
}

function displayDatePt(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const formatted = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'UTC' }).format(dt)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function formatDatePtShort(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function formatHeaderDate(dateStr: string): string {
  const shortDate = formatDatePtShort(dateStr)
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(dateStr + 'T12:00:00Z'))
  const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  return `${weekdayCap}, ${shortDate}`
}

export function buildScheduleCaption({
  programmingType,
  date,
  recipientName,
}: {
  programmingType: 'general' | 'foreman'
  date: string
  recipientName?: string | null
}): string {
  const dateFormatted = formatHeaderDate(date)
  const greeting = programmingType === 'foreman' && recipientName?.trim()
    ? `Olá, ${recipientName.trim()}!\n\n`
    : ''

  return (
    `${greeting}📋 Programação Assistência Técnica — AC Engenharia\n` +
    `📅 Data: ${dateFormatted}\n\n` +
    `📎 Segue em anexo o documento PDF com o detalhamento completo dos serviços, locais, materiais e horários.\n\n` +
    `Dúvidas entrar em contato com a equipe administrativa`
  )
}

function displayTimePt(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: APP_TIMEZONE,
  }).format(date)
}

/**
 * Busca a programação diária e fotos diretamente do PostgreSQL
 */
export async function fetchDailyProgrammingData(
  date: string,
  programmingType: 'general' | 'foreman',
  collaboratorId?: string | number | null,
): Promise<DailyProgrammingData> {
  const colId = collaboratorId ? String(collaboratorId) : null
  const [collaboratorsRes, appointmentsRes] = await Promise.all([
    pool.query<{
      id: string
      name: string
      nickname: string
      role: string
      role_label: string
      is_on_leave: boolean
      photo_content: Buffer | null
      photo_content_type: string | null
      phone_ciphertext: string | null
    }>(
      `SELECT c.id, c.name, c.nickname, c.role, r.label AS role_label,
              (c.is_on_leave OR abs.id IS NOT NULL) AS is_on_leave,
              c.photo_content, c.photo_content_type, c.phone_ciphertext
       FROM collaborators c
       JOIN collaborator_roles r ON r.role_key = c.role
       LEFT JOIN collaborator_absences abs ON abs.collaborator_id = c.id
         AND abs.start_date <= $1::date AND abs.end_date >= $1::date
       WHERE (c.termination_date IS NULL OR c.termination_date > $1::date)
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado'))
         AND ($3::bigint IS NULL OR c.id = $3::bigint)
       ORDER BY lower(c.name), c.id`,
      [date, programmingType, colId],
    ),
    pool.query<{
      id: string
      ticket_id: string | null
      legal_process_id: string | null
      collaborator_id: string
      activity_description: string
      starts_at: Date
      ends_at: Date
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
      is_finalization: boolean
      completion_term_delivered: boolean
      programming_type: 'general' | 'foreman'
      collaborator_name: string
      collaborator_role: string
      collaborator_role_label: string
    }>(
      `SELECT p.id, p.ticket_id, p.legal_process_id, p.collaborator_id, p.activity_description,
              p.starts_at, p.ends_at, t.protocol, t.subject,
              lp.title AS legal_process_number, lp.claimant AS legal_process_claimant,
              p.standalone_location, p.enterprise,
              p.block, p.unit, p.common_area_location,
              p.materials, p.equipment, p.tools, p.completed,
              COALESCE(p.is_finalization, FALSE) AS is_finalization,
              COALESCE(p.completion_term_delivered, FALSE) AS completion_term_delivered,
              p.programming_type,
              c.name AS collaborator_name,
              c.role AS collaborator_role, r.label AS collaborator_role_label
       FROM ticket_programming p
       LEFT JOIN tickets t ON t.source_id = p.ticket_id
       LEFT JOIN legal_processes lp ON lp.id = p.legal_process_id
       JOIN collaborators c ON c.id = p.collaborator_id
       JOIN collaborator_roles r ON r.role_key = c.role
       WHERE p.starts_at < (($1::date + interval '1 day') AT TIME ZONE '${APP_TIMEZONE}')
         AND p.ends_at > ($1::date AT TIME ZONE '${APP_TIMEZONE}')
         AND p.programming_type = $2
         AND (($2 = 'foreman' AND c.role = 'encarregado')
           OR ($2 = 'general' AND c.role <> 'encarregado'))
         AND ($3::bigint IS NULL OR c.id = $3::bigint)
       ORDER BY p.starts_at, c.id`,
      [date, programmingType, colId],
    ),
  ])

  const appointments = appointmentsRes.rows
  const collaborators = collaboratorsRes.rows.map((c) => {
    let photoDataUrl: string | null = null
    if (c.photo_content && Buffer.isBuffer(c.photo_content) && c.photo_content.length > 0) {
      const mime = c.photo_content_type || 'image/jpeg'
      photoDataUrl = `data:${mime};base64,${c.photo_content.toString('base64')}`
    }

    let phone = ''
    if (c.phone_ciphertext) {
      try {
        phone = decryptPersonalData(c.phone_ciphertext, 'phone')
      } catch {
        phone = ''
      }
    }

    return {
      id: c.id,
      name: c.name,
      nickname: c.nickname,
      role: c.role,
      role_label: c.role_label,
      phone,
      is_on_leave: c.is_on_leave,
      photo_data_url: photoDataUrl,
      appointments: appointments.filter((app) => app.collaborator_id === c.id),
    }
  })

  return {
    date,
    collaborators,
  }
}

/**
 * Gera o documento PDF da programação diária exatamente com a mesma formatação visual
 */
export async function generateSchedulePdf({
  date,
  programmingType,
  collaboratorId,
  recipientName,
  data,
}: {
  date: string
  programmingType: 'general' | 'foreman'
  collaboratorId?: string | number | null
  recipientName?: string | null
  data?: DailyProgrammingData
}): Promise<{
  buffer: Buffer
  fileName: string
  caption: string
  totalEvents: number
  scheduledStaffCount: number
}> {
  const scheduleData = data || (await fetchDailyProgrammingData(date, programmingType, collaboratorId))
  const logoDataUrl = getBackendCompanyLogoDataUrl()

  // Agrupa colaboradores por cargo
  const roleGroupsMap = new Map<string, DailyCollaborator[]>()
  for (const person of scheduleData.collaborators) {
    const list = roleGroupsMap.get(person.role_label) || []
    list.push(person)
    roleGroupsMap.set(person.role_label, list)
  }

  const groups = Array.from(roleGroupsMap.entries()).map(([title, people]) => ({
    title,
    people,
  }))

  const totalEvents = scheduleData.collaborators.reduce((sum, p) => sum + p.appointments.length, 0)
  const scheduledStaffCount = groups.reduce(
    (total, g) => total + g.people.filter((p) => p.appointments.length > 0).length,
    0,
  )

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const bottom = pageHeight - 17
  const dateLabel = displayDatePt(date)
  let y = 0

  function drawPageHeader(firstPage: boolean) {
    if (firstPage) {
      doc.setFillColor(15, 59, 153)
      doc.rect(0, 0, pageWidth, 43, 'F')
      let textX = margin
      if (logoDataUrl) {
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(margin, 8, 22, 22, 2.5, 2.5, 'F')
        try {
          doc.addImage(logoDataUrl, 'PNG', margin + 2, 10, 18, 18)
        } catch {
          // Fallback se imagem tiver formato não suportado diretamente
        }
        textX = margin + 27
      }
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text(
        `AC Engenharia · ATech | ${programmingType === 'general' ? 'Programação Geral' : 'Programação de Encarregados'}`,
        textX,
        16,
      )
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(dateLabel, textX, 24)
      doc.setTextColor(215, 232, 247)
      doc.setFontSize(8)
      doc.text(
        `${totalEvents} atividades · ${scheduledStaffCount} colaboradores escalados`,
        textX,
        33,
      )
      y = 53
    } else {
      y = 18
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(49, 87, 119)
      doc.text(
        `ATECH  /  ${programmingType === 'general' ? 'PROGRAMAÇÃO GERAL' : 'PROGRAMAÇÃO DE ENCARREGADOS'}  /  ${dateLabel.toUpperCase()}`,
        margin,
        y,
      )
      doc.setDrawColor(218, 228, 237)
      doc.line(margin, y + 4, pageWidth - margin, y + 4)
      y += 12
    }
  }

  function drawRoleHeader(group: { title: string; people: DailyCollaborator[] }, continued = false) {
    doc.setFillColor(231, 241, 250)
    doc.roundedRect(margin, y, contentWidth, 9, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(32, 87, 134)
    doc.text(group.title.toUpperCase(), margin + 3, y + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(77, 105, 129)
    doc.text(
      continued ? 'CONTINUAÇÃO' : `${group.people.filter((p) => p.appointments.length).length} colaboradores`,
      pageWidth - margin - 3,
      y + 6,
      { align: 'right' },
    )
    y += 13
  }

  function drawCollaboratorHeader(person: DailyCollaborator, continued = false) {
    doc.setFillColor(245, 249, 252)
    doc.setDrawColor(218, 228, 237)
    doc.roundedRect(margin, y, contentWidth, 11, 2, 2, 'FD')
    doc.setFillColor(49, 127, 181)
    doc.roundedRect(margin, y, 2, 11, 1, 1, 'F')

    let hasRenderedPhoto = false
    if (person.photo_data_url) {
      try {
        const format = person.photo_data_url.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        doc.addImage(person.photo_data_url, format, margin + 4, y + 1.5, 8, 8)
        hasRenderedPhoto = true
      } catch {
        hasRenderedPhoto = false
      }
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(38, 69, 96)
    doc.text(person.name, margin + (hasRenderedPhoto ? 14 : 5), y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(74, 111, 143)
    doc.text(
      `${person.role_label}${continued ? '  ·  CONTINUAÇÃO' : ''}`,
      pageWidth - margin - 4,
      y + 7,
      { align: 'right' },
    )
    y += 14
  }

  drawPageHeader(true)

  if (scheduledStaffCount === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(100, 116, 139)
    doc.text('Não há colaboradores com atividades agendadas para esta data.', margin, y + 10)
  } else {
    for (const group of groups) {
      const scheduledPeople = group.people.filter((person) => person.appointments.length > 0)
      if (!scheduledPeople.length) continue

      if (y + 14 > bottom) {
        doc.addPage()
        drawPageHeader(false)
      }
      y += 2
      drawRoleHeader({ ...group, people: scheduledPeople })

      for (const person of scheduledPeople) {
        if (y + 20 > bottom) {
          doc.addPage()
          drawPageHeader(false)
          drawRoleHeader({ ...group, people: scheduledPeople }, true)
        }
        drawCollaboratorHeader(person)

        for (const appointment of person.appointments) {
          const lines: { label: string; value: string; bold?: boolean }[] = [
            {
              label: appointment.protocol
                ? 'PROTOCOLO'
                : appointment.legal_process_number
                  ? 'PROCESSO JURÍDICO'
                  : 'ATIVIDADE',
              value: appointment.protocol
                ? `#${appointment.protocol}  ·  ${appointment.subject || 'Atendimento'}`
                : appointment.legal_process_number
                  ? `${appointment.legal_process_number}${appointment.legal_process_claimant ? ` · ${appointment.legal_process_claimant}` : ''}`
                  : 'Atividade avulsa',
              bold: true,
            },
            {
              label: 'EMPREENDIMENTO',
              value: appointment.protocol || appointment.legal_process_number
                ? appointment.enterprise || 'Não informado'
                : 'Não se aplica',
            },
            {
              label: 'LOCAL',
              value: appointment.standalone_location ||
                (appointment.common_area_location
                  ? `Área comum: ${appointment.common_area_location}`
                  : appointment.block || appointment.unit
                    ? `Bloco ${appointment.block || '—'}  ·  Unidade ${appointment.unit || '—'}`
                    : 'Local não especificado'),
            },
            { label: 'SERVIÇO', value: appointment.activity_description },
          ]

          if (appointment.materials && appointment.materials.length) {
            lines.push({ label: 'MATERIAIS', value: appointment.materials.join(', ') })
          }
          if (appointment.equipment && appointment.equipment.length) {
            lines.push({ label: 'EQUIPAMENTOS', value: appointment.equipment.join(', ') })
          }
          if (appointment.tools && appointment.tools.length) {
            lines.push({ label: 'FERRAMENTAS', value: appointment.tools.join(', ') })
          }

          if (y + 11 > bottom) {
            doc.addPage()
            drawPageHeader(false)
            drawRoleHeader({ ...group, people: scheduledPeople }, true)
            drawCollaboratorHeader(person, true)
          }

          doc.setFillColor(235, 243, 249)
          doc.roundedRect(margin + 2, y, contentWidth - 4, 7.5, 1.5, 1.5, 'F')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8.5)
          doc.setTextColor(40, 91, 132)
          doc.text(
            `${displayTimePt(appointment.starts_at)}–${displayTimePt(appointment.ends_at)}`,
            margin + 5,
            y + 5.2,
          )

          if (appointment.is_finalization) {
            y += 9.5
            if (y + 12 > bottom) {
              doc.addPage()
              drawPageHeader(false)
              drawRoleHeader({ ...group, people: scheduledPeople }, true)
              drawCollaboratorHeader(person, true)
            }
            doc.setFillColor(255, 247, 237)
            doc.setDrawColor(249, 115, 22)
            doc.roundedRect(margin + 4, y, contentWidth - 8, 6.5, 1.2, 1.2, 'FD')
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(7.2)
            doc.setTextColor(194, 65, 12)
            doc.text(
              'Atenção: Finalização do Chamado - Solicitar assinatura do cliente no termo de finalização após o serviço.',
              margin + 7,
              y + 4.4,
            )
            y += 12.0
          } else {
            y += 12.0
          }

          for (const line of lines) {
            const wrapped = doc.splitTextToSize(line.value, contentWidth - 44) as string[]
            let offset = 0
            while (offset < wrapped.length) {
              if (y + 8 > bottom) {
                doc.addPage()
                drawPageHeader(false)
                drawRoleHeader({ ...group, people: scheduledPeople }, true)
                drawCollaboratorHeader(person, true)
                doc.setFillColor(235, 243, 249)
                doc.roundedRect(margin + 2, y, contentWidth - 4, 8, 1.5, 1.5, 'F')
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(8)
                doc.setTextColor(40, 91, 132)
                doc.text(
                  `${displayTimePt(appointment.starts_at)}–${displayTimePt(appointment.ends_at)}  ·  Continuação`,
                  margin + 5,
                  y + 5.5,
                )
                y += 11
              }
              const linesAvailable = Math.max(1, Math.floor((bottom - y - 3) / 4.2))
              const chunk = wrapped.slice(offset, offset + linesAvailable)
              doc.setFont('helvetica', 'bold')
              doc.setFontSize(6.5)
              doc.setTextColor(106, 126, 144)
              doc.text(offset === 0 ? line.label : `${line.label} (cont.)`, margin + 5, y)
              doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
              doc.setFontSize(7.5)
              doc.setTextColor(43, 62, 79)
              doc.text(chunk, margin + 39, y)
              y += chunk.length * 4.2 + 3
              offset += chunk.length
            }
          }
          y += 3
          doc.setDrawColor(226, 234, 241)
          doc.line(margin + 5, y, pageWidth - margin - 5, y)
          y += 4
        }
        y += 5
      }
    }
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(120, 137, 152)
    doc.text('ATech · Documento de apoio à equipe de campo', margin, pageHeight - 8)
    doc.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
  }

  const arrayBuffer = doc.output('arraybuffer')
  const buffer = Buffer.from(arrayBuffer)
  const typeTag = programmingType === 'general' ? 'geral' : 'encarregados'
  const fileName = `programacao-${typeTag}-${date}.pdf`

  const caption = buildScheduleCaption({
    programmingType,
    date,
    recipientName,
  })

  return {
    buffer,
    fileName,
    caption,
    totalEvents,
    scheduledStaffCount,
  }
}

