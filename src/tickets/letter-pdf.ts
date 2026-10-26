export interface LetterTicket {
  id: string
  protocol: string
  customerName: string
  enterprise: string
  workAddress: string
  block: string
  unit: string
  subject: string
  subsubject: string
}

const pageWidth = 595.28
const pageHeight = 841.89
const margin = 42
const contentWidth = pageWidth - margin * 2
const ink = { r: 0, g: 0, b: 0 }
const muted = { r: 0.25, g: 0.25, b: 0.25 }

function wrapText(value: string, width: number, font: import('pdf-lib').PDFFont, size: number) {
  const lines: string[] = []
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
      } else {
        if (line) lines.push(line)
        line = ''
        for (const character of Array.from(word)) {
          const part = line + character
          if (font.widthOfTextAtSize(part, size) > width && line) {
            lines.push(line)
            line = character
          } else {
            line = part
          }
        }
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function drawWrapped(
  page: import('pdf-lib').PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  font: import('pdf-lib').PDFFont,
  size: number,
  color: (value: typeof ink) => import('pdf-lib').Color,
  lineHeight = size * 1.45,
) {
  const lines = wrapText(text, width, font, size)
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size, font, color: color(ink) }))
  return y - lines.length * lineHeight
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function drawTable(
  page: import('pdf-lib').PDFPage,
  y: number,
  protocols: string[],
  font: import('pdf-lib').PDFFont,
  bold: import('pdf-lib').PDFFont,
  color: (value: typeof ink) => import('pdf-lib').Color,
) {
  const x = margin
  const tableWidth = contentWidth
  const quantityWidth = 168
  const itemWidth = 168
  const protocolWidth = tableWidth - quantityWidth - itemWidth
  const headerHeight = 22
  const protocolText = `Nº ${protocols.join(', ')}`
  const protocolLines = wrapText(protocolText, protocolWidth - 14, font, 8)
  const rowHeight = Math.max(22, protocolLines.length * 11 + 8)
  const columns = [
    { x, width: quantityWidth, label: 'QTD.' },
    { x: x + quantityWidth, width: itemWidth, label: 'ITEM' },
    { x: x + quantityWidth + itemWidth, width: protocolWidth, label: 'PROTOCOLO DO ITEM' },
  ]
  for (const column of columns) {
    page.drawRectangle({ x: column.x, y: y - headerHeight, width: column.width, height: headerHeight, borderColor: color(ink), borderWidth: 0.6 })
    const labelWidth = bold.widthOfTextAtSize(column.label, 8)
    page.drawText(column.label, { x: column.x + (column.width - labelWidth) / 2, y: y - 14, size: 8, font: bold, color: color(ink) })
  }
  const rowTop = y - headerHeight
  for (const column of columns) {
    page.drawRectangle({ x: column.x, y: rowTop - rowHeight, width: column.width, height: rowHeight, borderColor: color(ink), borderWidth: 0.6 })
  }
  const count = `${String(protocols.length).padStart(2, '0')}x`
  const countWidth = font.widthOfTextAtSize(count, 8)
  page.drawText(count, { x: x + (quantityWidth - countWidth) / 2, y: rowTop - 14, size: 8, font, color: color(ink) })
  const item = 'Termo(s) de Finalização'
  const itemWidthText = font.widthOfTextAtSize(item, 8)
  page.drawText(item, { x: x + quantityWidth + (itemWidth - itemWidthText) / 2, y: rowTop - 14, size: 8, font, color: color(ink) })
  protocolLines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, 8)
    page.drawText(line, {
      x: x + quantityWidth + itemWidth + (protocolWidth - lineWidth) / 2,
      y: rowTop - 12 - index * 11,
      size: 8,
      font,
      color: color(ink),
    })
  })
  return rowTop - rowHeight
}

