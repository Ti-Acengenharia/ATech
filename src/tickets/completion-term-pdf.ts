import type { Color, PDFFont, PDFPage } from 'pdf-lib'
import type { TicketSummary } from './types'

export interface CompletionTermData {
  serviceStartDate: string
  activities: string
  engineeringSignature?: string
  clientName?: string
  clientDocument?: string
  clientSignature?: string
}

const pageWidth = 595.28
const pageHeight = 841.89
const margin = 42
const contentWidth = pageWidth - margin * 2
const navy = { r: 0.08, g: 0.2, b: 0.35 }
const blue = { r: 0.13, g: 0.38, b: 0.58 }
const paleBlue = { r: 0.93, g: 0.96, b: 0.98 }
const ink = { r: 0.15, g: 0.2, b: 0.25 }
const muted = { r: 0.39, g: 0.46, b: 0.52 }
const border = { r: 0.82, g: 0.87, b: 0.91 }
const white = { r: 1, g: 1, b: 1 }

function wrapText(value: string, maxWidth: number, font: PDFFont, size: number) {
  return value.split(/\r?\n/).flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (!words.length) return ['']
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        current = next
      } else {
        if (current) lines.push(current)
        current = ''
        for (const character of Array.from(word)) {
          const segment = current + character
          if (font.widthOfTextAtSize(segment, size) > maxWidth && current) {
            lines.push(current)
            current = character
          } else {
            current = segment
          }
        }
      }
    }
    if (current) lines.push(current)
    return lines
  })
}

function drawPageHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  protocol: string,
  pageNumber: number,
  totalPages: number,
  color: (value: { r: number; g: number; b: number }) => Color,
) {
  page.drawRectangle({ x: 0, y: pageHeight - 112, width: pageWidth, height: 112, color: color(navy) })
  page.drawText('AC', { x: margin, y: pageHeight - 63, size: 26, font: bold, color: color(white) })
  page.drawText('ENGENHARIA', { x: margin + 2, y: pageHeight - 78, size: 7, font, color: color(white) })
  page.drawText('ASSISTÊNCIA TÉCNICA', { x: 168, y: pageHeight - 48, size: 9, font: bold, color: color(white) })
  page.drawText('TERMO DE FINALIZAÇÃO DE SERVIÇO', { x: 168, y: pageHeight - 69, size: 14, font: bold, color: color(white) })
  page.drawText(`PROTOCOLO  #${protocol}`, {
    x: pageWidth - margin - 148,
    y: pageHeight - 48,
    size: 8,
    font: bold,
    color: color(white),
    maxWidth: 148,
  })
  page.drawText(`${pageNumber} / ${totalPages}`, {
    x: pageWidth - margin - 22,
    y: pageHeight - 78,
    size: 8,
    font,
    color: color(white),
  })
}

function drawFooter(page: PDFPage, font: PDFFont, color: (value: { r: number; g: number; b: number }) => Color) {
  page.drawLine({
    start: { x: margin, y: 34 },
    end: { x: pageWidth - margin, y: 34 },
    thickness: 0.6,
    color: color(border),
  })
  page.drawText('AC Engenharia · Termo de finalização de serviço', {
    x: margin,
    y: 20,
    size: 7,
    font,
    color: color(muted),
  })
}

function drawField(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  bold: PDFFont,
  color: (value: { r: number; g: number; b: number }) => Color,
) {
  page.drawText(label.toLocaleUpperCase('pt-BR'), {
    x: x + 11,
    y: y + 25,
    size: 6.5,
    font: bold,
    color: color(muted),
  })
  page.drawText(value || '—', {
    x: x + 11,
    y: y + 10,
    size: 9,
    font,
    color: color(ink),
    maxWidth: width - 22,
  })
}

