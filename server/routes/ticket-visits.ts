import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { APP_TIMEZONE } from '../config.js'
import { pool, safeRollback } from '../db.js'
import { recordAuditLog } from '../services/audit-log.js'
import { recordTicketActivity } from '../services/ticket-activity.js'
import { broadcastSyncEvent } from '../services/sync-events.js'
import { detectBinaryMimeType } from '../services/file-validation.js'
import { decryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'
import { getCvcrmVisitSyncSettings, sendCvcrmVisitDocumentComment } from '../services/cvcrm-visit-sync.js'

const router = Router()

const idSchema = z.coerce.number().int().positive()

const visitPhotoSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(20).max(2_000_000),
  size: z.number().int().nonnegative().optional(),
})

const visitPhotosMapSchema = z.record(z.string().max(60), z.array(visitPhotoSchema).max(10)).default({})

const draftPayloadSchema = z.object({
  inspectedEnvironments: z.string().max(5000).default(''),
  hasFurniture: z.enum(['', 'sim', 'nao']).default(''),
  needsClearance: z.enum(['', 'sim', 'nao', 'nao_se_aplica']).default(''),
  damagedFurniture: z.enum(['', 'sim', 'nao', 'nao_se_aplica']).default(''),
  needsMaterialPurchase: z.enum(['', 'sim', 'nao']).default(''),
  materialPurchaseDetails: z.string().max(5000).default(''),
  estimatedExecutionDays: z.number().int().min(0).max(3650).nullable().default(null),
  standardDeliveryColor: z.enum(['', 'sim', 'nao', 'nao_se_aplica']).default(''),
  observations: z.string().max(8000).default(''),
  photos: visitPhotosMapSchema,
})

const finalizePayloadSchema = z.object({
  inspectedEnvironments: z.string().trim().min(1, 'Informe quais foram os ambientes vistoriados.').max(5000),
  hasFurniture: z.enum(['sim', 'nao'], { message: 'Informe se há móvel no local.' }),
  needsClearance: z.enum(['sim', 'nao', 'nao_se_aplica'], { message: 'Informe se há necessidade de desobstrução.' }),
  damagedFurniture: z.enum(['sim', 'nao', 'nao_se_aplica'], { message: 'Informe se há algum móvel danificado.' }),
  needsMaterialPurchase: z.enum(['sim', 'nao'], { message: 'Informe se há necessidade de compra de material.' }),
  materialPurchaseDetails: z.string().trim().max(5000).default(''),
  estimatedExecutionDays: z.number().int().min(0, 'Informe o tempo estimado em dias.').max(3650),
  standardDeliveryColor: z.enum(['sim', 'nao', 'nao_se_aplica'], { message: 'Informe se o ambiente está na cor padrão da entrega.' }),
  observations: z.string().trim().min(1, 'Informe as observações e causas da visita.').max(8000),
  photos: visitPhotosMapSchema,
  clientName: z.string().trim().min(2, 'Informe o nome do cliente que acompanhou a visita.').max(240),
  clientDocument: z.string().trim().min(3, 'Informe o número do documento do cliente.').max(80),
  clientSignatureData: z.string().min(30, 'Colete a assinatura digital do cliente.').max(2_000_000),
  declarationPdfBase64: z.string().min(10).max(20_000_000),
  reportPdfBase64: z.string().min(10).max(25_000_000),
})

function formatDateBr(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: APP_TIMEZONE,
  }).format(date)
}

function mapVisitRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    protocol: String(row.protocol ?? ''),
    status: String(row.status ?? 'draft') as 'draft' | 'finalized',
    inspectedEnvironments: String(row.inspected_environments ?? ''),
    hasFurniture: String(row.has_furniture ?? ''),
    needsClearance: String(row.needs_clearance ?? ''),
    damagedFurniture: String(row.damaged_furniture ?? ''),
    needsMaterialPurchase: String(row.needs_material_purchase ?? ''),
    materialPurchaseDetails: String(row.material_purchase_details ?? ''),
    estimatedExecutionDays: row.estimated_execution_days !== null && row.estimated_execution_days !== undefined
      ? Number(row.estimated_execution_days)
      : null,
    standardDeliveryColor: String(row.standard_delivery_color ?? ''),
    observations: String(row.observations ?? ''),
    photos: (row.photos && typeof row.photos === 'object' ? row.photos : {}) as Record<string, unknown[]>,
    clientName: row.client_name ? String(row.client_name) : null,
    clientDocument: row.client_document ? String(row.client_document) : null,
    clientSignatureData: row.client_signature_data ? String(row.client_signature_data) : null,
    visitDate: row.visit_date ? new Date(String(row.visit_date)).toISOString() : null,
    declarationAttachmentId: row.declaration_attachment_id ? String(row.declaration_attachment_id) : null,
    reportAttachmentId: row.report_attachment_id ? String(row.report_attachment_id) : null,
    cvcrmDeclarationStatus: String(row.cvcrm_declaration_status ?? 'pending'),
    cvcrmDeclarationError: row.cvcrm_declaration_error ? String(row.cvcrm_declaration_error) : null,
    cvcrmDeclarationSentAt: row.cvcrm_declaration_sent_at ? new Date(String(row.cvcrm_declaration_sent_at)).toISOString() : null,
    cvcrmReportStatus: String(row.cvcrm_report_status ?? 'pending'),
    cvcrmReportError: row.cvcrm_report_error ? String(row.cvcrm_report_error) : null,
    cvcrmReportSentAt: row.cvcrm_report_sent_at ? new Date(String(row.cvcrm_report_sent_at)).toISOString() : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    finalizedByName: row.finalized_by_name ? String(row.finalized_by_name) : null,
    finalizedAt: row.finalized_at ? new Date(String(row.finalized_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

router.use(requireAuth, requirePageAccess('tickets'))

router.get('/visits/my-signature', async (req, res, next) => {
  try {
    const user = req.session.user!
    const result = await pool.query<{ signature_data_ciphertext: string | null }>(
      `SELECT signature_data_ciphertext FROM users WHERE id = $1`,
      [user.id],
    )
    const ciphertext = result.rows[0]?.signature_data_ciphertext ?? null
    if (!ciphertext) {
      res.json({ hasSignature: false, signatureBase64: null })
      return
    }
    if (!isPersonalDataEncryptionConfigured()) {
      res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY para consultar a assinatura do perfil.' })
      return
    }
    const signatureBase64 = decryptPersonalData(ciphertext, 'user-signature')
    res.json({ hasSignature: Boolean(signatureBase64), signatureBase64: signatureBase64 || null })
  } catch (error) {
    next(error)
  }
})

router.get('/:ticketId/visits', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }

  try {
    const result = await pool.query(
      `SELECT *
       FROM ticket_visits
       WHERE ticket_id = $1
       ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, updated_at DESC`,
      [ticketId.data],
    )
    res.json({ visits: result.rows.map(mapVisitRow) })
  } catch (error) {
    next(error)
  }
})

