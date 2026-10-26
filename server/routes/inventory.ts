import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { decryptPersonalData, encryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'

const router = Router()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Informe uma data válida.')
function hasDecimalPlaces(value: number, places: number) {
  const scaled = value * 10 ** places
  return Math.abs(scaled - Math.round(scaled)) < 0.0000001
}

function normalizeBaseQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

const conversionSchema = z.object({
  unitName: z.string().trim().min(1).max(32),
  factorToBase: z.number().positive().max(1_000_000_000).refine((value) => hasDecimalPlaces(value, 6)),
})
const itemSchema = z.object({
  name: z.string().trim().min(2).max(160),
  typeId: z.number().int().positive(),
  baseUnit: z.string().trim().min(1).max(32),
  minimumStock: z.number().min(0).max(1_000_000_000).refine((value) => hasDecimalPlaces(value, 4)),
  conversions: z.array(conversionSchema).max(20),
})
const lineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive().max(1_000_000_000).refine((value) => hasDecimalPlaces(value, 4)),
  unitName: z.string().trim().min(1).max(32),
  sourceDeliveryItemId: z.number().int().positive().optional(),
})
const documentSchema = z.object({
  documentType: z.enum(['entry', 'exit', 'epi_delivery', 'tool_delivery', 'tool_return', 'transfer']),
  transactionDate: dateSchema,
  collaboratorId: z.number().int().positive().nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  sourceLocationId: z.number().int().positive().nullable().optional(),
  destinationLocationId: z.number().int().positive().nullable().optional(),
  delivererPin: z.string().regex(/^\d{6,12}$/).optional(),
  recipientSignatureBase64: z.string().optional(),
  notes: z.string().trim().max(500).default(''),
  items: z.array(lineSchema).min(1).max(100),
}).superRefine((data, context) => {
  const seen = new Set<string>()
  for (const item of data.items) {
    const key = `${item.itemId}:${item.sourceDeliveryItemId ?? ''}`
    if (seen.has(key)) {
      context.addIssue({ code: 'custom', message: 'Remova linhas duplicadas do mesmo insumo.', path: ['items'] })
      break
    }
    seen.add(key)
    if (data.documentType === 'tool_return' && !item.sourceDeliveryItemId) {
      context.addIssue({ code: 'custom', message: 'Selecione a entrega original para cada ferramenta devolvida.', path: ['items'] })
    }
    if (data.documentType !== 'tool_return' && item.sourceDeliveryItemId) {
      context.addIssue({ code: 'custom', message: 'A entrega original só pode ser informada para devoluções.', path: ['items'] })
    }
  }
  const collaboratorDocument = ['epi_delivery', 'tool_delivery', 'tool_return'].includes(data.documentType)
  const transferDocument = data.documentType === 'transfer'
  if (collaboratorDocument && !data.collaboratorId) {
    context.addIssue({ code: 'custom', message: 'Selecione o colaborador responsável pela entrega.', path: ['collaboratorId'] })
  }
  if (!collaboratorDocument && data.collaboratorId) {
    context.addIssue({ code: 'custom', message: 'Movimentações gerais não devem possuir colaborador.', path: ['collaboratorId'] })
  }
  if (collaboratorDocument && (!data.delivererPin || !data.recipientSignatureBase64)) {
    context.addIssue({ code: 'custom', message: 'Informe o PIN do responsável e a assinatura de quem recebe.', path: ['delivererPin'] })
  }
  if (transferDocument && (!data.sourceLocationId || !data.destinationLocationId || data.sourceLocationId === data.destinationLocationId)) {
    context.addIssue({ code: 'custom', message: 'Selecione locais de origem e destino diferentes.', path: ['destinationLocationId'] })
  }
  if (!transferDocument && (!data.locationId || data.sourceLocationId || data.destinationLocationId)) {
    context.addIssue({ code: 'custom', message: 'Selecione o local desta movimentação.', path: ['locationId'] })
  }
})

function decodeSignature(value: string) {
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > 100 * 1024 || bytes.toString('base64') !== value ||
      !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return false
  }
  return true
}

class InventoryRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

router.use(requireAuth, requirePageAccess('collaborators'))

router.get('/', async (_req, res, next) => {
  const client = await pool.connect()
  try {
    const types = await client.query<{ id: string; label: string; is_system: boolean }>(
      'SELECT id, label, is_system FROM inventory_item_types ORDER BY lower(label)',
    )
    const locations = await client.query<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM inventory_locations ORDER BY is_active DESC, lower(name)',
    )
    const items = await client.query<{
        id: string
        name: string
        type_id: string
        type_label: string
        base_unit: string
        minimum_stock: string
        is_active: boolean
        stock_quantity: string
        conversions: { unitName: string; factorToBase: number }[]
    }>(
      `SELECT item.id, item.name, item.type_id, item_type.label AS type_label,
                item.base_unit, item.minimum_stock, item.is_active,
                stock.stock_quantity,
                conversions.units AS conversions
         FROM inventory_items item
         JOIN inventory_item_types item_type ON item_type.id = item.type_id
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(CASE
             WHEN document.document_type IN ('entry', 'tool_return') THEN line.base_quantity
             WHEN document.document_type = 'transfer' THEN 0
             ELSE -line.base_quantity END), 0)::text AS stock_quantity
           FROM inventory_document_items line
           JOIN inventory_documents document ON document.id = line.document_id
           WHERE line.item_id = item.id
         ) stock
         CROSS JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object('unitName', conversion.unit_name,
             'factorToBase', conversion.factor_to_base::float) ORDER BY conversion.id), '[]'::json) AS units
           FROM inventory_item_conversions conversion WHERE conversion.item_id = item.id
         ) conversions
       ORDER BY item.is_active DESC, lower(item.name), item.id`,
    )
    const locationStock = await client.query<{
      item_id: string
      location_id: string
      location_name: string
      quantity: string
    }>(
      `SELECT item.id AS item_id, location.id AS location_id, location.name AS location_name,
            COALESCE(SUM(CASE
              WHEN document.document_type IN ('entry', 'tool_return') AND document.location_id = location.id THEN line.base_quantity
              WHEN document.document_type IN ('exit', 'epi_delivery', 'tool_delivery') AND document.location_id = location.id THEN -line.base_quantity
              WHEN document.document_type = 'transfer' AND document.destination_location_id = location.id THEN line.base_quantity
              WHEN document.document_type = 'transfer' AND document.source_location_id = location.id THEN -line.base_quantity
              ELSE 0 END), 0)::text AS quantity
       FROM inventory_items item
       CROSS JOIN inventory_locations location
       LEFT JOIN inventory_documents document
         ON (document.location_id = location.id
             AND document.document_type IN ('entry', 'exit', 'epi_delivery', 'tool_delivery', 'tool_return'))
         OR (document.document_type = 'transfer'
             AND (document.source_location_id = location.id OR document.destination_location_id = location.id))
       LEFT JOIN inventory_document_items line ON line.document_id = document.id AND line.item_id = item.id
       GROUP BY item.id, location.id
       ORDER BY item.id, location.id`,
    )
    const collaborators = await client.query<{ id: string; name: string; role_label: string; is_active: boolean; is_on_leave: boolean }>(
      `SELECT collaborator.id, collaborator.name, role.label AS role_label,
                (collaborator.termination_date IS NULL OR collaborator.termination_date > CURRENT_DATE) AS is_active,
                collaborator.is_on_leave
         FROM collaborators collaborator
         LEFT JOIN collaborator_roles role ON role.role_key = collaborator.role
       ORDER BY lower(collaborator.name)`,
    )
    const toolAssignments = await client.query<{
        source_delivery_item_id: string
        document_id: string
        transaction_date: string
        location_id: string
        location_name: string
        collaborator_id: string
        collaborator_name: string
        item_id: string
        item_name: string
        base_unit: string
        issued_quantity: string
        returned_quantity: string
        outstanding_quantity: string
    }>(
      `SELECT issued.id AS source_delivery_item_id, document.id AS document_id,
                document.transaction_date::text, document.location_id,
                location.name AS location_name, collaborator.id AS collaborator_id,
                collaborator.name AS collaborator_name, item.id AS item_id,
                item.name AS item_name, item.base_unit,
                issued.base_quantity::text AS issued_quantity,
                COALESCE(SUM(returned.base_quantity) FILTER (WHERE return_document.id IS NOT NULL), 0)::text AS returned_quantity,
                (issued.base_quantity - COALESCE(SUM(returned.base_quantity) FILTER (WHERE return_document.id IS NOT NULL), 0))::text AS outstanding_quantity
         FROM inventory_document_items issued
         JOIN inventory_documents document ON document.id = issued.document_id
         JOIN collaborators collaborator ON collaborator.id = document.collaborator_id
         JOIN inventory_locations location ON location.id = document.location_id
         JOIN inventory_items item ON item.id = issued.item_id
         LEFT JOIN inventory_document_items returned ON returned.source_delivery_item_id = issued.id
         LEFT JOIN inventory_documents return_document
           ON return_document.id = returned.document_id AND return_document.document_type = 'tool_return'
         WHERE document.document_type = 'tool_delivery'
         GROUP BY issued.id, document.id, location.id, collaborator.id, item.id
         HAVING issued.base_quantity - COALESCE(SUM(returned.base_quantity) FILTER (WHERE return_document.id IS NOT NULL), 0) > 0
       ORDER BY document.transaction_date DESC, document.id DESC, item.name`,
    )
    const stockByItem = new Map<number, { locationId: number; locationName: string; quantity: number }[]>()
    for (const balance of locationStock.rows) {
      const itemId = Number(balance.item_id)
      const itemBalances = stockByItem.get(itemId) ?? []
      itemBalances.push({
        locationId: Number(balance.location_id),
        locationName: balance.location_name,
        quantity: Number(balance.quantity),
      })
      stockByItem.set(itemId, itemBalances)
    }
    res.json({
      types: types.rows.map((type) => ({ id: Number(type.id), label: type.label, isSystem: type.is_system })),
      locations: locations.rows.map((location) => ({
        id: Number(location.id),
        name: location.name,
        isActive: location.is_active,
      })),
      items: items.rows.map((item) => ({
        id: Number(item.id),
        name: item.name,
        typeId: Number(item.type_id),
        typeLabel: item.type_label,
        baseUnit: item.base_unit,
        minimumStock: Number(item.minimum_stock),
        isActive: item.is_active,
        stockQuantity: Number(item.stock_quantity),
        locationStock: stockByItem.get(Number(item.id)) ?? [],
        conversions: item.conversions,
      })),
      collaborators: collaborators.rows.map((person) => ({
        id: Number(person.id),
        name: person.name,
        roleLabel: person.role_label ?? '',
        isActive: person.is_active,
        isOnLeave: person.is_on_leave,
      })),
      toolAssignments: toolAssignments.rows.map((assignment) => ({
        sourceDeliveryItemId: Number(assignment.source_delivery_item_id),
        documentId: Number(assignment.document_id),
        transactionDate: assignment.transaction_date,
        locationId: Number(assignment.location_id),
        locationName: assignment.location_name,
        collaboratorId: Number(assignment.collaborator_id),
        collaboratorName: assignment.collaborator_name,
        itemId: Number(assignment.item_id),
        itemName: assignment.item_name,
        baseUnit: assignment.base_unit,
        issuedQuantity: Number(assignment.issued_quantity),
        returnedQuantity: Number(assignment.returned_quantity),
        outstandingQuantity: Number(assignment.outstanding_quantity),
      })),
    })
  } catch (error) {
    next(error)
  } finally {
    client.release()
  }
})