async function drawSignaturePanel(
  page: PDFPage,
  data: CompletionTermData,
  signatures: boolean,
  bold: PDFFont,
  document: import('pdf-lib').PDFDocument,
  y: number,
  color: (value: { r: number; g: number; b: number }) => Color,
) {
  const gap = 9
  const panelWidth = (contentWidth - gap) / 2
  const panelHeight = 115
  const panels = [
    { title: 'AC ENGENHARIA', signature: data.engineeringSignature },
    { title: 'CLIENTE', signature: data.clientSignature },
  ]

  page.drawText('ASSINATURAS', { x: margin, y: y + panelHeight + 17, size: 8, font: bold, color: color(navy) })
  for (const [index, panel] of panels.entries()) {
    const x = margin + index * (panelWidth + gap)
    page.drawRectangle({
      x,
      y,
      width: panelWidth,
      height: panelHeight,
      borderColor: color(border),
      borderWidth: 0.8,
      color: color(white),
    })
    page.drawRectangle({ x, y, width: panelWidth, height: 25, color: color(paleBlue) })
    page.drawText(panel.title, { x: x + 9, y: y + 9, size: 7, font: bold, color: color(blue) })
    page.drawLine({
      start: { x: x + 10, y: y + 31 },
      end: { x: x + panelWidth - 10, y: y + 31 },
      thickness: 0.6,
      color: color(border),
    })
    if (signatures && panel.signature) {
      const image = await document.embedPng(panel.signature)
      const imageHeight = 46
      const imageWidth = Math.min(panelWidth - 28, imageHeight * image.width / image.height)
      page.drawImage(image, {
        x: x + (panelWidth - imageWidth) / 2,
        y: y + 38,
        width: imageWidth,
        height: imageHeight,
      })
    }
  }
}

