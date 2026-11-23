import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { broadcastSyncEvent } from '../services/sync-events.js'
import { detectBinaryMimeType } from '../services/file-validation.js'

const router = Router()

const optionalEmail = z.string().trim().max(254).email().or(z.literal(''))
const nullableDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  })
  .nullable()
const informationSchema = z.object({
  enterpriseName: z.string().trim().min(1).max(240),
  workStatus: z.enum(['finished', 'in_progress']).default('in_progress'),
  syndicName: z.string().trim().max(160),
  syndicPhone: z.string().trim().max(40),
  syndicEmail: optionalEmail,
  supervisorName: z.string().trim().max(160),
  supervisorPhone: z.string().trim().max(40),
  supervisorEmail: optionalEmail,
  condominiumEmail: optionalEmail,
  workAddress: z.string().trim().max(500),
  occupancyPermitDate: nullableDate,
  condominiumDeliveryDate: nullableDate,
})

router.use(requireAuth, requirePageAccess('information'))

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `WITH enterprise_sources AS (
         SELECT lower(btrim(enterprise)) AS enterprise_key, btrim(enterprise) AS enterprise_name, 1 AS ticket_count
         FROM tickets
         WHERE btrim(enterprise) <> ''
         UNION ALL
         SELECT enterprise_key, enterprise_name, 0
         FROM enterprise_information
       ), properties AS (
         SELECT enterprise_key, min(enterprise_name) AS enterprise_name,
                sum(ticket_count)::int AS ticket_count
         FROM enterprise_sources
         GROUP BY enterprise_key
       )
       SELECT p.enterprise_key, p.enterprise_name, p.ticket_count,
              COALESCE((SELECT count(*)::int FROM enterprise_documents d WHERE d.enterprise_key = p.enterprise_key), 0) AS document_count,
              COALESCE(i.work_status, 'in_progress') AS work_status,
              i.syndic_name, i.syndic_phone, i.syndic_email,
              i.supervisor_name, i.supervisor_phone, i.supervisor_email,
              i.condominium_email, i.work_address, i.occupancy_permit_date, i.condominium_delivery_date
       FROM properties p
       LEFT JOIN enterprise_information i USING (enterprise_key)
       ORDER BY lower(p.enterprise_name)`,
    )
    res.json({ enterprises: result.rows })
  } catch (error) {
    next(error)
  }
})

router.put('/', async (req, res, next) => {
  const parsed = informationSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Informações do empreendimento inválidas.' })
    return
  }
  const data = parsed.data
  const enterpriseKey = data.enterpriseName.trim().toLowerCase()
  try {
    await pool.query(
      `INSERT INTO enterprise_information (
         enterprise_key, enterprise_name, work_status, syndic_name, syndic_phone, syndic_email,
         supervisor_name, supervisor_phone, supervisor_email, condominium_email,
         work_address, occupancy_permit_date, condominium_delivery_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (enterprise_key) DO UPDATE SET
         enterprise_name = EXCLUDED.enterprise_name,
         work_status = EXCLUDED.work_status,
         syndic_name = EXCLUDED.syndic_name,
         syndic_phone = EXCLUDED.syndic_phone,
         syndic_email = EXCLUDED.syndic_email,
         supervisor_name = EXCLUDED.supervisor_name,
         supervisor_phone = EXCLUDED.supervisor_phone,
         supervisor_email = EXCLUDED.supervisor_email,
         condominium_email = EXCLUDED.condominium_email,
         work_address = EXCLUDED.work_address,
         occupancy_permit_date = EXCLUDED.occupancy_permit_date,
         condominium_delivery_date = EXCLUDED.condominium_delivery_date,
         updated_at = now()`,
      [
        enterpriseKey, data.enterpriseName, data.workStatus, data.syndicName, data.syndicPhone, data.syndicEmail,
        data.supervisorName, data.supervisorPhone, data.supervisorEmail, data.condominiumEmail, data.workAddress,
        data.occupancyPermitDate, data.condominiumDeliveryDate,
      ],
    )

    // Atualiza imediatamente unidades em estoque que correspondam a este empreendimento
    await pool.query(
      `UPDATE stock_units
       SET is_delivered = ($1 = 'finished'),
           enterprise_status = CASE WHEN $1 = 'finished' THEN 'Obras Finalizadas' ELSE 'Em Andamento' END
       WHERE lower(enterprise_name) = $2`,
      [data.workStatus, enterpriseKey],
    )
    void broadcastSyncEvent({ scope: 'stock-units', action: 'enterprise_status_updated' })

    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

const documentUploadSchema = z.object({
  category: z.string().trim().min(1).max(100).default('Geral'),
  title: z.string().trim().min(1).max(255),
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1),
})

router.get('/:key/documents', async (req, res, next) => {
  const enterpriseKey = req.params.key.trim().toLowerCase()
  try {
    const result = await pool.query(
      `SELECT d.id, d.enterprise_key, d.category, d.title, d.file_name, d.content_type, d.file_size,
              d.created_at, d.updated_at, d.uploaded_by,
              COALESCE(u.display_name, 'Sistema') AS uploaded_by_name
       FROM enterprise_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.enterprise_key = $1
       ORDER BY d.created_at DESC`,
      [enterpriseKey],
    )
    res.json({ documents: result.rows })
  } catch (error) {
    next(error)
  }
})

router.post('/:key/documents', async (req, res, next) => {
  const enterpriseKey = req.params.key.trim().toLowerCase()
  const parsed = documentUploadSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do documento inválidos.' })
    return
  }
  const { category, title, fileName, contentBase64 } = parsed.data
  const sanitizedFileName = fileName.replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
  const content = Buffer.from(contentBase64, 'base64')

  const detectedType = detectBinaryMimeType(content)
  if (detectedType !== 'application/pdf' || content.length === 0 || content.length > 31457280) {
    res.status(400).json({ error: 'Envie um documento PDF válido de até 30 MB.' })
    return
  }

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO enterprise_documents
         (enterprise_key, category, title, file_name, content_type, file_size, content, uploaded_by)
       VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7)
       RETURNING id`,
      [enterpriseKey, category, title, sanitizedFileName, content.length, content, req.session.user?.id ?? null],
    )
    res.status(201).json({ id: result.rows[0].id })
  } catch (error) {
    next(error)
  }
})

router.get('/:key/documents/:id', async (req, res, next) => {
  const enterpriseKey = req.params.key.trim().toLowerCase()
  const docId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!docId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  try {
    const result = await pool.query<{
      file_name: string
      content_type: string
      content: Buffer
    }>(
      `SELECT file_name, content_type, content
       FROM enterprise_documents
       WHERE id = $1 AND enterprise_key = $2`,
      [docId.data, enterpriseKey],
    )
    const doc = result.rows[0]
    if (!doc) {
      res.status(404).json({ error: 'Documento não encontrado.' })
      return
    }
    const isDownload = req.query.download === '1'
    const asciiName = doc.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    res.setHeader('Content-Type', doc.content_type || 'application/pdf')
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(doc.content)
  } catch (error) {
    next(error)
  }
})

router.delete('/:key/documents/:id', async (req, res, next) => {
  const enterpriseKey = req.params.key.trim().toLowerCase()
  const docId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!docId.success) {
    res.status(400).json({ error: 'Identificador inválido.' })
    return
  }
  try {
    const result = await pool.query(
      `DELETE FROM enterprise_documents
       WHERE id = $1 AND enterprise_key = $2
       RETURNING id`,
      [docId.data, enterpriseKey],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Documento não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