router.post('/locations', async (req, res, next) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe o nome do local, com pelo menos 2 caracteres.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; name: string; is_active: boolean }>(
      `INSERT INTO inventory_locations (name, created_by)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name, is_active`,
      [parsed.data.name, req.session.user!.id],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'Já existe um local de estoque com esse nome.' })
      return
    }
    res.status(201).json({
      location: { id: Number(result.rows[0].id), name: result.rows[0].name, isActive: result.rows[0].is_active },
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/locations/:id', async (req, res, next) => {
  const locationId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    isActive: z.boolean(),
  }).safeParse(req.body)
  if (!locationId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados do local inválidos.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ is_active: boolean; has_stock: boolean }>(
      `SELECT location.is_active,
              EXISTS (
                SELECT 1 FROM inventory_document_items line
                JOIN inventory_documents document ON document.id = line.document_id
                WHERE (
                  (document.document_type IN ('entry', 'tool_return') AND document.location_id = location.id)
                  OR (document.document_type IN ('exit', 'epi_delivery', 'tool_delivery') AND document.location_id = location.id)
                  OR (document.document_type = 'transfer' AND (document.source_location_id = location.id OR document.destination_location_id = location.id))
                )
                GROUP BY line.item_id
                HAVING SUM(CASE
                  WHEN document.document_type IN ('entry', 'tool_return') AND document.location_id = location.id THEN line.base_quantity
                  WHEN document.document_type IN ('exit', 'epi_delivery', 'tool_delivery') AND document.location_id = location.id THEN -line.base_quantity
                  WHEN document.document_type = 'transfer' AND document.destination_location_id = location.id THEN line.base_quantity
                  WHEN document.document_type = 'transfer' AND document.source_location_id = location.id THEN -line.base_quantity
                  ELSE 0 END) <> 0
              ) AS has_stock
       FROM inventory_locations location WHERE location.id = $1 FOR UPDATE`,
      [locationId.data],
    )
    if (!current.rowCount) throw new InventoryRequestError(404, 'Local de estoque não encontrado.')
    if (!parsed.data.isActive && current.rows[0].has_stock) {
      throw new InventoryRequestError(409, 'Transfira ou consuma todo o estoque deste local antes de inativá-lo.')
    }
    await client.query(
      `UPDATE inventory_locations SET name = $1, is_active = $2 WHERE id = $3`,
      [parsed.data.name, parsed.data.isActive, locationId.data],
    )
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof InventoryRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe um local de estoque com esse nome.' })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.post('/types', async (req, res, next) => {
  const parsed = z.object({ label: z.string().trim().min(2).max(60) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um tipo com nome entre 2 e 60 caracteres.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; label: string; is_system: boolean }>(
      `INSERT INTO inventory_item_types (label)
       VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, label, is_system`,
      [parsed.data.label],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'Já existe um tipo de insumo com esse nome.' })
      return
    }
    res.status(201).json({ type: { id: Number(result.rows[0].id), label: result.rows[0].label, isSystem: result.rows[0].is_system } })
  } catch (error) {
    next(error)
  }
})