export async function createCompletionTermPdf(ticket: TicketSummary, data: CompletionTermData) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const color = (value: { r: number; g: number; b: number }) => rgb(value.r, value.g, value.b)

  const activities = wrapText(data.activities, contentWidth - 26, font, 9.5)
  const lineHeight = 14
  const activityBoxPadding = 14
  const firstPageTop = pageHeight - 138
  const metadataHeight = 76
  const sectionGap = 16
  const activityTitleHeight = 31
  const signatureBlockHeight = 150
  const metadataY = firstPageTop - metadataHeight
  const statement = `Eu, ${data.clientName?.trim() || '________________________________'}, documento ${data.clientDocument?.trim() || '____________________'}, declaro que o serviço referente ao protocolo ${ticket.protocol} foi concluído no empreendimento ${ticket.enterprise || '____________________________'}, bloco ${ticket.block || '________'}, unidade ${ticket.unit || '________'}, conforme as atividades descritas neste termo.`
  const statementLines = wrapText(statement, contentWidth - 18, font, 8.5)
  const statementHeight = statementLines.length * 12 + 12
  const activityBoxTop = metadataY - sectionGap - 28 - statementHeight - sectionGap - activityTitleHeight
  const firstCapacityWithSignatures = Math.max(
    0,
    Math.floor((activityBoxTop - activityBoxPadding * 2 - 65 - signatureBlockHeight) / lineHeight),
  )
  const firstCapacityWithoutSignatures = Math.max(
    1,
    Math.floor((activityBoxTop - activityBoxPadding * 2 - 65) / lineHeight),
  )
  const continuedBoxTop = pageHeight - 140 - sectionGap
  const continuedCapacityWithSignatures = Math.max(
    1,
    Math.floor((continuedBoxTop - activityBoxPadding * 2 - 65 - signatureBlockHeight) / lineHeight),
  )
  const continuedCapacityWithoutSignatures = Math.max(
    1,
    Math.floor((continuedBoxTop - activityBoxPadding * 2 - 65) / lineHeight),
  )
  const firstPageHasSignatures = activities.length <= firstCapacityWithSignatures
  const firstCapacity = firstPageHasSignatures
    ? firstCapacityWithSignatures
    : Math.min(
      firstCapacityWithoutSignatures,
      Math.max(firstCapacityWithSignatures, activities.length - continuedCapacityWithSignatures),
    )
  const firstLines = activities.slice(0, firstCapacity)
  const remaining = activities.slice(firstLines.length)
  let continuedPages = 0
  if (remaining.length) {
    continuedPages = 1
    let pagesBeforeFinal = remaining.length - continuedCapacityWithSignatures
    while (pagesBeforeFinal > 0) {
      continuedPages += 1
      pagesBeforeFinal -= continuedCapacityWithoutSignatures
    }
  }
  const totalPages = 1 + continuedPages
  const pages = Array.from({ length: totalPages }, () => document.addPage([pageWidth, pageHeight]))

  pages.forEach((page, index) => drawPageHeader(page, font, bold, ticket.protocol, index + 1, totalPages, color))
  const firstPage = pages[0]
  let y = firstPageTop
  firstPage.drawRectangle({ x: margin, y: metadataY, width: contentWidth, height: metadataHeight, color: color(paleBlue) })
  firstPage.drawRectangle({ x: margin, y: metadataY, width: contentWidth, height: metadataHeight, borderColor: color(border), borderWidth: 0.8 })

  const fieldGap = 7
  const fieldWidth = (contentWidth - fieldGap * 3) / 4
  const fields = [
    ['EMPREENDIMENTO', ticket.enterprise || 'Não informado'],
    ['BLOCO', ticket.block || 'Não informado'],
    ['UNIDADE', ticket.unit || 'Não informada'],
    ['PROTOCOLO', ticket.protocol],
  ]
  fields.forEach(([label, value], index) => {
    drawField(firstPage, label, value, margin + index * (fieldWidth + fieldGap), metadataY, fieldWidth, font, bold, color)
  })
  const clientMetadataGap = 8
  const serviceDateWidth = 120
  const clientNameWidth = 230
  const clientDocumentWidth = contentWidth - serviceDateWidth - clientNameWidth - clientMetadataGap * 2
  drawField(firstPage, 'INÍCIO DO SERVIÇO', formatDate(data.serviceStartDate), margin, metadataY + 37, serviceDateWidth, font, bold, color)
  drawField(firstPage, 'CLIENTE', data.clientName ?? '', margin + serviceDateWidth + clientMetadataGap, metadataY + 37, clientNameWidth, font, bold, color)
  drawField(firstPage, 'RG/CPF DO CLIENTE', data.clientDocument ?? '', margin + serviceDateWidth + clientNameWidth + clientMetadataGap * 2, metadataY + 37, clientDocumentWidth, font, bold, color)

  y = metadataY - sectionGap
  firstPage.drawText('DECLARAÇÃO', { x: margin, y: y - 10, size: 8, font: bold, color: color(blue) })
  y -= 28
  firstPage.drawRectangle({
    x: margin,
    y: y - statementLines.length * 12 - 12,
    width: contentWidth,
    height: statementLines.length * 12 + 12,
    color: color(white),
    borderColor: color(border),
    borderWidth: 0.8,
  })
  statementLines.forEach((line, index) => firstPage.drawText(line, {
    x: margin + 9,
    y: y - 8 - index * 12,
    size: 8.5,
    font,
    color: color(ink),
  }))
  y -= statementLines.length * 12 + 12 + sectionGap
  firstPage.drawText('ATIVIDADES REALIZADAS', { x: margin, y: y - 10, size: 8, font: bold, color: color(blue) })
  y -= activityTitleHeight
  const firstBoxHeight = firstLines.length * lineHeight + activityBoxPadding * 2
  firstPage.drawRectangle({
    x: margin,
    y: y - firstBoxHeight,
    width: contentWidth,
    height: firstBoxHeight,
    color: color(white),
    borderColor: color(border),
    borderWidth: 0.8,
  })
  firstLines.forEach((line, index) => firstPage.drawText(line, {
    x: margin + activityBoxPadding,
    y: y - activityBoxPadding - 8 - index * lineHeight,
    size: 9.5,
    font,
    color: color(ink),
  }))

  let remainingLines = remaining
  for (const [index, page] of pages.slice(1).entries()) {
    const isLastPage = index === pages.length - 2
    const capacity = isLastPage
      ? continuedCapacityWithSignatures
      : Math.min(continuedCapacityWithoutSignatures, Math.max(0, remainingLines.length - continuedCapacityWithSignatures))
    const lines = remainingLines.slice(0, capacity)
    remainingLines = remainingLines.slice(lines.length)
    const headingY = pageHeight - 140
    page.drawText('ATIVIDADES REALIZADAS · CONTINUAÇÃO', {
      x: margin,
      y: headingY,
      size: 8,
      font: bold,
      color: color(blue),
    })
    const boxY = headingY - sectionGap
    const boxHeight = lines.length * lineHeight + activityBoxPadding * 2
    page.drawRectangle({
      x: margin,
      y: boxY - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: color(white),
      borderColor: color(border),
      borderWidth: 0.8,
    })
    lines.forEach((line, lineIndex) => page.drawText(line, {
      x: margin + activityBoxPadding,
      y: boxY - activityBoxPadding - 8 - lineIndex * lineHeight,
      size: 9.5,
      font,
      color: color(ink),
    }))
  }

  const lastPage = pages[pages.length - 1]
  await drawSignaturePanel(lastPage, data, Boolean(data.engineeringSignature || data.clientSignature), bold, document, 65, color)

  pages.forEach((page) => drawFooter(page, font, color))
  return document.save()
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}