function drawReceiptCopy(
  page: import('pdf-lib').PDFPage,
  top: number,
  bottomLimit: number,
  data: {
    dateLabel: string
    addresses: string[]
    condominiums: string[]
    protocols: string[]
  },
  includeRecipientIdentification: boolean,
  font: import('pdf-lib').PDFFont,
  bold: import('pdf-lib').PDFFont,
  color: (value: typeof ink) => import('pdf-lib').Color,
) {
  const title = 'TERMO DE ENTREGA E RECEBIMENTO'
  const titleWidth = bold.widthOfTextAtSize(title, 10)
  page.drawText(title, { x: (pageWidth - titleWidth) / 2, y: top, size: 10, font: bold, color: color(ink) })
  let y = top - 23
  for (const line of ['De: AC Engenharia', 'At.te: Assistência técnica', 'Para: Responsável do condomínio']) {
    page.drawText(line, { x: margin, y, size: 9, font, color: color(ink) })
    y -= 12
  }
  y -= 2
  y = drawWrapped(page, `Endereço: ${data.addresses.join(' | ')}`, margin, y, contentWidth, font, 8.5, color, 11) - 2
  y = drawWrapped(page, data.condominiums.join(' | '), margin, y, contentWidth, bold, 8.5, color, 11) - 6
  page.drawText('Entrega de 01 envelope com o seguinte conteúdo descrito abaixo:', {
    x: margin, y, size: 9, font, color: color(ink),
  })
  y -= 10
  y = drawTable(page, y, data.protocols, font, bold, color) - 15

  const dateLine = `Aracaju/SE, ${data.dateLabel}.`
  const dateWidth = font.widthOfTextAtSize(dateLine, 9)
  page.drawText(dateLine, { x: pageWidth - margin - dateWidth, y, size: 9, font, color: color(ink) })
  y -= 27
  if (includeRecipientIdentification) {
    page.drawText('Recebido por:', { x: margin, y, size: 8.5, font, color: color(ink) })
    page.drawLine({ start: { x: margin + 49, y: y - 1 }, end: { x: margin + 285, y: y - 1 }, thickness: 0.6, color: color(ink) })
    page.drawText('RG/CPF:', { x: margin + 293, y, size: 8.5, font, color: color(ink) })
    page.drawLine({ start: { x: margin + 332, y: y - 1 }, end: { x: pageWidth - margin, y: y - 1 }, thickness: 0.6, color: color(ink) })
  }
  y -= 24
  page.drawText('Data de recebimento:', { x: margin, y, size: 8.5, font, color: color(ink) })
  page.drawLine({ start: { x: margin + 92, y: y - 1 }, end: { x: margin + 250, y: y - 1 }, thickness: 0.6, color: color(ink) })
  if (y - 8 < bottomLimit) {
    throw new Error('Os dados selecionados não cabem nas duas vias do termo. Reduza a quantidade de chamados ou endereços.')
  }
}