router.post('/:ticketId/visits/draft', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  if (!ticketId.success) {
    res.status(400).json({ error: 'Identificador de chamado inválido.' })
    return
  }

  const user = req.session.user!
  try {
    const ticketRes = await pool.query<{ source_id: string; protocol: string }>(
      `SELECT source_id, protocol FROM tickets WHERE source_id = $1`,
      [ticketId.data],
    )
    if (!ticketRes.rows.length) {
      res.status(404).json({ error: 'Chamado não encontrado.' })
      return
    }

    const existingDraft = await pool.query(
      `SELECT * FROM ticket_visits WHERE ticket_id = $1 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`,
      [ticketId.data],
    )

    if (existingDraft.rows.length) {
      res.json({ visit: mapVisitRow(existingDraft.rows[0]) })
      return
    }

    const inserted = await pool.query(
      `INSERT INTO ticket_visits (ticket_id, protocol, status, created_by, created_by_name, updated_by)
       VALUES ($1, $2, 'draft', $3, $4, $3)
       ON CONFLICT (ticket_id) WHERE status = 'draft' DO NOTHING
       RETURNING *`,
      [ticketId.data, ticketRes.rows[0].protocol, user.id, user.displayName],
    )

    if (inserted.rows.length) {
      res.status(201).json({ visit: mapVisitRow(inserted.rows[0]) })
      return
    }

    const fallbackDraft = await pool.query(
      `SELECT * FROM ticket_visits WHERE ticket_id = $1 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`,
      [ticketId.data],
    )
    res.json({ visit: mapVisitRow(fallbackDraft.rows[0]) })
  } catch (error) {
    next(error)
  }
})

router.put('/:ticketId/visits/:visitId/draft', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  const visitId = idSchema.safeParse(req.params.visitId)
  const parsed = draftPayloadSchema.safeParse(req.body)

  if (!ticketId.success || !visitId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : (parsed.error.issues[0]?.message ?? 'Dados de rascunho inválidos.') })
    return
  }

  const user = req.session.user!
  const d = parsed.data

  try {
    const updated = await pool.query(
      `UPDATE ticket_visits
       SET inspected_environments = $1,
           has_furniture = $2,
           needs_clearance = $3,
           damaged_furniture = $4,
           needs_material_purchase = $5,
           material_purchase_details = $6,
           estimated_execution_days = $7,
           standard_delivery_color = $8,
           observations = $9,
           photos = $10::jsonb,
           updated_by = $11,
           updated_at = now()
       WHERE id = $12 AND ticket_id = $13 AND status = 'draft'
       RETURNING *`,
      [
        d.inspectedEnvironments,
        d.hasFurniture,
        d.needsClearance,
        d.damagedFurniture,
        d.needsMaterialPurchase,
        d.materialPurchaseDetails,
        d.estimatedExecutionDays,
        d.standardDeliveryColor,
        d.observations,
        JSON.stringify(d.photos),
        user.id,
        visitId.data,
        ticketId.data,
      ],
    )

    if (!updated.rows.length) {
      res.status(404).json({ error: 'Rascunho de visita não encontrado ou já finalizado.' })
      return
    }

    res.json({ visit: mapVisitRow(updated.rows[0]) })
  } catch (error) {
    next(error)
  }
})

