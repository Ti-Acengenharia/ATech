import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import type { TicketSummary } from './types'

export interface VisitPhotoItem {
  id: string
  name: string
  dataUrl: string
  size?: number
}

export interface VisitFormData {
  inspectedEnvironments: string
  hasFurniture: 'sim' | 'nao' | ''
  needsClearance: 'sim' | 'nao' | 'nao_se_aplica' | ''
  damagedFurniture: 'sim' | 'nao' | 'nao_se_aplica' | ''
  needsMaterialPurchase: 'sim' | 'nao' | ''
  materialPurchaseDetails: string
  estimatedExecutionDays: number | null
  standardDeliveryColor: 'sim' | 'nao' | 'nao_se_aplica' | ''
  observations: string
  photos: Record<string, VisitPhotoItem[]>
}

export interface VisitPdfContext {
  ticket: TicketSummary
  visitData: VisitFormData
  visitDateBr: string
  openedDateBr: string
  clientName: string
  clientDocument: string
  clientSignatureDataUrl?: string
  internalUserName: string
  internalSignatureBase64: string
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 42
const CONTENT_W = PAGE_W - MARGIN * 2

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const safe = (text || '').trim()
  if (!safe) return ['']
  return safe.split(/\r?\n/).flatMap((paragraph) => {
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
        for (const ch of Array.from(word)) {
          const seg = current + ch
          if (font.widthOfTextAtSize(seg, size) > maxWidth && current) {
            lines.push(current)
            current = ch
          } else {
            current = seg
          }
        }
      }
    }
    if (current) lines.push(current)
    return lines
  })
}

async function loadLogoPng(pdfDoc: import('pdf-lib').PDFDocument): Promise<PDFImage | null> {
  try {
    const res = await fetch('/logo-ac.png')
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return await pdfDoc.embedPng(bytes)
  } catch {
    return null
  }
}

async function embedDataImage(
  pdfDoc: import('pdf-lib').PDFDocument,
  dataUrlOrBase64: string,
): Promise<PDFImage | null> {
  try {
    const clean = dataUrlOrBase64.trim()
    if (!clean) return null
    const isJpeg = clean.startsWith('data:image/jpeg') || clean.startsWith('data:image/jpg')
    const base64 = clean.includes(',') ? clean.split(',')[1] : clean
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes)
  } catch {
    return null
  }
}

function drawDocumentHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  logo: PDFImage | null,
  subtitle: string,
  code: 'AT001' | 'AT002',
  pageNumber: number,
  totalPages: number,
  rgb: typeof import('pdf-lib').rgb,
) {
  const topY = PAGE_H - 36

  // Logo à esquerda
  if (logo) {
    const dims = logo.scaleToFit(76, 36)
    page.drawImage(logo, {
      x: MARGIN,
      y: topY - dims.height + 6,
      width: dims.width,
      height: dims.height,
    })
  } else {
    page.drawText('AC ENGENHARIA', {
      x: MARGIN,
      y: topY - 12,
      size: 11,
      font: bold,
      color: rgb(0.08, 0.24, 0.56),
    })
  }

  // Título centralizado
  const title1 = 'ASSISTÊNCIA TÉCNICA'
  const w1 = bold.widthOfTextAtSize(title1, 12.5)
  page.drawText(title1, {
    x: (PAGE_W - w1) / 2,
    y: topY - 6,
    size: 12.5,
    font: bold,
    color: rgb(0.1, 0.14, 0.2),
  })

  const w2 = bold.widthOfTextAtSize(subtitle, 10)
  page.drawText(subtitle, {
    x: (PAGE_W - w2) / 2,
    y: topY - 21,
    size: 10,
    font: bold,
    color: rgb(0.2, 0.28, 0.38),
  })

  // Controle de versão à direita
  const metaLines = [
    `Página ${pageNumber} de ${totalPages}`,
    'Revisão: 03',
    `Código: ${code}`,
    'Data: 26/11/2026',
  ]
  metaLines.forEach((line, idx) => {
    const lw = font.widthOfTextAtSize(line, 8.5)
    page.drawText(line, {
      x: PAGE_W - MARGIN - lw,
      y: topY - idx * 10.5,
      size: 8.5,
      font,
      color: rgb(0.22, 0.27, 0.34),
    })
  })

  page.drawLine({
    start: { x: MARGIN, y: topY - 46 },
    end: { x: PAGE_W - MARGIN, y: topY - 46 },
    thickness: 0.9,
    color: rgb(0.75, 0.81, 0.88),
  })

  return topY - 68
}