export async function createTicketLettersPdf(tickets: LetterTicket[], startDate: string) {
  if (!tickets.length) throw new Error('Selecione ao menos um chamado para gerar as cartas.')
  const clientNames = uniqueValues(tickets.map((ticket) => ticket.customerName.toLocaleLowerCase('pt-BR')))
  if (clientNames.length !== 1) throw new Error('Selecione chamados de um único cliente.')
  if (tickets.some((ticket) => !ticket.workAddress.trim())) {
    throw new Error('Cadastre o endereço da obra de todos os empreendimentos selecionados.')
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.TimesRoman)
  const bold = await document.embedFont(StandardFonts.TimesRomanBold)
  const color = (value: typeof ink) => rgb(value.r, value.g, value.b)
  const dateLabel = formatDate(startDate)
  const customerName = tickets[0].customerName.trim()
  const protocols = uniqueValues(tickets.map((ticket) => ticket.protocol.trim() || `ID ${ticket.id}`))
  const subsubjects = uniqueValues(tickets.map((ticket) => ticket.subsubject.trim() || ticket.subject.trim()))

  const notification = document.addPage([pageWidth, pageHeight])
  let y = pageHeight - 72
  y = drawWrapped(notification, `A(O) SENHOR(A) ${customerName}`, margin, y, contentWidth, font, 11, color, 15) - 10
  y = drawWrapped(notification, 'Prezado(a),', margin, y, contentWidth, font, 10, color, 14) - 8
  y = drawWrapped(
    notification,
    `Nós somos do setor de assistência técnica da construtora AC ENGENHARIA LTDA., CNPJ 13.358.072/0001-57 e gostaríamos de ressaltar que identificamos em nosso sistema a ausência da assinatura do termo de finalização do serviço, o qual já teve o atendimento realizado e concluído, do(s) protocolo(s) ${protocols.join(', ')}, de sub-assunto ${subsubjects.join('; ')}, registrado(s) no sistema de acompanhamento de chamados - Construtor de Vendas -. Com isso, realizamos contato telefônico na tentativa de agendarmos para recolher as assinaturas, porém não obtivemos sucesso.`,
    margin, y, contentWidth, font, 10, color, 14,
  ) - 14
  y = drawWrapped(
    notification,
    `Desse modo, enviaremos o termo de comprovação de finalização do serviço para assinatura e deixaremos na portaria do condomínio no prazo de 5 (cinco) dias, iniciando no dia ${dateLabel}.`,
    margin, y, contentWidth, font, 10, color, 14,
  ) - 10
  y = drawWrapped(
    notification,
    'Após o prazo citado acima, estaremos recolhendo os termos na portaria. E em caso de não assinatura finalizaremos o chamado no construtor de vendas como realizado/concluído.',
    margin, y, contentWidth, font, 10, color, 14,
  ) - 10
  y = drawWrapped(
    notification,
    'Na certeza de que nossas ações demonstram todo o nosso empenho e atenção, nós da AC Engenharia permanecemos inteiramente à disposição para eventuais esclarecimentos.',
    margin, y, contentWidth, font, 10, color, 14,
  ) - 15
  y = drawWrapped(notification, 'Atenciosamente,', margin, y, contentWidth, font, 10, color, 14) - 2
  notification.drawText('AC ENGENHARIA', { x: margin, y, size: 10, font, color: color(ink) })
  const notificationDate = `Aracaju/SE, ${dateLabel}.`
  const notificationDateWidth = font.widthOfTextAtSize(notificationDate, 10)
  notification.drawText(notificationDate, { x: pageWidth - margin - notificationDateWidth, y: 80, size: 10, font, color: color(ink) })

  const receipt = document.addPage([pageWidth, pageHeight])
  const sites = new Map<string, { enterprise: string; address: string; blocks: Set<string>; units: Set<string> }>()
  for (const ticket of tickets) {
    const key = [ticket.enterprise, ticket.workAddress].map((value) => value.trim().toLocaleLowerCase('pt-BR')).join('\u0000')
    const site = sites.get(key) ?? { enterprise: ticket.enterprise.trim(), address: ticket.workAddress.trim(), blocks: new Set<string>(), units: new Set<string>() }
    if (ticket.block.trim()) site.blocks.add(ticket.block.trim())
    if (ticket.unit.trim()) site.units.add(ticket.unit.trim())
    sites.set(key, site)
  }
  const siteValues = [...sites.values()]
  const addresses = uniqueValues(siteValues.map((site) => site.address))
  const condominiums = siteValues.map((site) => [
    site.enterprise,
    site.blocks.size ? [...site.blocks].join(', ') : '',
    site.units.size ? [...site.units].join(', ') : '',
  ].filter(Boolean).join(' – '))

  drawReceiptCopy(receipt, pageHeight - 35, pageHeight / 2 + 18, { dateLabel, addresses, condominiums, protocols }, true, font, bold, color)
  receipt.drawLine({
    start: { x: margin, y: pageHeight / 2 },
    end: { x: pageWidth - margin, y: pageHeight / 2 },
    thickness: 0.4,
    color: color(muted),
  })
  drawReceiptCopy(receipt, pageHeight / 2 - 24, 24, { dateLabel, addresses, condominiums, protocols }, false, font, bold, color)

  return document.save()
}