router.post('/items', async (req, res, next) => {
  const parsed = itemSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do insumo inválidos.' })
    return
  }
  const baseUnit = parsed.data.baseUnit.trim()
  const unitNames = [baseUnit, ...parsed.data.conversions.map((conversion) => conversion.unitName.trim())]
  if (new Set(unitNames.map((name) => name.toLocaleLowerCase('pt-BR'))).size !== unitNames.length) {
    res.status(400).json({ error: 'Cada unidade de conversão precisa ter um nome único e diferente da unidade-base.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const type = await client.query('SELECT 1 FROM inventory_item_types WHERE id = $1', [parsed.data.typeId])
    if (!type.rowCount) throw new InventoryRequestError(400, 'O tipo de insumo selecionado não existe.')
    const created = await client.query<{ id: string }>(
      `INSERT INTO inventory_items (name, type_id, base_unit, minimum_stock, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parsed.data.name, parsed.data.typeId, baseUnit, parsed.data.minimumStock, req.session.user!.id],
    )
    for (const conversion of parsed.data.conversions) {
      await client.query(
        `INSERT INTO inventory_item_conversions (item_id, unit_name, factor_to_base)
         VALUES ($1, $2, $3)`,
        [created.rows[0].id, conversion.unitName.trim(), conversion.factorToBase],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ id: Number(created.rows[0].id) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof InventoryRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe um insumo ativo com esse nome nesse tipo.' })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.patch('/items/:id', async (req, res, next) => {
  const itemId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = itemSchema.extend({ isActive: z.boolean() }).safeParse(req.body)
  if (!itemId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados do insumo inválidos.' })
    return
  }
  const baseUnit = parsed.data.baseUnit.trim()
  const unitNames = [baseUnit, ...parsed.data.conversions.map((conversion) => conversion.unitName.trim())]
  if (new Set(unitNames.map((name) => name.toLocaleLowerCase('pt-BR'))).size !== unitNames.length) {
    res.status(400).json({ error: 'Cada unidade de conversão precisa ter um nome único e diferente da unidade-base.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ base_unit: string; type_id: string; has_movements: boolean; has_open_tool_assignments: boolean }>(
      `SELECT item.base_unit, item.type_id, EXISTS (
         SELECT 1 FROM inventory_document_items WHERE item_id = item.id
       ) AS has_movements, EXISTS (
         SELECT 1
         FROM inventory_document_items issued
         JOIN inventory_documents delivery ON delivery.id = issued.document_id
         WHERE issued.item_id = item.id AND delivery.document_type = 'tool_delivery'
           AND issued.base_quantity > COALESCE((
             SELECT SUM(returned.base_quantity)
             FROM inventory_document_items returned
             JOIN inventory_documents return_document ON return_document.id = returned.document_id
             WHERE returned.source_delivery_item_id = issued.id
               AND return_document.document_type = 'tool_return'
           ), 0)
       ) AS has_open_tool_assignments
       FROM inventory_items item WHERE item.id = $1 FOR UPDATE`,
      [itemId.data],
    )
    if (!current.rowCount) throw new InventoryRequestError(404, 'Insumo não encontrado.')
    if (current.rows[0].has_movements && current.rows[0].base_unit.toLocaleLowerCase('pt-BR') !== baseUnit.toLocaleLowerCase('pt-BR')) {
      throw new InventoryRequestError(409, 'A unidade-base não pode ser alterada depois que houver movimentações no histórico.')
    }
    const type = await client.query<{ label: string }>('SELECT label FROM inventory_item_types WHERE id = $1', [parsed.data.typeId])
    if (!type.rowCount) throw new InventoryRequestError(400, 'O tipo de insumo selecionado não existe.')
    if (current.rows[0].has_movements && Number(current.rows[0].type_id) !== parsed.data.typeId) {
      throw new InventoryRequestError(409, 'O tipo do insumo não pode ser alterado depois da primeira movimentação.')
    }
    if (current.rows[0].has_open_tool_assignments &&
        (!parsed.data.isActive || type.rows[0].label.toLocaleLowerCase('pt-BR') !== 'ferramenta')) {
      throw new InventoryRequestError(409, 'Não é possível inativar ou reclassificar uma ferramenta que ainda não foi devolvida.')
    }
    await client.query(
      `UPDATE inventory_items SET name = $1, type_id = $2, base_unit = $3,
       minimum_stock = $4, is_active = $5, updated_at = now() WHERE id = $6`,
      [parsed.data.name, parsed.data.typeId, baseUnit, parsed.data.minimumStock, parsed.data.isActive, itemId.data],
    )
    await client.query('DELETE FROM inventory_item_conversions WHERE item_id = $1', [itemId.data])
    for (const conversion of parsed.data.conversions) {
      await client.query(
        `INSERT INTO inventory_item_conversions (item_id, unit_name, factor_to_base)
         VALUES ($1, $2, $3)`,
        [itemId.data, conversion.unitName.trim(), conversion.factorToBase],
      )
    }
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof InventoryRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe um insumo ativo com esse nome nesse tipo.' })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.post('/documents', async (req, res, next) => {
  const parsed = documentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da movimentação inválidos.' })
    return
  }
  const data = parsed.data
  const isCollaboratorDocument = ['epi_delivery', 'tool_delivery', 'tool_return'].includes(data.documentType)
  if (isCollaboratorDocument && !isPersonalDataEncryptionConfigured()) {
    res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY antes de salvar assinaturas de entrega.' })
    return
  }
  if (isCollaboratorDocument && !decodeSignature(data.recipientSignatureBase64!)) {
    res.status(400).json({ error: 'A assinatura de quem recebe deve ser uma imagem PNG válida de até 100 KiB.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const itemIds = data.items.map((item) => item.itemId)
    const itemsResult = await client.query<{
      id: string
      name: string
      type_label: string
      base_unit: string
      is_active: boolean
    }>(
      `SELECT item.id, item.name, item_type.label AS type_label, item.base_unit, item.is_active
       FROM inventory_items item
       JOIN inventory_item_types item_type ON item_type.id = item.type_id
       WHERE item.id = ANY($1::bigint[])
       ORDER BY item.id FOR UPDATE`,
      [itemIds],
    )
    const itemsById = new Map(itemsResult.rows.map((item) => [Number(item.id), item]))
    if (itemsById.size !== new Set(itemIds).size) throw new InventoryRequestError(400, 'Um ou mais insumos não foram encontrados.')
    if (itemsResult.rows.some((item) => !item.is_active)) throw new InventoryRequestError(409, 'Insumos inativos não podem receber movimentações.')
    const locationIds = data.documentType === 'transfer'
      ? [data.sourceLocationId!, data.destinationLocationId!]
      : [data.locationId!]
    const locationResult = await client.query<{ id: string; name: string; is_active: boolean }>(
      `SELECT id, name, is_active FROM inventory_locations
       WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
      [locationIds],
    )
    const locationsById = new Map(locationResult.rows.map((location) => [Number(location.id), location]))
    if (locationsById.size !== new Set(locationIds).size) throw new InventoryRequestError(400, 'Um ou mais locais não foram encontrados.')
    if (locationResult.rows.some((location) => !location.is_active)) throw new InventoryRequestError(409, 'Locais inativos não podem receber movimentações.')
    const balances = await client.query<{ item_id: string; stock_quantity: string }>(
      `SELECT item.id AS item_id,
              COALESCE(SUM(CASE WHEN document.document_type IN ('entry', 'tool_return')
                AND document.location_id = $2 THEN line.base_quantity
                WHEN document.document_type IN ('exit', 'epi_delivery', 'tool_delivery')
                AND document.location_id = $2 THEN -line.base_quantity
                WHEN document.document_type = 'transfer' AND document.destination_location_id = $2 THEN line.base_quantity
                WHEN document.document_type = 'transfer' AND document.source_location_id = $2 THEN -line.base_quantity
                ELSE 0 END), 0)::text AS stock_quantity
       FROM inventory_items item
       LEFT JOIN inventory_document_items line ON line.item_id = item.id
       LEFT JOIN inventory_documents document ON document.id = line.document_id
       WHERE item.id = ANY($1::bigint[])
       GROUP BY item.id`,
      [itemIds, data.documentType === 'transfer' ? data.sourceLocationId : data.locationId],
    )
    const stockByItem = new Map(balances.rows.map((row) => [Number(row.item_id), Number(row.stock_quantity)]))

    const validatedLines: { itemId: number; quantity: number; unitName: string; factor: number; baseQuantity: number; sourceDeliveryItemId: number | null }[] = []
    for (const line of data.items) {
      const item = itemsById.get(line.itemId)!
      let factor = 1
      if (line.unitName.toLocaleLowerCase('pt-BR') !== item.base_unit.toLocaleLowerCase('pt-BR')) {
        const conversion = await client.query<{ factor_to_base: string }>(
          `SELECT factor_to_base::text FROM inventory_item_conversions
           WHERE item_id = $1 AND lower(btrim(unit_name)) = lower(btrim($2))`,
          [line.itemId, line.unitName],
        )
        if (!conversion.rowCount) throw new InventoryRequestError(400, `A unidade "${line.unitName}" não está cadastrada para ${item.name}.`)
        factor = Number(conversion.rows[0].factor_to_base)
      }
      const baseQuantity = normalizeBaseQuantity(line.quantity * factor)
      if (!Number.isFinite(baseQuantity) || baseQuantity <= 0 || baseQuantity > 1_000_000_000_000) {
        throw new InventoryRequestError(400, `A quantidade informada para ${item.name} é inválida.`)
      }
      const expectedType = data.documentType === 'epi_delivery' ? 'EPI'
        : data.documentType === 'tool_delivery' || data.documentType === 'tool_return' ? 'Ferramenta' : null
      if (data.documentType === 'exit' &&
          ['epi', 'ferramenta'].includes(item.type_label.toLocaleLowerCase('pt-BR'))) {
        throw new InventoryRequestError(400, `${item.type_label} deve ser movimentado pela tela de entrega vinculada ao colaborador.`)
      }
      if (expectedType && item.type_label.toLocaleLowerCase('pt-BR') !== expectedType.toLocaleLowerCase('pt-BR')) {
        throw new InventoryRequestError(400, `${item.name} não está cadastrado como ${expectedType}.`)
      }
      if (data.documentType === 'tool_return' && !line.sourceDeliveryItemId) {
        throw new InventoryRequestError(400, 'Selecione a entrega original de cada ferramenta devolvida.')
      }
      if (data.documentType !== 'tool_return' && line.sourceDeliveryItemId) {
        throw new InventoryRequestError(400, 'A entrega original só pode ser informada para devoluções.')
      }
      validatedLines.push({
        itemId: line.itemId,
        quantity: line.quantity,
        unitName: line.unitName,
        factor,
        baseQuantity,
        sourceDeliveryItemId: line.sourceDeliveryItemId ?? null,
      })
    }

    let delivererSignatureBase64: string | null = null
    if (isCollaboratorDocument) {
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
        throw new InventoryRequestError(409, 'Cadastre uma assinatura e um PIN no perfil antes de registrar a entrega.')
      }
      if (profile.signature_pin_locked_until && profile.signature_pin_locked_until > new Date()) {
        throw new InventoryRequestError(429, 'PIN temporariamente bloqueado após várias tentativas. Aguarde 15 minutos.')
      }
      if (!await bcrypt.compare(data.delivererPin!, profile.signature_pin_hash)) {
        const attempts = profile.signature_pin_locked_until && profile.signature_pin_locked_until <= new Date()
          ? 1
          : profile.signature_pin_failed_attempts + 1
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
        await client.query(
          `UPDATE users SET signature_pin_failed_attempts = $1, signature_pin_locked_until = $2
           WHERE id = $3`,
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
      delivererSignatureBase64 = decryptPersonalData(profile.signature_data_ciphertext!, 'user-signature')
      if (!decodeSignature(delivererSignatureBase64)) {
        throw new InventoryRequestError(409, 'A assinatura do perfil está inválida. Atualize-a antes de registrar a entrega.')
      }
      await client.query(
        `UPDATE users SET signature_pin_failed_attempts = 0, signature_pin_locked_until = NULL
         WHERE id = $1`,
        [req.session.user!.id],
      )
    }

    if (isCollaboratorDocument) {
      const collaborator = await client.query<{ is_active: boolean; is_on_leave: boolean }>(
        `SELECT (termination_date IS NULL OR termination_date > CURRENT_DATE) AS is_active,
                is_on_leave
         FROM collaborators WHERE id = $1 FOR UPDATE`,
        [data.collaboratorId],
      )
      if (!collaborator.rowCount) throw new InventoryRequestError(404, 'Colaborador não encontrado.')
      if (data.documentType !== 'tool_return' && (!collaborator.rows[0].is_active || collaborator.rows[0].is_on_leave)) {
        throw new InventoryRequestError(409, 'Só é possível registrar entregas para colaboradores ativos e sem afastamento.')
      }
    }

    if (data.documentType === 'exit' || data.documentType === 'epi_delivery' || data.documentType === 'tool_delivery' || data.documentType === 'transfer') {
      const outgoingByItem = new Map<number, number>()
      for (const line of validatedLines) {
        outgoingByItem.set(line.itemId, (outgoingByItem.get(line.itemId) ?? 0) + line.baseQuantity)
      }
      for (const [itemId, requested] of outgoingByItem) {
        const current = stockByItem.get(itemId) ?? 0
        if (requested > current) {
          const item = itemsById.get(itemId)!
          throw new InventoryRequestError(409, `Estoque insuficiente de ${item.name}. Disponível: ${current} ${item.base_unit}.`)
        }
      }
    }

    for (const line of validatedLines) {
      if (data.documentType === 'tool_return') {
        const source = await client.query<{
          document_type: string
          collaborator_id: string
          location_id: string
          item_id: string
          base_quantity: string
          returned_quantity: string
        }>(
          `SELECT original.document_type, original_document.collaborator_id,
                  original_document.location_id,
                  original.item_id, original.base_quantity::text,
                  COALESCE(SUM(returned.base_quantity) FILTER (WHERE return_document.id IS NOT NULL), 0)::text AS returned_quantity
           FROM inventory_document_items original
           JOIN inventory_documents original_document ON original_document.id = original.document_id
           LEFT JOIN inventory_document_items returned ON returned.source_delivery_item_id = original.id
           LEFT JOIN inventory_documents return_document
             ON return_document.id = returned.document_id AND return_document.document_type = 'tool_return'
           WHERE original.id = $1
           GROUP BY original.id, original_document.document_type, original_document.collaborator_id`,
          [line.sourceDeliveryItemId],
        )
        const sourceLine = source.rows[0]
        if (!sourceLine || sourceLine.document_type !== 'tool_delivery' ||
            Number(sourceLine.collaborator_id) !== data.collaboratorId ||
            Number(sourceLine.item_id) !== line.itemId ||
            Number(sourceLine.location_id) !== data.locationId) {
          throw new InventoryRequestError(400, 'A entrega de origem selecionada não corresponde ao colaborador e à ferramenta.')
        }
        const remaining = normalizeBaseQuantity(Number(sourceLine.base_quantity) - Number(sourceLine.returned_quantity))
        if (line.baseQuantity > remaining) {
          throw new InventoryRequestError(409, `A devolução excede a quantidade ainda pendente (${remaining} ${itemsById.get(line.itemId)!.base_unit}).`)
        }
      }
    }

    const signatureDeliverer = isCollaboratorDocument
      ? encryptPersonalData(delivererSignatureBase64!, 'inventory-delivery-signature')
      : null
    const signatureRecipient = isCollaboratorDocument
      ? encryptPersonalData(data.recipientSignatureBase64!, 'inventory-delivery-signature')
      : null
    const document = await client.query<{ id: string }>(
      `INSERT INTO inventory_documents (
         document_type, collaborator_id, transaction_date, created_by,
         deliverer_signature_ciphertext, recipient_signature_ciphertext, notes,
         location_id, source_location_id, destination_location_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        data.documentType,
        data.collaboratorId ?? null,
        data.transactionDate,
        req.session.user!.id,
        signatureDeliverer,
        signatureRecipient,
        data.notes,
        data.documentType === 'transfer' ? null : data.locationId,
        data.documentType === 'transfer' ? data.sourceLocationId : null,
        data.documentType === 'transfer' ? data.destinationLocationId : null,
      ],
    )
    for (const line of validatedLines) {
      await client.query(
        `INSERT INTO inventory_document_items (
           document_id, item_id, quantity, unit_name, factor_to_base,
           base_quantity, source_delivery_item_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          document.rows[0].id,
          line.itemId,
          line.quantity,
          line.unitName,
          line.factor,
          line.baseQuantity,
          line.sourceDeliveryItemId,
        ],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ id: Number(document.rows[0].id) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof InventoryRequestError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

export default router