function formatYesNoLabel(value: string): string {
  if (value === 'sim') return 'Sim'
  if (value === 'nao') return 'Não'
  if (value === 'nao_se_aplica') return 'Não se aplica'
  return 'Não informado'
}

export async function generateVisitDeclarationPdf(options: {
  isTemplate?: boolean
  ticket?: TicketSummary
  clientName?: string
  clientDocument?: string
  clientSignatureDataUrl?: string
  visitDateBr?: string
  openedDateBr?: string
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadLogoPng(pdfDoc)

  const page = pdfDoc.addPage([PAGE_W, PAGE_H])
  let y = drawDocumentHeader(
    page,
    font,
    bold,
    logo,
    'DECLARAÇÃO DE VISITA TÉCNICA',
    'AT001',
    1,
    1,
    rgb,
  )

  const mainTitle = 'DECLARAÇÃO DE VISITA TÉCNICA'
  const mainTitleW = bold.widthOfTextAtSize(mainTitle, 13)
  page.drawText(mainTitle, {
    x: (PAGE_W - mainTitleW) / 2,
    y: y - 8,
    size: 13,
    font: bold,
    color: rgb(0.08, 0.14, 0.24),
  })
  y -= 58

  let bodyText: string
  if (options.isTemplate) {
    const ent = options.ticket?.enterprise || '______________________________________'
    const blk = options.ticket?.block || '______________'
    const uni = options.ticket?.unit || '______________'
    const proto = options.ticket?.protocol || '________________________'
    const openDate = options.openedDateBr || '____/____/________'
    bodyText =
      `Eu ______________________________________________________, documento n.º ________________________, ` +
      `empreendimento ${ent}, bloco ${blk}, unidade ${uni} declaro para os devidos fins que ` +
      `foi realizado visita técnica pelo colaborador da Ac Engenharia no dia ____/____/________, ` +
      `referente ao chamado protocolo n.º ${proto} que teve como data de abertura ${openDate}.`
  } else {
    const cName = options.clientName || '____________________________'
    const cDoc = options.clientDocument || '________________'
    const ent = options.ticket?.enterprise || 'Não informado'
    const blk = options.ticket?.block || '-'
    const uni = options.ticket?.unit || '-'
    const vDate = options.visitDateBr || '____/____/________'
    const proto = options.ticket?.protocol || '-'
    const oDate = options.openedDateBr || '-'
    bodyText =
      `Eu ${cName}, documento n.º ${cDoc}, empreendimento ${ent}, bloco ${blk}, unidade ${uni} ` +
      `declaro para os devidos fins que foi realizado visita técnica pelo colaborador da Ac Engenharia ` +
      `no dia ${vDate}, referente ao chamado protocolo n.º ${proto} que teve como data de abertura ${oDate}.`
  }

  const lines = wrapText(bodyText, CONTENT_W, font, 11.5)
  for (const line of lines) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 11.5,
      font,
      color: rgb(0.12, 0.16, 0.22),
    })
    y -= 24
  }

  // Assinatura centralizada do cliente
  const sigCenterY = Math.min(y - 70, 290)
  const lineWidth = 260
  const lineStartX = (PAGE_W - lineWidth) / 2

  if (!options.isTemplate && options.clientSignatureDataUrl) {
    const sigImg = await embedDataImage(pdfDoc, options.clientSignatureDataUrl)
    if (sigImg) {
      const dims = sigImg.scaleToFit(190, 64)
      page.drawImage(sigImg, {
        x: (PAGE_W - dims.width) / 2,
        y: sigCenterY + 6,
        width: dims.width,
        height: dims.height,
      })
    }
  }

  page.drawLine({
    start: { x: lineStartX, y: sigCenterY },
    end: { x: lineStartX + lineWidth, y: sigCenterY },
    thickness: 1,
    color: rgb(0.2, 0.25, 0.32),
  })

  const label1 = options.isTemplate
    ? 'Assinatura do Cliente'
    : (options.clientName || 'Assinatura do Cliente')
  const lw1 = bold.widthOfTextAtSize(label1, 10)
  page.drawText(label1, {
    x: (PAGE_W - lw1) / 2,
    y: sigCenterY - 15,
    size: 10,
    font: bold,
    color: rgb(0.14, 0.18, 0.24),
  })

  if (!options.isTemplate && options.clientDocument) {
    const label2 = `Documento n.º ${options.clientDocument}`
    const lw2 = font.widthOfTextAtSize(label2, 9)
    page.drawText(label2, {
      x: (PAGE_W - lw2) / 2,
      y: sigCenterY - 29,
      size: 9,
      font,
      color: rgb(0.35, 0.42, 0.5),
    })
  }

  return await pdfDoc.save()
}

