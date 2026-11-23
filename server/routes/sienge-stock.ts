import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAdmin, requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { recordAuditLog } from '../services/audit-log.js'
import { decryptPersonalData, encryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'
import { getSiengeDailyUsage, getSiengeStockSettings, SiengeRequestError, siengePost } from '../services/sienge.js'
import { fetchSiengeStockAppropriations, syncSiengeStockCenters } from '../services/sienge-stock.js'
import { broadcastSyncEvent } from '../services/sync-events.js'

const router = Router()
const intIdSchema = z.number().int().positive().max(2147483647)
const snapshotItemIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Informe uma data válida.')

class SiengeStockRouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function decodeSignature(value: string) {
  const bytes = Buffer.from(value, 'base64')
  return Boolean(bytes.length && bytes.length <= 100 * 1024 &&
    bytes.toString('base64') === value &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
}

const costCenterSchema = z.object({
  costCenterId: intIdSchema,
  departmentId: intIdSchema.nullable(),
})
const costCenterMappingSchema = z.object({
  costCenters: z.array(costCenterSchema).max(500),
}).superRefine((data, context) => {
  const ids = data.costCenters.map((center) => center.costCenterId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Remova os centros de custo duplicados.', path: ['costCenters'] })
  }
})

const querySchema = z.object({
  locationId: z.coerce.number().int().positive().max(2147483647).optional(),
  costCenterId: z.coerce.number().int().positive().max(2147483647).optional(),
  resourceId: z.coerce.number().int().positive().max(2147483647).optional(),
  search: z.string().trim().max(200).default(''),
  view: z.enum(['center', 'location']).default('center'),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const appropriationSchema = z.object({
  buildingUnitId: intIdSchema,
  sheetItemId: intIdSchema,
  percentage: z.number().positive().max(100).refine((value) => Math.abs(value * 1e12 - Math.round(value * 1e12)) < 0.01),
})
const appropriationListSchema = z.array(appropriationSchema).min(1).max(100).superRefine((items, context) => {
  const total = items.reduce((sum, item) => sum + item.percentage, 0)
  if (Math.abs(total - 100) > 1e-8) {
    context.addIssue({ code: 'custom', message: 'Os percentuais de apropriação devem totalizar 100%.', path: [] })
  }
  const keys = items.map((item) => `${item.buildingUnitId}:${item.sheetItemId}`)
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', message: 'Remova itens de orçamento duplicados nas apropriações.', path: [] })
  }
})

const movementLineSchema = z.object({
  snapshotItemId: snapshotItemIdSchema,
  quantity: z.number().positive().max(1_000_000_000)
    .refine((value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.000001),
  sourceBuildingAppropriations: appropriationListSchema,
  destinationResourceId: intIdSchema.optional(),
  destinationDetailId: intIdSchema.nullable().optional(),
  destinationTrademarkId: intIdSchema.nullable().optional(),
  destinationBuildingAppropriations: appropriationListSchema.optional(),
})

const uniformDetailsSchema = z.object({
  deliveryDate: dateSchema,
  shirtSizeId: intIdSchema.nullable(),
  shirtShortSleeveQty: z.number().int().min(0).max(99),
  shirtLongSleeveQty: z.number().int().min(0).max(99),
  pantsSize: z.number().int().min(32).max(58).nullable(),
  pantsQty: z.number().int().min(0).max(99),
  bootSize: z.number().int().min(34).max(48).nullable(),
  bootQty: z.number().int().min(0).max(99),
}).superRefine((value, context) => {
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty > 0 && !value.shirtSizeId) {
    context.addIssue({ code: 'custom', path: ['shirtSizeId'], message: 'Selecione o tamanho da camisa entregue.' })
  }
  if (value.pantsQty > 0 && value.pantsSize === null) {
    context.addIssue({ code: 'custom', path: ['pantsSize'], message: 'Selecione o tamanho da calça entregue.' })
  }
  if (value.bootQty > 0 && value.bootSize === null) {
    context.addIssue({ code: 'custom', path: ['bootSize'], message: 'Selecione o tamanho da bota entregue.' })
  }
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty + value.pantsQty + value.bootQty === 0) {
    context.addIssue({ code: 'custom', path: ['shirtShortSleeveQty'], message: 'Informe ao menos um item entregue.' })
  }
})

const movementSchema = z.object({
  requestKey: z.string().uuid(),
  confirmed: z.literal(true),
  operationType: z.enum(['issue', 'transfer', 'epi_delivery', 'uniform_delivery']),
  transactionDate: dateSchema,
  costCenterId: intIdSchema,
  items: z.array(movementLineSchema).min(1).max(100),
  destinationCostCenterId: intIdSchema.optional(),
  collaboratorId: intIdSchema.optional(),
  delivererPin: z.string().regex(/^\d{6,12}$/).optional(),
  recipientSignatureBase64: z.string().optional(),
  uniformDetails: uniformDetailsSchema.optional(),
  notes: z.string().trim().max(500).default(''),
}).superRefine((data, context) => {
  const snapshotItemIds = data.items.map((item) => item.snapshotItemId)
  if (new Set(snapshotItemIds).size !== snapshotItemIds.length) {
    context.addIssue({ code: 'custom', message: 'Remova itens duplicados da movimentação.', path: ['items'] })
  }
  if (data.operationType === 'transfer') {
    if (!data.destinationCostCenterId || data.destinationCostCenterId === data.costCenterId) {
      context.addIssue({ code: 'custom', message: 'Selecione um centro de custo de destino diferente da origem.', path: ['destinationCostCenterId'] })
    }
    data.items.forEach((item, index) => {
      if (!item.destinationResourceId || !item.destinationBuildingAppropriations) {
        context.addIssue({ code: 'custom', message: 'Informe o resourceId e as apropriações de destino para cada item transferido.', path: ['items', index] })
      }
      if (item.destinationDetailId !== undefined && item.destinationDetailId !== null && !item.destinationResourceId) {
        context.addIssue({ code: 'custom', message: 'Informe o resourceId de destino para o detalhe selecionado.', path: ['items', index, 'destinationResourceId'] })
      }
    })
  } else if (data.destinationCostCenterId || data.items.some((item) =>
    item.destinationResourceId || item.destinationDetailId !== undefined ||
    item.destinationTrademarkId !== undefined || item.destinationBuildingAppropriations)) {
    context.addIssue({ code: 'custom', message: 'Dados do centro de destino só são aceitos em transferências.', path: ['destinationCostCenterId'] })
  }
  if (data.operationType === 'epi_delivery' || data.operationType === 'uniform_delivery') {
    if (!data.collaboratorId || !data.delivererPin || !data.recipientSignatureBase64) {
      context.addIssue({ code: 'custom', message: 'Selecione o colaborador, informe seu PIN e colete a assinatura de quem recebe.', path: ['collaboratorId'] })
    }
    if (data.operationType === 'uniform_delivery' && !data.uniformDetails) {
      context.addIssue({ code: 'custom', message: 'Informe as peças e tamanhos entregues.', path: ['uniformDetails'] })
    }
    if (data.operationType === 'epi_delivery' && data.uniformDetails) {
      context.addIssue({ code: 'custom', message: 'Dados de fardamento não são aceitos em entregas de EPI.', path: ['uniformDetails'] })
    }
  } else if (data.collaboratorId || data.delivererPin || data.recipientSignatureBase64 || data.uniformDetails) {
    context.addIssue({ code: 'custom', message: 'Os dados do colaborador são exclusivos de entregas de EPI.', path: ['collaboratorId'] })
  }
})

router.use(requireAuth)

router.get('/locations', requirePageAccess('inventory'), async (_req, res, next) => {
  try {
    const [locations, centers] = await Promise.all([
      pool.query<{ id: string; name: string; is_active: boolean }>(
        `SELECT id, name, is_active FROM inventory_locations
         ORDER BY is_active DESC, lower(name)`,
      ),
      pool.query<{
        cost_center_id: string
        location_id: string | null
        location_name: string | null
        department_id: string | null
        item_count: string | null
        synchronized_at: string | null
        needs_refresh: boolean | null
      }>(
        `SELECT center.cost_center_id, center.location_id, location.name AS location_name,
                center.department_id, snapshot.item_count, snapshot.synchronized_at,
                snapshot.needs_refresh
         FROM inventory_sienge_cost_centers center
         LEFT JOIN inventory_locations location ON location.id = center.location_id
         LEFT JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = center.cost_center_id
         ORDER BY center.cost_center_id`,
      ),
    ])
    res.json({
      locations: locations.rows.map((location) => ({
        id: Number(location.id),
        name: location.name,
        isActive: location.is_active,
        costCenters: centers.rows
          .filter((center) => Number(center.location_id) === Number(location.id))
          .map((center) => ({
            costCenterId: Number(center.cost_center_id),
            departmentId: center.department_id === null ? null : Number(center.department_id),
            itemCount: center.item_count === null ? null : Number(center.item_count),
            synchronizedAt: center.synchronized_at,
            needsRefresh: center.needs_refresh ?? false,
          })),
      })),
      unassignedCostCenters: centers.rows.filter((center) => center.location_id === null).map((center) => ({
        costCenterId: Number(center.cost_center_id),
        departmentId: center.department_id === null ? null : Number(center.department_id),
        itemCount: center.item_count === null ? null : Number(center.item_count),
        synchronizedAt: center.synchronized_at,
        needsRefresh: center.needs_refresh ?? false,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/collaborators', requirePageAccess('inventory'), async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: string
      name: string
      is_active: boolean
      is_on_leave: boolean
    }>(
      `SELECT id, name, (termination_date IS NULL OR termination_date > CURRENT_DATE) AS is_active,
              is_on_leave
       FROM collaborators
       WHERE termination_date IS NULL OR termination_date > CURRENT_DATE
       ORDER BY lower(name), id
       LIMIT 5000`,
    )
    res.json({
      collaborators: result.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        isActive: row.is_active,
        isOnLeave: row.is_on_leave,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/items', requirePageAccess('inventory'), async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Filtros de estoque Sienge inválidos.' })
    return
  }
  try {
    const { locationId, costCenterId, resourceId, search, view, offset, limit } = parsed.data
    const searchPattern = search ? `%${search}%` : null
    const parameters = [locationId ?? null, costCenterId ?? null, resourceId ?? null, searchPattern]
    const where = `WHERE ($1::bigint IS NULL OR center.location_id = $1)
                     AND ($2::integer IS NULL OR center.cost_center_id = $2)
                     AND ($3::integer IS NULL OR item.resource_id = $3)
                     AND ($4::text IS NULL OR item.resource_id::text ILIKE $4
                          OR item.resource_description ILIKE $4
                          OR COALESCE(item.detail_description, '') ILIKE $4
                          OR COALESCE(item.trademark_description, '') ILIKE $4)`
    const matched = `SELECT item.snapshot_item_id, item.cost_center_id, center.location_id,
                            COALESCE(location.name, 'Sem local') AS location_name,
                            item.resource_id, item.resource_description, item.detail_id,
                            item.detail_description, item.trademark_id, item.trademark_description,
                            item.quantity, item.unit_of_measure, item.average_price,
                            item.synchronized_at, snapshot.needs_refresh
                     FROM sienge_stock_items item
                     JOIN inventory_sienge_cost_centers center ON center.cost_center_id = item.cost_center_id
                     JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = item.cost_center_id
                     LEFT JOIN inventory_locations location ON location.id = center.location_id
                     ${where}`
    type CenterBalance = {
      snapshotItemId: number
      costCenterId: number
      quantity: number
      unitOfMeasure: string
      synchronizedAt: string
      needsRefresh: boolean
    }
    let rows: {
      location_id: string | null
      location_name: string
      resource_id: string
      resource_description: string
      detail_id: string | null
      detail_description: string | null
      trademark_id: string | null
      trademark_description: string | null
      quantity: string
      unit_of_measure: string
      average_price: string | null
      synchronized_at: string | null
      needs_refresh: boolean
      snapshot_item_id?: string
      cost_center_id?: string
      center_quantities?: CenterBalance[]
    }[]
    let totalCount: number
    if (view === 'location') {
      const grouped = `SELECT location_id, location_name, resource_id,
                              max(resource_description) AS resource_description,
                              detail_id, max(detail_description) AS detail_description,
                              trademark_id, max(trademark_description) AS trademark_description,
                              unit_of_measure, sum(quantity)::text AS quantity,
                              max(average_price)::text AS average_price,
                              max(synchronized_at)::text AS synchronized_at,
                              bool_or(needs_refresh) AS needs_refresh,
                              jsonb_agg(jsonb_build_object(
                                'snapshotItemId', snapshot_item_id,
                                'costCenterId', cost_center_id,
                                'quantity', quantity,
                                'unitOfMeasure', unit_of_measure,
                                'synchronizedAt', synchronized_at,
                                'needsRefresh', needs_refresh
                              ) ORDER BY cost_center_id) AS center_quantities
                       FROM (${matched}) matched_items
                       GROUP BY location_id, location_name, resource_id, detail_id,
                                trademark_id, unit_of_measure`
      const [count, groupedRows] = await Promise.all([
        pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM (${grouped}) groups`, parameters),
        pool.query<(typeof rows)[number]>(
          `SELECT * FROM (${grouped}) groups
           ORDER BY location_name, resource_id, detail_id NULLS FIRST, trademark_id NULLS FIRST, unit_of_measure
           OFFSET $5 LIMIT $6`,
          [...parameters, offset, limit],
        ),
      ])
      totalCount = Number(count.rows[0]?.count ?? 0)
      rows = groupedRows.rows
    } else {
      const [count, centerRows] = await Promise.all([
        pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM (${matched}) matched_items`, parameters),
        pool.query<(typeof rows)[number]>(
          `SELECT * FROM (${matched}) matched_items
           ORDER BY cost_center_id, resource_id, detail_id NULLS FIRST,
                    trademark_id NULLS FIRST, snapshot_item_id
           OFFSET $5 LIMIT $6`,
          [...parameters, offset, limit],
        ),
      ])
      totalCount = Number(count.rows[0]?.count ?? 0)
      rows = centerRows.rows
    }
    res.json({
      items: rows.map((row) => ({
        costCenterId: row.cost_center_id ? Number(row.cost_center_id) : null,
        locationId: row.location_id ? Number(row.location_id) : null,
        locationName: row.location_name,
        snapshotItemId: row.snapshot_item_id ? Number(row.snapshot_item_id) : null,
        resourceId: Number(row.resource_id),
        resourceDescription: row.resource_description,
        detailId: row.detail_id === null ? null : Number(row.detail_id),
        detailDescription: row.detail_description,
        trademarkId: row.trademark_id === null ? null : Number(row.trademark_id),
        trademarkDescription: row.trademark_description,
        quantity: Number(row.quantity),
        unitOfMeasure: row.unit_of_measure,
        averagePrice: row.average_price === null ? null : Number(row.average_price),
        synchronizedAt: row.synchronized_at,
        needsRefresh: row.needs_refresh,
        centerQuantities: row.center_quantities ?? (row.snapshot_item_id && row.cost_center_id ? [{
          snapshotItemId: Number(row.snapshot_item_id),
          costCenterId: Number(row.cost_center_id),
          quantity: Number(row.quantity),
          unitOfMeasure: row.unit_of_measure,
          synchronizedAt: row.synchronized_at!,
          needsRefresh: row.needs_refresh,
        }] : []),
      })),
      total: totalCount,
      offset,
      limit,
      view,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/items/:snapshotItemId/appropriations', requirePageAccess('inventory'), async (req, res, next) => {
  const parsed = z.object({
    snapshotItemId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ error: 'Identificador do item do snapshot inválido.' })
    return
  }

  try {
    const result = await pool.query<{
      cost_center_id: string
      resource_id: string
      detail_id: string | null
      trademark_id: string | null
    }>(
      `SELECT item.cost_center_id, item.resource_id, item.detail_id, item.trademark_id
       FROM sienge_stock_items item
       JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = item.cost_center_id
       WHERE item.snapshot_item_id = $1 AND snapshot.needs_refresh = FALSE`,
      [parsed.data.snapshotItemId],
    )
    const item = result.rows[0]
    if (!item) {
      res.status(404).json({ error: 'Item não encontrado ou com atualização pendente. Sincronize o centro de custo e tente novamente.' })
      return
    }

    const appropriations = await fetchSiengeStockAppropriations(
      Number(item.cost_center_id),
      Number(item.resource_id),
      item.detail_id === null ? null : Number(item.detail_id),
      item.trademark_id === null ? null : Number(item.trademark_id),
    )
    res.json({ appropriations })
  } catch (error) {
    next(error)
  }
})

router.get('/uniform-stock-options', requirePageAccess('collaborators'), async (req, res, next) => {
  const parsed = z.object({
    costCenterId: z.coerce.number().int().positive().max(2147483647).optional(),
    search: z.string().trim().max(200).default(''),
  }).safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Filtro de estoque para fardamento inválido.' })
    return
  }
  try {
    const centers = await pool.query<{
      cost_center_id: string
      location_name: string
      needs_refresh: boolean | null
      synchronized_at: string | null
    }>(
      `SELECT center.cost_center_id, location.name AS location_name,
              snapshot.needs_refresh, snapshot.synchronized_at
       FROM inventory_sienge_cost_centers center
       JOIN inventory_locations location ON location.id = center.location_id AND location.is_active
       LEFT JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = center.cost_center_id
       ORDER BY location.name, center.cost_center_id`,
    )
    let items: {
      snapshot_item_id: string
      cost_center_id: string
      resource_id: string
      resource_description: string
      detail_id: string | null
      detail_description: string | null
      trademark_id: string | null
      trademark_description: string | null
      quantity: string
      unit_of_measure: string
    }[] = []
    if (parsed.data.costCenterId) {
      const searchPattern = parsed.data.search ? `%${parsed.data.search}%` : null
      const result = await pool.query<(typeof items)[number]>(
        `SELECT item.snapshot_item_id, item.cost_center_id, item.resource_id,
                item.resource_description, item.detail_id, item.detail_description,
                item.trademark_id, item.trademark_description, item.quantity::text,
                item.unit_of_measure
         FROM sienge_stock_items item
         JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = item.cost_center_id
         JOIN inventory_sienge_cost_centers center ON center.cost_center_id = item.cost_center_id
         JOIN inventory_locations location ON location.id = center.location_id AND location.is_active
         WHERE item.cost_center_id = $1 AND snapshot.needs_refresh = FALSE
           AND ($2::text IS NULL OR item.resource_id::text ILIKE $2
                OR item.resource_description ILIKE $2
                OR COALESCE(item.detail_description, '') ILIKE $2
                OR COALESCE(item.trademark_description, '') ILIKE $2)
         ORDER BY item.resource_description, item.detail_id NULLS FIRST,
                  item.trademark_id NULLS FIRST, item.snapshot_item_id
         LIMIT 200`,
        [parsed.data.costCenterId, searchPattern],
      )
      items = result.rows
    }
    res.json({
      costCenters: centers.rows.map((center) => ({
        costCenterId: Number(center.cost_center_id),
        locationName: center.location_name,
        needsRefresh: center.needs_refresh ?? true,
        synchronizedAt: center.synchronized_at,
      })),
      items: items.map((item) => ({
        snapshotItemId: Number(item.snapshot_item_id),
        costCenterId: Number(item.cost_center_id),
        resourceId: Number(item.resource_id),
        resourceDescription: item.resource_description,
        detailId: item.detail_id === null ? null : Number(item.detail_id),
        detailDescription: item.detail_description,
        trademarkId: item.trademark_id === null ? null : Number(item.trademark_id),
        trademarkDescription: item.trademark_description,
        quantity: Number(item.quantity),
        unitOfMeasure: item.unit_of_measure,
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.get('/movements/unresolved', requirePageAccess('inventory'), requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: string
      operation_type: string
      status: string
      cost_center_id: string
      destination_cost_center_id: string | null
      resource_id: string
      quantity: string
      unit_of_measure: string
      actor_name: string
      created_at: string
      error_message: string | null
      item_count: string
    }>(
      `SELECT movement.id, movement.operation_type, movement.status,
              movement.cost_center_id, movement.destination_cost_center_id,
              movement.resource_id, movement.quantity::text, movement.unit_of_measure,
              movement.actor_name, movement.created_at, movement.error_message,
              (SELECT count(*)::text FROM sienge_stock_movement_items line
               WHERE line.movement_id = movement.id) AS item_count
       FROM sienge_stock_movements movement
       WHERE movement.status IN ('pending', 'unknown')
       ORDER BY movement.created_at, movement.id
       LIMIT 100`,
    )
    res.json({
      movements: result.rows.map((movement) => ({
        id: Number(movement.id),
        operationType: movement.operation_type,
        status: movement.status,
        costCenterId: Number(movement.cost_center_id),
        destinationCostCenterId: movement.destination_cost_center_id
          ? Number(movement.destination_cost_center_id)
          : null,
        resourceId: Number(movement.resource_id),
        quantity: Number(movement.quantity),
        unitOfMeasure: movement.unit_of_measure,
        actorName: movement.actor_name,
        createdAt: movement.created_at,
        errorMessage: movement.error_message,
        itemCount: Number(movement.item_count),
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/movements/:id/reconcile', requirePageAccess('inventory'), requireAdmin, async (req, res, next) => {
  const movementId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({
    status: z.enum(['succeeded', 'failed']),
    note: z.string().trim().min(5).max(500),
  }).safeParse(req.body)
  if (!movementId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador de movimento inválido.' : parsed.error.issues[0]?.message ?? 'Informe o resultado conferido no Sienge.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ status: string; cost_center_id: number; destination_cost_center_id: number | null }>(
      `SELECT status, cost_center_id, destination_cost_center_id
       FROM sienge_stock_movements WHERE id = $1 FOR UPDATE`,
      [movementId.data],
    )
    if (!current.rowCount) throw new SiengeStockRouteError(404, 'Movimento não encontrado.')
    if (!['pending', 'unknown'].includes(current.rows[0].status)) {
      throw new SiengeStockRouteError(409, 'Este movimento não está pendente de reconciliação.')
    }
    await client.query(
      `UPDATE sienge_stock_movements
       SET status = $1, reconciliation_note = $2, reconciled_by = $3,
           reconciled_at = now(), updated_at = now()
       WHERE id = $4`,
      [parsed.data.status, parsed.data.note, req.session.user!.id, movementId.data],
    )
    await client.query(
      `UPDATE sienge_stock_snapshots SET needs_refresh = TRUE
       WHERE cost_center_id = ANY($1::integer[])`,
      [[current.rows[0].cost_center_id, current.rows[0].destination_cost_center_id].filter((id): id is number => id !== null)],
    )
    await client.query('COMMIT')
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'sienge_stock_movement_reconciled',
      resourceType: 'sienge_stock_movement',
      resourceId: movementId.data,
      summary: 'Resultado de movimento Sienge reconciliado manualmente.',
      metadata: { status: parsed.data.status, note: parsed.data.note },
    })
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof SiengeStockRouteError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.put('/locations/:locationId/cost-centers', requirePageAccess('inventory'), requireAdmin, async (req, res, next) => {
  const locationId = z.coerce.number().int().positive().safeParse(req.params.locationId)
  const parsed = costCenterMappingSchema.safeParse(req.body)
  if (!locationId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador de local inválido.' : parsed.error.issues[0]?.message ?? 'Centros de custo inválidos.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const location = await client.query<{ id: string }>(
      `SELECT id FROM inventory_locations WHERE id = $1 FOR UPDATE`,
      [locationId.data],
    )
    if (!location.rowCount) throw new SiengeStockRouteError(404, 'Local de estoque não encontrado.')

    const ids = parsed.data.costCenters.map((center) => center.costCenterId)
    if (ids.length) {
      await client.query(
        `UPDATE inventory_sienge_cost_centers
         SET location_id = NULL, department_id = NULL, updated_by = $2, updated_at = now()
         WHERE location_id = $1 AND NOT (cost_center_id = ANY($3::integer[]))`,
        [locationId.data, req.session.user!.id, ids],
      )
    } else {
      await client.query(
        `UPDATE inventory_sienge_cost_centers
         SET location_id = NULL, department_id = NULL, updated_by = $2, updated_at = now()
         WHERE location_id = $1`,
        [locationId.data, req.session.user!.id],
      )
    }

    for (const center of parsed.data.costCenters) {
      const saved = await client.query(
        `INSERT INTO inventory_sienge_cost_centers
           (cost_center_id, location_id, department_id, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cost_center_id)
         DO UPDATE SET location_id = EXCLUDED.location_id,
                       department_id = EXCLUDED.department_id,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()
         WHERE inventory_sienge_cost_centers.location_id IS NULL
            OR inventory_sienge_cost_centers.location_id = EXCLUDED.location_id
         RETURNING cost_center_id`,
        [center.costCenterId, locationId.data, center.departmentId, req.session.user!.id],
      )
      if (!saved.rowCount) {
        throw new SiengeStockRouteError(409, `O centro de custo ${center.costCenterId} já está associado a outro local.`)
      }
    }
    await client.query('COMMIT')
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'inventory_sienge_centers_update',
      resourceType: 'inventory_location',
      resourceId: locationId.data,
      summary: 'Centros de custo Sienge do local atualizados.',
      metadata: { costCenters: parsed.data.costCenters },
    })
    await broadcastSyncEvent({
      scope: 'settings',
      action: 'sienge_cost_centers_update',
      meta: { updatedBy: req.session.user!.displayName },
    })
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof SiengeStockRouteError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.post('/sync', requirePageAccess('inventory'), requireAdmin, async (req, res, next) => {
  const parsed = z.object({ locationId: z.number().int().positive().optional() }).safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Local inválido para sincronização.' })
    return
  }
  try {
    const centers = await pool.query<{ cost_center_id: number }>(
      `SELECT cost_center_id FROM inventory_sienge_cost_centers
       WHERE location_id IS NOT NULL AND ($1::bigint IS NULL OR location_id = $1)
       ORDER BY cost_center_id`,
      [parsed.data.locationId ?? null],
    )
    if (!centers.rowCount) {
      res.status(400).json({ error: 'Associe ao menos um centro de custo a um local antes de sincronizar.' })
      return
    }
    const centerIds = centers.rows.map((center) => center.cost_center_id)
    const result = await syncSiengeStockCenters(centerIds, req.session.user!.id)
    const usage = await getSiengeDailyUsage()
    await recordAuditLog({
      actorUserId: req.session.user!.id,
      actorName: req.session.user!.displayName,
      action: 'sienge_stock_sync',
      resourceType: 'sienge_stock',
      summary: 'Sincronização de estoque Sienge executada.',
      metadata: {
        locationId: parsed.data.locationId ?? null,
        synchronizedCenters: result.results.filter((center) => center.error === null).map((center) => center.costCenterId),
        failedCenterId: result.results.find((center) => center.error !== null)?.costCenterId ?? null,
        notAttemptedCenterIds: result.notAttemptedCenterIds,
      },
    })
    res.json({ ...result, requestCountToday: usage.requestCount, usageDate: usage.usageDate })
  } catch (error) {
    if (error instanceof SiengeRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.post('/movements', (req, res, next) => {
  const page = req.body?.operationType === 'uniform_delivery' ? 'collaborators' : 'inventory'
  requirePageAccess(page)(req, res, next)
}, async (req, res, next) => {
  const parsed = movementSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da movimentação Sienge inválidos.' })
    return
  }
  const data = parsed.data
  const isTransfer = data.operationType === 'transfer'
  const isPersonDelivery = data.operationType === 'epi_delivery' || data.operationType === 'uniform_delivery'
  const isUniformDelivery = data.operationType === 'uniform_delivery'
  const settings = await getSiengeStockSettings().catch(next)
  if (!settings) return
  const documentId = isTransfer
    ? settings.transferDocumentId
    : isUniformDelivery ? settings.uniformDocumentId
      : data.operationType === 'epi_delivery' ? settings.epiDocumentId : settings.issueDocumentId
  const movementTypeId = isTransfer
    ? settings.transferMovementTypeId
    : isUniformDelivery ? settings.uniformMovementTypeId
      : data.operationType === 'epi_delivery' ? settings.epiMovementTypeId : settings.issueMovementTypeId
  if (!documentId || !movementTypeId) {
    res.status(409).json({
      error: isTransfer
        ? 'Configure o documento e o tipo de movimento de transferência em Acessos e Configurações antes de enviar ao Sienge.'
        : isUniformDelivery
          ? 'Configure o documento e o tipo de movimento de fardamento em Acessos e Configurações antes de registrar a entrega.'
          : data.operationType === 'epi_delivery'
          ? 'Configure o documento e o tipo de movimento de EPI em Acessos e Configurações antes de enviar ao Sienge.'
          : 'Configure o documento e o tipo de movimento de saída em Acessos e Configurações antes de enviar ao Sienge.',
    })
    return
  }
  if (isPersonDelivery && (!isPersonalDataEncryptionConfigured() || !decodeSignature(data.recipientSignatureBase64!))) {
    res.status(isPersonalDataEncryptionConfigured() ? 400 : 503).json({
      error: isPersonalDataEncryptionConfigured()
        ? 'A assinatura de quem recebe deve ser uma imagem PNG válida de até 100 KiB.'
        : 'Configure PII_ENCRYPTION_KEY antes de registrar entregas com assinatura.',
    })
    return
  }

  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM sienge_stock_movements WHERE request_key = $1`,
    [data.requestKey],
  ).catch(next)
  if (!existing) return
  if (existing.rowCount) {
    if (existing.rows[0].status === 'succeeded') {
      res.json({ success: true, duplicateRequest: true, status: 'succeeded', snapshotRefreshRequired: true })
    } else {
      res.status(409).json({
        error: existing.rows[0].status === 'unknown'
          ? 'O resultado desta operação ainda é incerto. Não a reenvie; confira o movimento no Sienge antes de iniciar outra operação.'
          : 'Esta operação já foi processada ou está em andamento. Use uma nova solicitação somente após conferir o histórico.',
      })
    }
    return
  }

  const client = await pool.connect()
  let outboundPayload: Record<string, unknown> | null = null
  let movementId: number | null = null
  let sourceItems: Map<number, {
    sienge_item_id: string | null
    resource_id: string
    resource_description: string
    detail_id: string | null
    detail_description: string | null
    trademark_id: string | null
    trademark_description: string | null
    quantity: string
    unit_of_measure: string
  }> = new Map()
  let sourceDepartmentId: number | null = null
  let destinationDepartmentId: number | null = null
  let delivererSignatureCiphertext: string | null = null
  let recipientSignatureCiphertext: string | null = null

  try {
    await client.query('BEGIN')
    const lockedCenterIds = [data.costCenterId, ...(isTransfer ? [data.destinationCostCenterId!] : [])].sort((a, b) => a - b)
    for (const centerId of lockedCenterIds) {
      await client.query('SELECT pg_advisory_xact_lock(88001, $1)', [centerId])
    }
    const sourceCenter = await client.query<{
      location_id: string | null
      location_active: boolean | null
      department_id: string | null
      needs_refresh: boolean | null
    }>(
      `SELECT center.location_id, location.is_active AS location_active, center.department_id,
              snapshot.needs_refresh
       FROM inventory_sienge_cost_centers center
       LEFT JOIN inventory_locations location ON location.id = center.location_id
       LEFT JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = center.cost_center_id
       WHERE center.cost_center_id = $1 FOR UPDATE OF center`,
      [data.costCenterId],
    )
    if (!sourceCenter.rowCount || !sourceCenter.rows[0].location_id || !sourceCenter.rows[0].location_active) {
      throw new SiengeStockRouteError(409, 'Associe o centro de custo de origem a um local ativo antes de movimentar o estoque.')
    }
    if (sourceCenter.rows[0].needs_refresh !== false) {
      throw new SiengeStockRouteError(409, 'Sincronize novamente o centro de custo após a última movimentação antes de registrar outra.')
    }
    const unresolved = await client.query<{ status: string }>(
      `SELECT status FROM sienge_stock_movements
       WHERE (cost_center_id = $1 OR destination_cost_center_id = $1)
         AND status IN ('pending', 'unknown')
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [data.costCenterId],
    )
    if (unresolved.rowCount) {
      throw new SiengeStockRouteError(409, 'Há uma operação anterior sem resultado confirmado para este item. Confira o histórico no Sienge e solicite a reconciliação administrativa antes de continuar.')
    }
    const snapshotIds = data.items.map((item) => item.snapshotItemId)
    const sourceRows = await client.query<{
      snapshot_item_id: string
      sienge_item_id: string | null
      resource_id: string
      resource_description: string
      detail_id: string | null
      detail_description: string | null
      trademark_id: string | null
      trademark_description: string | null
      quantity: string
      unit_of_measure: string
    }>(
      `SELECT item.snapshot_item_id, item.sienge_item_id, item.resource_id,
              item.resource_description, item.detail_id, item.detail_description,
              item.trademark_id, item.trademark_description, item.quantity::text,
              item.unit_of_measure
       FROM sienge_stock_items item
       WHERE item.cost_center_id = $1 AND item.snapshot_item_id = ANY($2::bigint[])
       ORDER BY item.snapshot_item_id
       FOR UPDATE`,
      [data.costCenterId, snapshotIds],
    )
    if (sourceRows.rowCount !== data.items.length) {
      throw new SiengeStockRouteError(404, 'Um ou mais itens não estão no snapshot Sienge selecionado. Sincronize o centro de custo.')
    }
    sourceItems = new Map(sourceRows.rows.map((item) => [Number(item.snapshot_item_id), item]))
    for (const line of data.items) {
      const sourceItem = sourceItems.get(line.snapshotItemId)
      if (!sourceItem) throw new SiengeStockRouteError(404, 'Item não encontrado no snapshot Sienge.')
      if (line.quantity > Number(sourceItem.quantity)) {
        throw new SiengeStockRouteError(409, `Saldo sincronizado insuficiente para ${sourceItem.resource_description}. Disponível: ${sourceItem.quantity} ${sourceItem.unit_of_measure}.`)
      }
    }
    sourceDepartmentId = sourceCenter.rows[0].department_id === null
      ? null
      : Number(sourceCenter.rows[0].department_id)

    if (isTransfer) {
      const destination = await client.query<{ location_id: string | null; location_active: boolean | null; department_id: string | null; needs_refresh: boolean | null }>(
        `SELECT center.location_id, location.is_active AS location_active, center.department_id,
                snapshot.needs_refresh
         FROM inventory_sienge_cost_centers center
         LEFT JOIN inventory_locations location ON location.id = center.location_id
         LEFT JOIN sienge_stock_snapshots snapshot ON snapshot.cost_center_id = center.cost_center_id
         WHERE center.cost_center_id = $1 FOR UPDATE OF center`,
        [data.destinationCostCenterId],
      )
      if (!destination.rowCount) throw new SiengeStockRouteError(404, 'Centro de custo de destino não cadastrado.')
      if (!destination.rows[0].location_id || !destination.rows[0].location_active) {
        throw new SiengeStockRouteError(409, 'Associe o centro de custo de destino a um local ativo antes de transferir.')
      }
      if (destination.rows[0].needs_refresh !== false) {
        throw new SiengeStockRouteError(409, 'Sincronize o centro de custo de destino antes de transferir para ele.')
      }
      destinationDepartmentId = destination.rows[0].department_id === null ? null : Number(destination.rows[0].department_id)
      outboundPayload = {
        documentId,
        movementDate: data.transactionDate,
        movementTypeId,
        sourceCostCenterId: data.costCenterId,
        ...(sourceDepartmentId ? { sourceDepartmentId } : {}),
        destinationCostCenterId: data.destinationCostCenterId,
        ...(destinationDepartmentId ? { destinationDepartmentId } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        items: data.items.map((line) => {
          const item = sourceItems.get(line.snapshotItemId)!
          return {
            source: {
              resourceId: Number(item.resource_id),
              ...(item.detail_id ? { detailId: Number(item.detail_id) } : {}),
              ...(item.trademark_id ? { trademarkId: Number(item.trademark_id) } : {}),
              quantity: line.quantity,
              unitOfMeasure: item.unit_of_measure,
              buildingAppropriations: line.sourceBuildingAppropriations,
            },
            destination: {
              resourceId: line.destinationResourceId!,
              ...(line.destinationDetailId ? { detailId: line.destinationDetailId } : {}),
              ...(line.destinationTrademarkId ? { trademarkId: line.destinationTrademarkId } : {}),
              buildingAppropriations: line.destinationBuildingAppropriations!,
            },
          }
        }),
      }
    } else {
      outboundPayload = {
        documentId,
        movementDate: data.transactionDate,
        movementTypeId,
        costCenterId: data.costCenterId,
        ...(data.notes ? { notes: data.notes } : {}),
        items: data.items.map((line) => {
          const item = sourceItems.get(line.snapshotItemId)!
          return {
            resourceId: Number(item.resource_id),
            ...(item.detail_id ? { detailId: Number(item.detail_id) } : {}),
            ...(item.trademark_id ? { trademarkId: Number(item.trademark_id) } : {}),
            quantity: line.quantity,
            unitOfMeasure: item.unit_of_measure,
            buildingAppropriations: line.sourceBuildingAppropriations,
          }
        }),
      }
    }

    if (isPersonDelivery) {
      const collaborator = await client.query<{ is_active: boolean; is_on_leave: boolean }>(
        `SELECT (termination_date IS NULL OR termination_date > CURRENT_DATE) AS is_active, is_on_leave
         FROM collaborators WHERE id = $1 FOR UPDATE`,
        [data.collaboratorId],
      )
      if (!collaborator.rowCount) throw new SiengeStockRouteError(404, 'Colaborador não encontrado.')
      if (!collaborator.rows[0].is_active || collaborator.rows[0].is_on_leave) {
        throw new SiengeStockRouteError(409, 'Só é possível registrar entrega para colaborador ativo e sem afastamento.')
      }
      if (isUniformDelivery && data.uniformDetails?.shirtSizeId) {
        const shirtSize = await client.query(
          'SELECT 1 FROM collaborator_shirt_sizes WHERE id = $1',
          [data.uniformDetails.shirtSizeId],
        )
        if (!shirtSize.rowCount) throw new SiengeStockRouteError(400, 'O tamanho de camisa selecionado não existe.')
      }
      const deliverer = await client.query<{
        signature_data_ciphertext: string | null
        signature_pin_hash: string | null
        signature_pin_failed_attempts: number
        signature_pin_locked_until: Date | null
      }>(
        `SELECT signature_data_ciphertext, signature_pin_hash,
                signature_pin_failed_attempts, signature_pin_locked_until
         FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [req.session.user!.id],
      )
      const profile = deliverer.rows[0]
      if (!profile?.signature_pin_hash || !profile.signature_data_ciphertext) {
        throw new SiengeStockRouteError(409, 'Cadastre uma assinatura e um PIN no perfil antes de registrar a entrega.')
      }
      if (profile.signature_pin_locked_until && profile.signature_pin_locked_until > new Date()) {
        throw new SiengeStockRouteError(429, 'PIN temporariamente bloqueado após várias tentativas. Aguarde 15 minutos.')
      }
      if (!await bcrypt.compare(data.delivererPin!, profile.signature_pin_hash)) {
        const attempts = profile.signature_pin_locked_until && profile.signature_pin_locked_until <= new Date()
          ? 1
          : profile.signature_pin_failed_attempts + 1
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
        await client.query(
          `UPDATE users SET signature_pin_failed_attempts = $1, signature_pin_locked_until = $2 WHERE id = $3`,
          [attempts, lockedUntil, req.session.user!.id],
        )
        await client.query('COMMIT')
        res.status(401).json({
          error: lockedUntil
            ? 'PIN incorreto. O acesso à assinatura foi bloqueado por 15 minutos.'
            : `PIN incorreto. Restam ${5 - attempts} tentativa(s).`,
        })
        return
      }
      const delivererSignature = decryptPersonalData(profile.signature_data_ciphertext, 'user-signature')
      if (!decodeSignature(delivererSignature)) {
        throw new SiengeStockRouteError(409, 'A assinatura do perfil está inválida. Atualize-a antes de registrar a entrega.')
      }
      delivererSignatureCiphertext = encryptPersonalData(delivererSignature, 'inventory-delivery-signature')
      recipientSignatureCiphertext = encryptPersonalData(data.recipientSignatureBase64!, 'inventory-delivery-signature')
      await client.query(
        `UPDATE users SET signature_pin_failed_attempts = 0, signature_pin_locked_until = NULL WHERE id = $1`,
        [req.session.user!.id],
      )
    }
    const firstItem = sourceItems.get(data.items[0].snapshotItemId)!

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sienge_stock_movements (
         request_key, operation_type, status, cost_center_id, destination_cost_center_id,
         sienge_item_id, destination_resource_id, resource_id, detail_id, trademark_id,
         quantity, unit_of_measure, transaction_date, collaborator_id, actor_user_id,
         actor_name, request_payload, deliverer_signature_ciphertext,
         recipient_signature_ciphertext, uniform_details
       ) VALUES (
         $1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16::jsonb, $17, $18, $19::jsonb
       )
       ON CONFLICT (request_key) DO NOTHING
       RETURNING id`,
      [
        data.requestKey,
        data.operationType,
        data.costCenterId,
        data.destinationCostCenterId ?? null,
        firstItem.sienge_item_id === null ? null : Number(firstItem.sienge_item_id),
        data.items[0].destinationResourceId ?? null,
        Number(firstItem.resource_id),
        firstItem.detail_id === null ? null : Number(firstItem.detail_id),
        firstItem.trademark_id === null ? null : Number(firstItem.trademark_id),
        data.items[0].quantity,
        firstItem.unit_of_measure,
        data.transactionDate,
        isPersonDelivery ? data.collaboratorId : null,
        req.session.user!.id,
        req.session.user!.displayName,
        JSON.stringify(outboundPayload),
        delivererSignatureCiphertext,
        recipientSignatureCiphertext,
        data.uniformDetails ? JSON.stringify(data.uniformDetails) : null,
      ],
    )
    if (!inserted.rowCount) {
      throw new SiengeStockRouteError(409, 'Esta chave de solicitação já foi usada; confira o histórico antes de iniciar outra operação.')
    }
    movementId = Number(inserted.rows[0].id)
    for (const [index, line] of data.items.entries()) {
      const item = sourceItems.get(line.snapshotItemId)!
      await client.query(
        `INSERT INTO sienge_stock_movement_items (
           movement_id, line_number, snapshot_item_id, sienge_item_id,
           resource_id, resource_description, detail_id, detail_description,
           trademark_id, trademark_description, quantity, unit_of_measure,
           destination_resource_id, destination_detail_id, destination_trademark_id,
           source_building_appropriations, destination_building_appropriations
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
           $16::jsonb, $17::jsonb
         )`,
        [
          movementId,
          index + 1,
          line.snapshotItemId,
          item.sienge_item_id === null ? null : Number(item.sienge_item_id),
          Number(item.resource_id),
          item.resource_description,
          item.detail_id === null ? null : Number(item.detail_id),
          item.detail_description,
          item.trademark_id === null ? null : Number(item.trademark_id),
          item.trademark_description,
          line.quantity,
          item.unit_of_measure,
          line.destinationResourceId ?? null,
          line.destinationDetailId ?? null,
          line.destinationTrademarkId ?? null,
          JSON.stringify(line.sourceBuildingAppropriations),
          line.destinationBuildingAppropriations ? JSON.stringify(line.destinationBuildingAppropriations) : null,
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof SiengeStockRouteError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
    return
  } finally {
    client.release()
  }

  let result: { status: number; body: unknown }
  try {
    const path = isTransfer ? '/stock-movements/transfer' : '/stock-movements'
    result = await siengePost(path, outboundPayload)
  } catch (error) {
    const outcomeUnknown = error instanceof SiengeRequestError && error.outcomeUnknown
    const status = outcomeUnknown ? 'unknown' : 'failed'
    const errorMessage = error instanceof Error ? error.message : 'Falha ao enviar o movimento ao Sienge.'
    await pool.query(
      `UPDATE sienge_stock_movements
       SET status = $1, response_status = $2, error_message = $3, updated_at = now()
       WHERE id = $4`,
      [status, error instanceof SiengeRequestError ? error.externalStatus : null, errorMessage, movementId],
    )
    if (outcomeUnknown) {
      await pool.query(
        `UPDATE sienge_stock_snapshots SET needs_refresh = TRUE
         WHERE cost_center_id = ANY($1::integer[])`,
        [isTransfer ? [data.costCenterId, data.destinationCostCenterId] : [data.costCenterId]],
      )
    }
    if (error instanceof SiengeRequestError) {
      res.status(error.status).json({
        error: outcomeUnknown
          ? `${errorMessage} O Sienge pode ter processado o movimento; não o reenvie antes de conferir o histórico no Sienge.`
          : errorMessage,
      })
      return
    }
    next(error)
    return
  }

  const persistClient = await pool.connect().catch((error: unknown) => {
    next(error)
    return null
  })
  if (!persistClient) return
  try {
    await persistClient.query('BEGIN')
    await persistClient.query(
      `UPDATE sienge_stock_movements
       SET status = 'succeeded', response_status = $1, response_payload = $2::jsonb,
           updated_at = now()
       WHERE id = $3`,
      [result.status, result.body === null ? null : JSON.stringify(result.body), movementId],
    )
    await persistClient.query(
      `UPDATE sienge_stock_snapshots SET needs_refresh = TRUE
       WHERE cost_center_id = ANY($1::integer[])`,
      [isTransfer ? [data.costCenterId, data.destinationCostCenterId] : [data.costCenterId]],
    )
    await persistClient.query('COMMIT')
  } catch (error) {
    await persistClient.query('ROLLBACK')
    console.error('[SiengeStock] Movimento confirmado no Sienge, mas falhou a atualização local:', error)
    res.status(500).json({
      error: 'O Sienge confirmou o movimento, mas o ATech não conseguiu atualizar o registro local. Não reenvie; confira o Sienge e acione um administrador.',
    })
    return
  } finally {
    persistClient.release()
  }

  await recordAuditLog({
    actorUserId: req.session.user!.id,
    actorName: req.session.user!.displayName,
    action: 'sienge_stock_movement',
    resourceType: 'sienge_stock_movement',
    resourceId: movementId!,
    summary: `Movimentação ${data.operationType} enviada ao Sienge.`,
    metadata: {
      requestKey: data.requestKey,
      costCenterId: data.costCenterId,
      destinationCostCenterId: data.destinationCostCenterId ?? null,
      itemCount: data.items.length,
      items: data.items.map((line) => {
        const item = sourceItems.get(line.snapshotItemId)!
        return { resourceId: Number(item.resource_id), quantity: line.quantity }
      }),
    },
  })
  if (isPersonDelivery) {
    await broadcastSyncEvent({
      scope: 'collaborators',
      action: 'delivery',
      entityId: data.collaboratorId,
    })
  }
  res.status(201).json({
    success: true,
    movementId,
    operationType: data.operationType,
    snapshotRefreshRequired: true,
    message: 'Movimento registrado no Sienge. Sincronize os centros envolvidos para atualizar o snapshot local.',
  })
})

export default router