router.delete('/:ticketId/visits/:visitId', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  const visitId = idSchema.safeParse(req.params.visitId)
  if (!ticketId.success || !visitId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }

  try {
    const deleted = await pool.query(
      `DELETE FROM ticket_visits WHERE id = $1 AND ticket_id = $2 AND status = 'draft' RETURNING id`,
      [visitId.data, ticketId.data],
    )
    if (!deleted.rows.length) {
      res.status(404).json({ error: 'Rascunho não encontrado ou já finalizado.' })
      return
    }
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/:ticketId/visits/:visitId/finalize', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  const visitId = idSchema.safeParse(req.params.visitId)
  const parsed = finalizePayloadSchema.safeParse(req.body)

  if (!ticketId.success || !visitId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : (parsed.error.issues[0]?.message ?? 'Preencha todos os campos obrigatórios.') })
    return
  }

  const d = parsed.data
  if (d.needsMaterialPurchase === 'sim' && !d.materialPurchaseDetails.trim()) {
    res.status(400).json({ error: 'Informe quais materiais precisam ser comprados.' })
    return
  }

  const user = req.session.user!

  try {
    const userSigRes = await pool.query<{ signature_data_ciphertext: string | null }>(
      `SELECT signature_data_ciphertext FROM users WHERE id = $1`,
      [user.id],
    )
    if (!userSigRes.rows[0]?.signature_data_ciphertext) {
      res.status(400).json({ error: 'Configure sua assinatura digital no seu Perfil antes de finalizar a visita.' })
      return
    }

    const declarationBuffer = Buffer.from(d.declarationPdfBase64, 'base64')
    const reportBuffer = Buffer.from(d.reportPdfBase64, 'base64')

    if (
      !declarationBuffer.length ||
      !reportBuffer.length ||
      detectBinaryMimeType(declarationBuffer) !== 'application/pdf' ||
      detectBinaryMimeType(reportBuffer) !== 'application/pdf'
    ) {
      res.status(400).json({ error: 'Os arquivos PDF gerados são inválidos.' })
      return
    }

    const client = await pool.connect()
    let finalizedVisit: Record<string, unknown>
    let protocol = ''
    const visitDate = new Date()

    try {
      await client.query('BEGIN')

      const visitCheck = await client.query<{ id: string; protocol: string; status: string }>(
        `SELECT id, protocol, status FROM ticket_visits WHERE id = $1 AND ticket_id = $2 FOR UPDATE`,
        [visitId.data, ticketId.data],
      )
      if (!visitCheck.rows.length) {
        await safeRollback(client)
        res.status(404).json({ error: 'Visita não encontrada.' })
        return
      }
      if (visitCheck.rows[0].status === 'finalized') {
        await safeRollback(client)
        res.status(409).json({ error: 'Esta visita já foi finalizada.' })
        return
      }

      protocol = visitCheck.rows[0].protocol
      const dateTag = visitDate.toISOString().slice(0, 10)
      const declFileName = `Declaracao_Visita_Tecnica_AT001_Proto_${protocol}_${dateTag}.pdf`
      const reportFileName = `Relatorio_Vistoria_AT002_Proto_${protocol}_${dateTag}.pdf`

      const declAtt = await client.query<{ id: string }>(
        `INSERT INTO ticket_attachments (ticket_id, file_name, content_type, file_size, content, uploaded_by)
         VALUES ($1, $2, 'application/pdf', $3, $4, $5)
         RETURNING id`,
        [ticketId.data, declFileName, declarationBuffer.length, declarationBuffer, user.id],
      )

      const reportAtt = await client.query<{ id: string }>(
        `INSERT INTO ticket_attachments (ticket_id, file_name, content_type, file_size, content, uploaded_by)
         VALUES ($1, $2, 'application/pdf', $3, $4, $5)
         RETURNING id`,
        [ticketId.data, reportFileName, reportBuffer.length, reportBuffer, user.id],
      )

      const updated = await client.query(
        `UPDATE ticket_visits
         SET status = 'finalized',
             inspected_environments = $1,
             has_furniture = $2,
             needs_clearance = $3,
             damaged_furniture = $4,
             needs_material_purchase = $5,
             material_purchase_details = $6,
             estimated_execution_days = $7,
             standard_delivery_color = $8,
             observations = $9,
             photos = $10::jsonb,
             client_name = $11,
             client_document = $12,
             client_signature_data = $13,
             visit_date = $14,
             declaration_attachment_id = $15,
             report_attachment_id = $16,
             finalized_by = $17,
             finalized_by_name = $18,
             finalized_at = now(),
             updated_by = $17,
             updated_at = now()
         WHERE id = $19
         RETURNING *`,
        [
          d.inspectedEnvironments,
          d.hasFurniture,
          d.needsClearance,
          d.damagedFurniture,
          d.needsMaterialPurchase,
          d.needsMaterialPurchase === 'sim' ? d.materialPurchaseDetails : '',
          d.estimatedExecutionDays,
          d.standardDeliveryColor,
          d.observations,
          JSON.stringify(d.photos),
          d.clientName,
          d.clientDocument,
          d.clientSignatureData,
          visitDate,
          declAtt.rows[0].id,
          reportAtt.rows[0].id,
          user.id,
          user.displayName,
          visitId.data,
        ],
      )

      finalizedVisit = updated.rows[0]
      await recordTicketActivity(
        client,
        ticketId.data,
        user.id,
        'visit_finalized',
        `Finalizou o Cadastro de Visita Técnica (cliente: ${d.clientName}) e gerou os PDFs AT001 e AT002.`,
      )
      await client.query('COMMIT')
    } catch (txError) {
      await safeRollback(client)
      throw txError
    } finally {
      client.release()
    }

    // Dispatch to CVCRM outside DB transaction
    const syncSettings = await getCvcrmVisitSyncSettings()
    const visitDateBr = formatDateBr(visitDate)
    const dateTag = visitDate.toISOString().slice(0, 10)
    const declFileName = `Declaracao_Visita_Tecnica_AT001_Proto_${protocol}_${dateTag}.pdf`
    const reportFileName = `Relatorio_Vistoria_AT002_Proto_${protocol}_${dateTag}.pdf`

    let declStatus = 'disabled'
    let declError: string | null = null
    let declSentAt: Date | null = null
    let reportStatus = 'disabled'
    let reportError: string | null = null
    let reportSentAt: Date | null = null

    if (syncSettings.enabled) {
      try {
        await sendCvcrmVisitDocumentComment({
          ticketId: ticketId.data,
          protocol,
          message: `Prezado(a) cliente,\nSegue Declaração de Visita Técnica realizada em ${visitDateBr}`,
          isPublic: syncSettings.declarationVisibility === 'public',
          fileName: declFileName,
          fileBuffer: declarationBuffer,
        })
        declStatus = 'sent'
        declSentAt = new Date()
      } catch (err) {
        declStatus = 'failed'
        declError = err instanceof Error ? err.message : 'Erro ao enviar Declaração ao CVCRM.'
      }

      try {
        await sendCvcrmVisitDocumentComment({
          ticketId: ticketId.data,
          protocol,
          message: `Segue relatório de vistoria e fotos da visita realizada em ${visitDateBr}`,
          isPublic: syncSettings.reportVisibility === 'public',
          fileName: reportFileName,
          fileBuffer: reportBuffer,
        })
        reportStatus = 'sent'
        reportSentAt = new Date()
      } catch (err) {
        reportStatus = 'failed'
        reportError = err instanceof Error ? err.message : 'Erro ao enviar Relatório ao CVCRM.'
      }
    }

    const finalSynced = await pool.query(
      `UPDATE ticket_visits
       SET cvcrm_declaration_status = $1,
           cvcrm_declaration_error = $2,
           cvcrm_declaration_sent_at = $3,
           cvcrm_report_status = $4,
           cvcrm_report_error = $5,
           cvcrm_report_sent_at = $6,
           updated_at = now()
       WHERE id = $7
       RETURNING *`,
      [declStatus, declError, declSentAt, reportStatus, reportError, reportSentAt, visitId.data],
    )

    finalizedVisit = finalSynced.rows[0] ?? finalizedVisit

    await recordAuditLog({
      actorUserId: user.id,
      actorName: user.displayName,
      action: 'ticket_visit_finalized',
      resourceType: 'ticket_visit',
      resourceId: String(visitId.data),
      summary: `Finalizou visita técnica do chamado #${protocol} (AT001: ${declStatus}, AT002: ${reportStatus}).`,
    })

    broadcastSyncEvent({ scope: 'tickets', action: 'visit_finalized', entityId: ticketId.data })
    res.status(201).json({ visit: mapVisitRow(finalizedVisit) })
  } catch (error) {
    next(error)
  }
})