export async function generateVisitReportPdf(ctx: VisitPdfContext): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadLogoPng(pdfDoc)

  const pages: PDFPage[] = []
  let page = pdfDoc.addPage([PAGE_W, PAGE_H])
  pages.push(page)

  let y = PAGE_H - 104 // reserve header space; headers stamped at the end with totalPages

  const ensureSpace = (needed: number) => {
    if (y - needed < 54) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H])
      pages.push(page)
      y = PAGE_H - 104
    }
  }

  const drawSectionBar = (title: string) => {
    ensureSpace(28)
    const w = bold.widthOfTextAtSize(title, 9.5)
    page.drawText(title, {
      x: (PAGE_W - w) / 2,
      y,
      size: 9.5,
      font: bold,
      color: rgb(0.08, 0.16, 0.28),
    })
    y -= 10
  }

  const drawBoxRow = (cells: Array<{ label: string; value: string; ratio: number }>, minH = 26) => {
    const lineH = 11.5
    const wrappedCells = cells.map((cell) => {
      const cw = CONTENT_W * cell.ratio - 12
      const vLines = wrapText(cell.value || '-', cw, font, 9)
      return { ...cell, vLines }
    })
    const maxLines = Math.max(1, ...wrappedCells.map((c) => c.vLines.length))
    const rowH = Math.max(minH, 16 + maxLines * lineH)
    ensureSpace(rowH + 4)

    let curX = MARGIN
    for (const cell of wrappedCells) {
      const cellW = CONTENT_W * cell.ratio
      page.drawRectangle({
        x: curX,
        y: y - rowH,
        width: cellW,
        height: rowH,
        borderWidth: 0.75,
        borderColor: rgb(0.28, 0.34, 0.42),
      })
      page.drawText(cell.label, {
        x: curX + 6,
        y: y - 11,
        size: 7.8,
        font: bold,
        color: rgb(0.18, 0.24, 0.32),
      })
      cell.vLines.forEach((line, idx) => {
        page.drawText(line, {
          x: curX + 6,
          y: y - 22 - idx * lineH,
          size: 9,
          font,
          color: rgb(0.12, 0.16, 0.22),
        })
      })
      curX += cellW
    }
    y -= rowH
  }

  // DADOS DO CLIENTE
  drawSectionBar('DADOS DO CLIENTE')
  drawBoxRow([
    { label: 'CLIENTE:', value: ctx.clientName || ctx.ticket.customerName || '-', ratio: 0.55 },
    { label: 'EMPREENDIMENTO:', value: ctx.ticket.enterprise || '-', ratio: 0.45 },
  ])
  drawBoxRow([
    { label: 'BLOCO:', value: ctx.ticket.block || '-', ratio: 0.5 },
    { label: 'UNIDADE:', value: ctx.ticket.unit || '-', ratio: 0.5 },
  ])

  y -= 10
  drawSectionBar('DADOS DO ATENDIMENTO')
  drawBoxRow([
    { label: 'PROTOCOLO:', value: `#${ctx.ticket.protocol}`, ratio: 0.34 },
    { label: 'DATA DA VISITA:', value: ctx.visitDateBr, ratio: 0.33 },
    { label: 'RESPONSÁVEL:', value: ctx.internalUserName, ratio: 0.33 },
  ])

  y -= 10
  drawSectionBar('RELATÓRIO DA VISTORIA')

  const v = ctx.visitData
  drawBoxRow([
    { label: '1. Quais foram os ambientes vistoriados?', value: v.inspectedEnvironments, ratio: 1 },
  ], 42)
  drawBoxRow([
    { label: '2. Tem móvel no local?', value: formatYesNoLabel(v.hasFurniture), ratio: 0.33 },
    { label: '3. Há necessidade de desobstrução?', value: formatYesNoLabel(v.needsClearance), ratio: 0.34 },
    { label: '4. Algum móvel danificado?', value: formatYesNoLabel(v.damagedFurniture), ratio: 0.33 },
  ], 34)
  drawBoxRow([
    {
      label: '5. Necessidade de compra de material? / 6. Quais?',
      value: v.needsMaterialPurchase === 'sim'
        ? `Sim — ${v.materialPurchaseDetails || '-'}`
        : 'Não',
      ratio: 1,
    },
  ], 38)
  drawBoxRow([
    {
      label: '7. Qual o tempo estimado para execução do serviço?',
      value: v.estimatedExecutionDays !== null ? `${v.estimatedExecutionDays} dia(s)` : '-',
      ratio: 0.5,
    },
    {
      label: '8. O ambiente está na cor padrão da entrega?',
      value: formatYesNoLabel(v.standardDeliveryColor),
      ratio: 0.5,
    },
  ], 34)
  drawBoxRow([
    { label: '9. Observações, causas da visita, etc.:', value: v.observations, ratio: 1 },
  ], 48)

  // FOTOS ANEXADAS
  const photoEntries: Array<{ label: string; photo: VisitPhotoItem }> = []
  const fieldLabels: Record<string, string> = {
    inspectedEnvironments: 'Ambientes vistoriados',
    hasFurniture: 'Móvel no local',
    needsClearance: 'Necessidade de desobstrução',
    damagedFurniture: 'Móvel danificado',
    needsMaterialPurchase: 'Compra de material',
    materialPurchaseDetails: 'Materiais necessários',
    estimatedExecutionDays: 'Tempo estimado',
    standardDeliveryColor: 'Cor padrão da entrega',
    observations: 'Observações / Causas da visita',
  }

  for (const [key, list] of Object.entries(v.photos || {})) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (item?.dataUrl) {
        photoEntries.push({ label: fieldLabels[key] || key, photo: item })
      }
    }
  }

  if (photoEntries.length > 0) {
    y -= 14
    drawSectionBar('REGISTRO FOTOGRÁFICO DA VISTORIA')
    const boxW = (CONTENT_W - 12) / 2
    const boxH = 168

    for (let i = 0; i < photoEntries.length; i += 2) {
      ensureSpace(boxH + 14)
      for (let col = 0; col < 2; col++) {
        const entry = photoEntries[i + col]
        if (!entry) continue
        const x = MARGIN + col * (boxW + 12)
        page.drawRectangle({
          x,
          y: y - boxH,
          width: boxW,
          height: boxH,
          borderWidth: 0.75,
          borderColor: rgb(0.75, 0.81, 0.88),
        })
        const img = await embedDataImage(pdfDoc, entry.photo.dataUrl)
        if (img) {
          const dims = img.scaleToFit(boxW - 12, boxH - 28)
          page.drawImage(img, {
            x: x + (boxW - dims.width) / 2,
            y: y - boxH + 20 + (boxH - 28 - dims.height) / 2,
            width: dims.width,
            height: dims.height,
          })
        }
        const caption = `${entry.label}: ${entry.photo.name}`.slice(0, 48)
        page.drawText(caption, {
          x: x + 6,
          y: y - boxH + 7,
          size: 7.5,
          font,
          color: rgb(0.32, 0.38, 0.46),
        })
      }
      y -= boxH + 10
    }
  }

  // ASSINATURA DO RESPONSÁVEL PELA VISITA INTERNA
  ensureSpace(95)
  y -= 24
  const sigImg = await embedDataImage(pdfDoc, ctx.internalSignatureBase64)
  const lineW = 240
  const lineX = (PAGE_W - lineW) / 2
  if (sigImg) {
    const dims = sigImg.scaleToFit(180, 52)
    page.drawImage(sigImg, {
      x: (PAGE_W - dims.width) / 2,
      y: y - 42,
      width: dims.width,
      height: dims.height,
    })
  }
  const lineY = y - 46
  page.drawLine({
    start: { x: lineX, y: lineY },
    end: { x: lineX + lineW, y: lineY },
    thickness: 0.9,
    color: rgb(0.2, 0.25, 0.32),
  })
  const respText = ctx.internalUserName || 'Responsável pela Visita'
  const rw = bold.widthOfTextAtSize(respText, 9.5)
  page.drawText(respText, {
    x: (PAGE_W - rw) / 2,
    y: lineY - 13,
    size: 9.5,
    font: bold,
    color: rgb(0.14, 0.18, 0.24),
  })
  const roleSub = 'Responsável pela Visita Técnica · AC Engenharia'
  const rsw = font.widthOfTextAtSize(roleSub, 8)
  page.drawText(roleSub, {
    x: (PAGE_W - rsw) / 2,
    y: lineY - 24,
    size: 8,
    font,
    color: rgb(0.38, 0.45, 0.52),
  })

  // Stamp header on all pages with final page count
  const totalPages = pages.length
  pages.forEach((p, idx) => {
    drawDocumentHeader(
      p,
      font,
      bold,
      logo,
      'RELATÓRIO DE VISTORIA',
      'AT002',
      idx + 1,
      totalPages,
      rgb,
    )
  })

  return await pdfDoc.save()
}
