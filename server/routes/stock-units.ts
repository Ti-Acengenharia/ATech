/// <reference path="../types/express-session.d.ts" />
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'
import { broadcastSyncEvent } from '../services/sync-events.js'
import { syncStockUnitsFromCvcrm } from '../services/stock-units.js'

export const MANDATORY_INSPECTION_ITEMS = [
  { key: 'esquadrias_madeira', label: 'Esquadrias de madeira' },
  { key: 'esquadrias_aluminio', label: 'Esquadrias de aluminio' },
  { key: 'pisos_revestimentos', label: 'Pisos e Revestimentos' },
  { key: 'metais', label: 'Metais' },
  { key: 'loucas', label: 'Louças' },
  { key: 'pedras_granitos', label: 'Pedras e Granitos' },
  { key: 'eletrica', label: 'Elétrica' },
  { key: 'hidraulica', label: 'Hidráulica' },
] as const

const router = Router()

// GET /api/stock-units - Lista unidades em estoque com agrupamento e estatísticas
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rawEnterpriseIds = req.query.enterpriseIds ? String(req.query.enterpriseIds) : ''
    const enterpriseIdsList = rawEnterpriseIds
      ? rawEnterpriseIds.split(',').map(Number).filter((n) => !isNaN(n) && n > 0)
      : []
    const enterpriseIdParam = req.query.enterpriseId ? Number(req.query.enterpriseId) : null
    const onlyDelivered = req.query.onlyDelivered === 'true'
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : ''
    const inspectionFilter = typeof req.query.inspectionStatus === 'string' ? req.query.inspectionStatus.trim() : ''

    // Unidades filtradas
    const conditions: string[] = []
    const values: unknown[] = []
    let pIndex = 1

    if (enterpriseIdsList.length > 0) {
      conditions.push(`su.enterprise_id = ANY($${pIndex++}::int[])`)
      values.push(enterpriseIdsList)
    } else if (enterpriseIdParam) {
      conditions.push(`su.enterprise_id = $${pIndex++}`)
      values.push(enterpriseIdParam)
    }

    if (onlyDelivered) {
      conditions.push(`su.is_delivered = true`)
    }

    if (search) {
      conditions.push(`(
        lower(su.unit_name) LIKE $${pIndex} OR
        lower(COALESCE(su.block_name, '')) LIKE $${pIndex} OR
        lower(su.enterprise_name) LIKE $${pIndex} OR
        lower(COALESCE(su.typology, '')) LIKE $${pIndex}
      )`)
      values.push(`%${search}%`)
      pIndex++
    }

    if (statusFilter) {
      conditions.push(`lower(su.status_name) = lower($${pIndex++})`)
      values.push(statusFilter)
    }

    if (inspectionFilter === 'scheduled') {
      conditions.push(`su.next_inspection_date IS NOT NULL AND su.next_inspection_date >= CURRENT_DATE`)
    } else if (inspectionFilter === 'overdue') {
      conditions.push(`su.next_inspection_date IS NOT NULL AND su.next_inspection_date < CURRENT_DATE`)
    } else if (inspectionFilter === 'inspected') {
      conditions.push(`su.last_inspection_date IS NOT NULL`)
    } else if (inspectionFilter === 'has_issues') {
      conditions.push(`su.last_inspection_status = 'has_issues'`)
    } else if (inspectionFilter === 'approved') {
      conditions.push(`su.last_inspection_status = 'approved'`)
    } else if (inspectionFilter === 'none') {
      conditions.push(`su.last_inspection_date IS NULL AND su.next_inspection_date IS NULL`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const runListQueries = () =>
      Promise.all([
        pool.query<{
          enterprise_id: number
          enterprise_name: string
          is_delivered: boolean
          enterprise_status: string | null
          enterprise_delivery_date: string | null
          total_units: number
          scheduled_inspections: number
          inspected_units: number
          units_with_issues: number
          overdue_inspections: number
          without_inspections: number
        }>(
          `SELECT
            enterprise_id,
            enterprise_name,
            COALESCE(bool_or(is_delivered), false) AS is_delivered,
            max(enterprise_status) AS enterprise_status,
            max(enterprise_delivery_date) AS enterprise_delivery_date,
            count(*)::int AS total_units,
            count(*) FILTER (WHERE next_inspection_date IS NOT NULL AND next_inspection_date >= CURRENT_DATE)::int AS scheduled_inspections,
            count(*) FILTER (WHERE last_inspection_date IS NOT NULL)::int AS inspected_units,
            count(*) FILTER (WHERE last_inspection_status = 'has_issues')::int AS units_with_issues,
            count(*) FILTER (WHERE next_inspection_date IS NOT NULL AND next_inspection_date < CURRENT_DATE)::int AS overdue_inspections,
            count(*) FILTER (WHERE last_inspection_date IS NULL AND next_inspection_date IS NULL)::int AS without_inspections
           FROM stock_units
           GROUP BY enterprise_id, enterprise_name
           ORDER BY is_delivered DESC, enterprise_name ASC`,
        ),
        pool.query<{
          id: number
          enterprise_id: number
          enterprise_name: string
          unit_id: number
          unit_name: string
          block_id: number | null
          block_name: string | null
          stage_name: string | null
          floor: string | null
          typology: string | null
          position: string | null
          private_area: number | null
          status_id: number | null
          status_name: string
          status_reason: string | null
          is_delivered: boolean
          enterprise_status: string | null
          enterprise_delivery_date: string | null
          next_inspection_date: string | null
          last_inspection_date: string | null
          last_inspection_status: string | null
          last_inspection_technician: string | null
          synced_at: string
          inspections_count: number
        }>(
          `SELECT
            su.id,
            su.enterprise_id,
            su.enterprise_name,
            su.unit_id,
            su.unit_name,
            su.block_id,
            su.block_name,
            su.stage_name,
            su.floor,
            su.typology,
            su.position,
            su.private_area,
            su.status_id,
            su.status_name,
            su.status_reason,
            su.is_delivered,
            su.enterprise_status,
            su.enterprise_delivery_date,
            su.next_inspection_date::text,
            su.last_inspection_date::text,
            su.last_inspection_status,
            su.last_inspection_technician,
            su.synced_at::text,
            COALESCE(ui_cnt.cnt, 0) AS inspections_count
           FROM stock_units su
           LEFT JOIN (
             SELECT stock_unit_id, count(*)::int AS cnt
             FROM unit_inspections
             GROUP BY stock_unit_id
           ) ui_cnt ON ui_cnt.stock_unit_id = su.id
           ${whereClause}
           ORDER BY su.is_delivered DESC, su.enterprise_name ASC, su.block_name ASC, su.unit_name ASC`,
          values,
        ),
        pool.query<{
          total_in_stock: number
          total_delivered: number
          total_scheduled: number
          total_overdue: number
          total_inspected: number
          total_with_issues: number
          total_without_inspection: number
          last_sync: string | null
        }>(
          `SELECT
            count(*)::int AS total_in_stock,
            count(*) FILTER (WHERE is_delivered = true)::int AS total_delivered,
            count(*) FILTER (WHERE next_inspection_date IS NOT NULL AND next_inspection_date >= CURRENT_DATE)::int AS total_scheduled,
            count(*) FILTER (WHERE next_inspection_date IS NOT NULL AND next_inspection_date < CURRENT_DATE)::int AS total_overdue,
            count(*) FILTER (WHERE last_inspection_date IS NOT NULL)::int AS total_inspected,
            count(*) FILTER (WHERE last_inspection_status = 'has_issues')::int AS total_with_issues,
            count(*) FILTER (WHERE last_inspection_date IS NULL AND next_inspection_date IS NULL)::int AS total_without_inspection,
            max(synced_at)::text AS last_sync
           FROM stock_units`,
        ),
      ])

    let [enterprisesResult, unitsResult, summaryResult] = await runListQueries()

    // Se a tabela estiver vazia, sincroniza automaticamente na primeira carga
    if (Number(summaryResult.rows[0]?.total_in_stock ?? 0) === 0) {
      try {
        await syncStockUnitsFromCvcrm()
        ;[enterprisesResult, unitsResult, summaryResult] = await runListQueries()
      } catch (err) {
        console.error('Initial auto-sync of stock units failed:', err)
      }
    }

    res.json({
      enterprises: enterprisesResult.rows.map((row) => ({
        enterpriseId: row.enterprise_id,
        enterpriseName: row.enterprise_name,
        isDelivered: row.is_delivered,
        enterpriseStatus: row.enterprise_status,
        enterpriseDeliveryDate: row.enterprise_delivery_date,
        totalUnits: row.total_units,
        scheduledInspections: row.scheduled_inspections,
        inspectedUnits: row.inspected_units,
        unitsWithIssues: row.units_with_issues,
        overdueInspections: row.overdue_inspections,
        withoutInspections: row.without_inspections,
      })),
      units: unitsResult.rows.map((row) => ({
        id: row.id,
        enterpriseId: row.enterprise_id,
        enterpriseName: row.enterprise_name,
        unitId: row.unit_id,
        unitName: row.unit_name,
        blockId: row.block_id,
        blockName: row.block_name,
        stageName: row.stage_name,
        floor: row.floor,
        typology: row.typology,
        position: row.position,
        privateArea: row.private_area ? Number(row.private_area) : null,
        statusId: row.status_id,
        statusName: row.status_name,
        statusReason: row.status_reason,
        isDelivered: row.is_delivered,
        enterpriseStatus: row.enterprise_status,
        enterpriseDeliveryDate: row.enterprise_delivery_date,
        nextInspectionDate: row.next_inspection_date,
        lastInspectionDate: row.last_inspection_date,
        lastInspectionStatus: row.last_inspection_status,
        lastInspectionTechnician: row.last_inspection_technician,
        syncedAt: row.synced_at,
        inspectionsCount: row.inspections_count,
      })),
      summary: summaryResult.rows[0] ?? {
        total_in_stock: 0,
        total_delivered: 0,
        total_scheduled: 0,
        total_overdue: 0,
        total_inspected: 0,
        total_with_issues: 0,
        total_without_inspection: 0,
        last_sync: null,
      },
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/stock-units/sync - Dispara sincronização com o CV CRM
router.post('/sync', requireAuth, async (_req, res, next) => {
  try {
    const result = await syncStockUnitsFromCvcrm()
    res.json({
      success: true,
      message: `Sincronização concluída: ${result.totalInStock} unidades em estoque encontradas em ${result.enterprisesWithStock} empreendimentos.`,
      result,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/stock-units/:id - Detalhes da unidade e histórico de vistorias
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de unidade inválido.' })
      return
    }

    const [unitResult, inspectionsResult, photosResult] = await Promise.all([
      pool.query<{
        id: number
        enterprise_id: number
        enterprise_name: string
        unit_id: number
        unit_name: string
        block_id: number | null
        block_name: string | null
        stage_name: string | null
        floor: string | null
        typology: string | null
        position: string | null
        private_area: number | null
        status_id: number | null
        status_name: string
        status_reason: string | null
        is_delivered: boolean
        enterprise_status: string | null
        enterprise_delivery_date: string | null
        next_inspection_date: string | null
        last_inspection_date: string | null
        last_inspection_status: string | null
        last_inspection_technician: string | null
        synced_at: string
      }>(
        `SELECT
          id, enterprise_id, enterprise_name, unit_id, unit_name,
          block_id, block_name, stage_name, floor, typology, position,
          private_area, status_id, status_name, status_reason,
          is_delivered, enterprise_status, enterprise_delivery_date,
          next_inspection_date::text, last_inspection_date::text,
          last_inspection_status, last_inspection_technician, synced_at::text
         FROM stock_units
         WHERE id = $1`,
        [id],
      ),
      pool.query<{
        id: string
        inspection_date: string
        technician_id: number | null
        technician_name: string
        collaborator_id: number | null
        collaborator_name: string | null
        overall_status: string
        approved_count: number
        reproved_count: number
        items: any
        general_notes: string | null
        created_at: string
      }>(
        `SELECT
          ui.id,
          ui.inspection_date::text,
          ui.technician_id,
          ui.technician_name,
          ui.collaborator_id,
          ui.collaborator_name,
          ui.overall_status,
          ui.approved_count,
          ui.reproved_count,
          ui.items,
          ui.general_notes,
          ui.created_at::text
         FROM unit_inspections ui
         WHERE ui.stock_unit_id = $1
         ORDER BY ui.inspection_date DESC, ui.created_at DESC`,
        [id],
      ),
      pool.query<{
        id: string
        inspection_id: string
        item_key: string
        file_name: string
        file_size: number
        content_type: string
      }>(
        `SELECT
          uip.id,
          uip.inspection_id,
          uip.item_key,
          uip.file_name,
          uip.file_size,
          uip.content_type
         FROM unit_inspection_photos uip
         JOIN unit_inspections ui ON ui.id = uip.inspection_id
         WHERE ui.stock_unit_id = $1
         ORDER BY uip.created_at ASC`,
        [id],
      ),
    ])

    if (unitResult.rows.length === 0) {
      res.status(404).json({ error: 'Unidade em estoque não encontrada.' })
      return
    }

    const unit = unitResult.rows[0]

    const photosByInspection = new Map<string, Array<{ id: string; itemKey: string; fileName: string; fileSize: number; contentType: string }>>()
    for (const photo of photosResult.rows) {
      const list = photosByInspection.get(photo.inspection_id) ?? []
      list.push({
        id: photo.id,
        itemKey: photo.item_key,
        fileName: photo.file_name,
        fileSize: photo.file_size,
        contentType: photo.content_type,
      })
      photosByInspection.set(photo.inspection_id, list)
    }

    res.json({
      unit: {
        id: unit.id,
        enterpriseId: unit.enterprise_id,
        enterpriseName: unit.enterprise_name,
        unitId: unit.unit_id,
        unitName: unit.unit_name,
        blockId: unit.block_id,
        blockName: unit.block_name,
        stageName: unit.stage_name,
        floor: unit.floor,
        typology: unit.typology,
        position: unit.position,
        privateArea: unit.private_area ? Number(unit.private_area) : null,
        statusId: unit.status_id,
        statusName: unit.status_name,
        statusReason: unit.status_reason,
        isDelivered: unit.is_delivered,
        enterpriseStatus: unit.enterprise_status,
        enterpriseDeliveryDate: unit.enterprise_delivery_date,
        nextInspectionDate: unit.next_inspection_date,
        lastInspectionDate: unit.last_inspection_date,
        lastInspectionStatus: unit.last_inspection_status,
        lastInspectionTechnician: unit.last_inspection_technician,
        syncedAt: unit.synced_at,
      },
      inspections: inspectionsResult.rows.map((insp) => ({
        id: insp.id,
        inspectionDate: insp.inspection_date,
        technicianId: insp.technician_id,
        technicianName: insp.technician_name,
        collaboratorId: insp.collaborator_id,
        collaboratorName: insp.collaborator_name,
        overallStatus: insp.overall_status,
        approvedCount: insp.approved_count,
        reprovedCount: insp.reproved_count,
        items: insp.items,
        generalNotes: insp.general_notes,
        createdAt: insp.created_at,
        photos: photosByInspection.get(insp.id) ?? [],
      })),
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/stock-units/:id/next-inspection - Cadastra / atualiza data da próxima vistoria
const nextInspectionSchema = z.object({
  nextInspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').nullable(),
})

router.patch('/:id/next-inspection', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de unidade inválido.' })
      return
    }

    const parsed = nextInspectionSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' })
      return
    }

    const result = await pool.query(
      `UPDATE stock_units
       SET next_inspection_date = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, next_inspection_date::text`,
      [parsed.data.nextInspectionDate, id],
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Unidade em estoque não encontrada.' })
      return
    }

    void broadcastSyncEvent({ scope: 'stock-units', action: 'next-inspection-updated', entityId: id })

    res.json({
      success: true,
      nextInspectionDate: result.rows[0].next_inspection_date,
    })
  } catch (error) {
    next(error)
  }
})

// Schema de criação de Vistoria
const inspectionPhotoSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  contentBase64: z.string().min(4).max(10_000_000), // Até ~7MB por imagem
})

const inspectionItemSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['approved', 'reproved']),
  observation: z.string().optional(),
  photos: z.array(inspectionPhotoSchema).optional().default([]),
})

const createInspectionSchema = z.object({
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  technicianName: z.string().trim().min(2, 'Nome do técnico é obrigatório.').max(200),
  collaboratorId: z.number().int().positive().optional().nullable(),
  items: z.array(inspectionItemSchema).min(8, 'Todos os 8 itens de vistoria são obrigatórios.'),
  generalNotes: z.string().trim().max(4000).optional().default(''),
})

// POST /api/stock-units/:id/inspections - Cadastro de vistorias com itens, fotos e observações
router.post('/:id/inspections', requireAuth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de unidade inválido.' })
      return
    }

    const parsed = createInspectionSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da vistoria inválidos.' })
      return
    }

    const { inspectionDate, technicianName, collaboratorId, items, generalNotes } = parsed.data

    // Valida se os itens obrigatórios estão presentes e se reprovados possuem observação e foto
    const mandatoryKeys = new Set(MANDATORY_INSPECTION_ITEMS.map((m) => m.key))
    for (const item of items) {
      if (mandatoryKeys.has(item.key as any)) {
        if (item.status === 'reproved') {
          if (!item.observation || !item.observation.trim()) {
            res.status(400).json({ error: `O item "${item.name}" foi reprovado e necessita de uma observação explicativa.` })
            return
          }
          if (!item.photos || item.photos.length === 0) {
            res.status(400).json({ error: `O item "${item.name}" foi reprovado e necessita de pelo menos uma foto comprobatória.` })
            return
          }
        }
      }
    }

    // Busca dados da unidade
    const unitCheck = await client.query<{
      id: number
      enterprise_id: number
      enterprise_name: string
      unit_id: number
      unit_name: string
      block_name: string | null
    }>('SELECT id, enterprise_id, enterprise_name, unit_id, unit_name, block_name FROM stock_units WHERE id = $1', [id])

    if (unitCheck.rows.length === 0) {
      res.status(404).json({ error: 'Unidade em estoque não encontrada.' })
      return
    }

    const unit = unitCheck.rows[0]

    // Busca nome do colaborador se ID informado
    let collaboratorName: string | null = null
    if (collaboratorId) {
      const col = await client.query<{ name: string }>('SELECT name FROM collaborators WHERE id = $1', [collaboratorId])
      collaboratorName = col.rows[0]?.name ?? null
    }

    const approvedCount = items.filter((i) => i.status === 'approved').length
    const reprovedCount = items.filter((i) => i.status === 'reproved').length
    const overallStatus = reprovedCount > 0 ? 'has_issues' : 'approved'

    await client.query('BEGIN')

    // Prepara items para salvar no JSON (sem os base64 brutos para manter leve o json da vistoria)
    const itemsSanitized = items.map((i) => ({
      key: i.key,
      name: i.name,
      status: i.status,
      observation: i.observation?.trim() || null,
      photosCount: i.photos?.length || 0,
    }))

    const inspectionInsert = await client.query<{ id: string }>(
      `INSERT INTO unit_inspections (
        stock_unit_id, enterprise_id, enterprise_name, unit_id, unit_name, block_name,
        inspection_date, technician_id, technician_name, collaborator_id, collaborator_name,
        overall_status, approved_count, reproved_count, items, general_notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        unit.id,
        unit.enterprise_id,
        unit.enterprise_name,
        unit.unit_id,
        unit.unit_name,
        unit.block_name,
        inspectionDate,
        req.session?.user?.id ?? null,
        technicianName,
        collaboratorId ?? null,
        collaboratorName,
        overallStatus,
        approvedCount,
        reprovedCount,
        JSON.stringify(itemsSanitized),
        generalNotes || null,
        req.session?.user?.id ?? null,
      ],
    )

    const inspectionId = inspectionInsert.rows[0].id

    // Insere fotos no banco de dados
    for (const item of items) {
      if (item.photos && item.photos.length > 0) {
        for (const photo of item.photos) {
          const buffer = Buffer.from(photo.contentBase64, 'base64')
          const safeName = photo.fileName.replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
          await client.query(
            `INSERT INTO unit_inspection_photos (
              inspection_id, item_key, file_name, content_type, file_size, content
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [inspectionId, item.key, safeName, photo.contentType.toLowerCase(), buffer.length, buffer],
          )
        }
      }
    }

    // Atualiza status da última vistoria na unidade
    await client.query(
      `UPDATE stock_units
       SET last_inspection_date = $1,
           last_inspection_status = $2,
           last_inspection_technician = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [inspectionDate, overallStatus, technicianName, unit.id],
    )

    await client.query('COMMIT')

    void broadcastSyncEvent({ scope: 'stock-units', action: 'inspection-created', entityId: unit.id })

    res.status(201).json({
      success: true,
      inspectionId,
      overallStatus,
      approvedCount,
      reprovedCount,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

// GET /api/stock-units/inspections/:inspectionId/photos/:photoId - Download / visualização da foto da vistoria
router.get('/inspections/:inspectionId/photos/:photoId', requireAuth, async (req, res, next) => {
  try {
    const { inspectionId, photoId } = req.params
    const result = await pool.query<{
      file_name: string
      content_type: string
      content: Buffer
    }>(
      `SELECT file_name, content_type, content
       FROM unit_inspection_photos
       WHERE id = $1 AND inspection_id = $2`,
      [photoId, inspectionId],
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Foto não encontrada.' })
      return
    }

    const photo = result.rows[0]
    res.setHeader('Content-Type', photo.content_type)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(photo.file_name)}"`)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(photo.content)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/stock-units/inspections/:inspectionId - Exclusão de ficha de vistoria