router.post('/:ticketId/visits/:visitId/retry-cvcrm', async (req, res, next) => {
  const ticketId = idSchema.safeParse(req.params.ticketId)
  const visitId = idSchema.safeParse(req.params.visitId)
  if (!ticketId.success || !visitId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }

  try {
    const visitRes = await pool.query(
      `SELECT * FROM ticket_visits WHERE id = $1 AND ticket_id = $2 AND status = 'finalized'`,
      [visitId.data, ticketId.data],
    )
    if (!visitRes.rows.length) {
      res.status(404).json({ error: 'Visita finalizada não encontrada.' })
      return
    }

    const row = visitRes.rows[0]
    const syncSettings = await getCvcrmVisitSyncSettings()
    const visitDate = row.visit_date ? new Date(String(row.visit_date)) : new Date(String(row.created_at))
    const visitDateBr = formatDateBr(visitDate)

    let declStatus = String(row.cvcrm_declaration_status ?? 'pending')
    let declError: string | null = row.cvcrm_declaration_error ? String(row.cvcrm_declaration_error) : null
    let declSentAt = row.cvcrm_declaration_sent_at ? new Date(String(row.cvcrm_declaration_sent_at)) : null

    let reportStatus = String(row.cvcrm_report_status ?? 'pending')
    let reportError: string | null = row.cvcrm_report_error ? String(row.cvcrm_report_error) : null
    let reportSentAt = row.cvcrm_report_sent_at ? new Date(String(row.cvcrm_report_sent_at)) : null

    const forceRetry = req.body?.force === true

    if ((forceRetry || declStatus !== 'sent') && row.declaration_attachment_id) {
      const att = await pool.query<{ file_name: string; content: Buffer }>(
        `SELECT file_name, content FROM ticket_attachments WHERE id = $1`,
        [row.declaration_attachment_id],
      )
      if (att.rows.length) {
        try {
          await sendCvcrmVisitDocumentComment({
            ticketId: ticketId.data,
            protocol: String(row.protocol),
            message: `Prezado(a) cliente,\nSegue Declaração de Visita Técnica realizada em ${visitDateBr}`,
            isPublic: syncSettings.declarationVisibility === 'public',
            fileName: att.rows[0].file_name,
            fileBuffer: att.rows[0].content,
          })
          declStatus = 'sent'
          declError = null
          declSentAt = new Date()
        } catch (err) {
          declStatus = 'failed'
          declError = err instanceof Error ? err.message : 'Erro ao enviar Declaração ao CVCRM.'
        }
      }
    }

    if ((forceRetry || reportStatus !== 'sent') && row.report_attachment_id) {
      const att = await pool.query<{ file_name: string; content: Buffer }>(
        `SELECT file_name, content FROM ticket_attachments WHERE id = $1`,
        [row.report_attachment_id],
      )
      if (att.rows.length) {
        try {
          await sendCvcrmVisitDocumentComment({
            ticketId: ticketId.data,
            protocol: String(row.protocol),
            message: `Segue relatório de vistoria e fotos da visita realizada em ${visitDateBr}`,
            isPublic: syncSettings.reportVisibility === 'public',
            fileName: att.rows[0].file_name,
            fileBuffer: att.rows[0].content,
          })
          reportStatus = 'sent'
          reportError = null
          reportSentAt = new Date()
        } catch (err) {
          reportStatus = 'failed'
          reportError = err instanceof Error ? err.message : 'Erro ao enviar Relatório ao CVCRM.'
        }
      }
    }

    const updated = await pool.query(
      `UPDATE ticket_visits
       SET cvcrm_declaration_status = $1,
           cvcrm_declaration_error = $2,
           cvcrm_declaration_sent_at = $3,
           cvcrm_report_status = $4,
           cvcrm_report_error = $5,
           cvcrm_report_sent_at = $6,
           updated_at = now()
       WHERE id = $7
       RETURNING *`,
      [declStatus, declError, declSentAt, reportStatus, reportError, reportSentAt, visitId.data],
    )

    broadcastSyncEvent({ scope: 'tickets', action: 'visit_retry', entityId: ticketId.data })
    res.json({ visit: mapVisitRow(updated.rows[0]) })
  } catch (error) {
    next(error)
  }
})

export default router