router.delete('/inspections/:inspectionId', requireAuth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { inspectionId } = req.params

    const inspCheck = await client.query<{
      id: string
      stock_unit_id: number
      created_by: number | null
    }>('SELECT id, stock_unit_id, created_by FROM unit_inspections WHERE id = $1', [inspectionId])

    if (inspCheck.rows.length === 0) {
      res.status(404).json({ error: 'Vistoria não encontrada.' })
      return
    }

    const insp = inspCheck.rows[0]
    if (req.session?.user?.role !== 'admin' && String(insp.created_by) !== String(req.session?.user?.id)) {
      res.status(403).json({ error: 'Apenas o técnico responsável ou a administração pode excluir esta vistoria.' })
      return
    }

    await client.query('BEGIN')

    await client.query('DELETE FROM unit_inspections WHERE id = $1', [inspectionId])

    // Recalcula última vistoria na unidade
    const prevInsp = await client.query<{
      inspection_date: string
      overall_status: string
      technician_name: string
    }>(
      `SELECT inspection_date::text, overall_status, technician_name
       FROM unit_inspections
       WHERE stock_unit_id = $1
       ORDER BY inspection_date DESC, created_at DESC
       LIMIT 1`,
      [insp.stock_unit_id],
    )

    if (prevInsp.rows.length > 0) {
      await client.query(
        `UPDATE stock_units
         SET last_inspection_date = $1,
             last_inspection_status = $2,
             last_inspection_technician = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [prevInsp.rows[0].inspection_date, prevInsp.rows[0].overall_status, prevInsp.rows[0].technician_name, insp.stock_unit_id],
      )
    } else {
      await client.query(
        `UPDATE stock_units
         SET last_inspection_date = NULL,
             last_inspection_status = NULL,
             last_inspection_technician = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [insp.stock_unit_id],
      )
    }

    await client.query('COMMIT')

    void broadcastSyncEvent({ scope: 'stock-units', action: 'inspection-deleted', entityId: insp.stock_unit_id })

    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

export default router

