import { z } from 'zod'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { siengeGet, SiengeRequestError } from './sienge.js'

const siengeIdSchema = z.number().int().positive().max(2147483647)

function nestedDescription(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>).description
}

const stockItemSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const item = value as Record<string, unknown>
  return {
    ...item,
    resourceDescription: item.resourceDescription ?? item.resourceName ?? item.description ?? nestedDescription(item.resource),
    detailDescription: item.detailDescription ?? nestedDescription(item.detail),
    trademarkDescription: item.trademarkDescription ?? nestedDescription(item.trademark),
  }
}, z.object({
  itemId: siengeIdSchema.nullable().optional().transform((value) => value ?? null),
  resourceId: siengeIdSchema,
  resourceDescription: z.string().nullable().optional().transform((value) => value ?? ''),
  detailId: siengeIdSchema.nullable().optional().transform((value) => value ?? null),
  detailDescription: z.string().nullable().optional().transform((value) => value ?? null),
  trademarkId: siengeIdSchema.nullable().optional().transform((value) => value ?? null),
  trademarkDescription: z.string().nullable().optional().transform((value) => value ?? null),
  quantity: z.number().finite(),
  unitOfMeasure: z.string().trim().min(1).max(32),
  averagePrice: z.number().finite().nullable().optional().transform((value) => value ?? null),
}))

const stockPageSchema = z.object({
  resultSetMetadata: z.object({
    count: z.number().int().nonnegative().refine(Number.isSafeInteger),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(200),
  }),
  results: z.array(stockItemSchema),
})

const stockAppropriationPageSchema = z.object({
  resultSetMetadata: z.object({
    count: z.number().int().nonnegative().refine(Number.isSafeInteger),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(200),
  }),
  results: z.array(z.object({
    buildingUnitId: siengeIdSchema,
    sheetItemId: siengeIdSchema,
    costEstimationItemReference: z.string().nullable().optional().transform((value) => value ?? null),
    quantity: z.number().finite(),
  })),
})

export type SiengeStockItem = z.infer<typeof stockItemSchema>
export type SiengeStockAppropriation = z.infer<typeof stockAppropriationPageSchema>['results'][number]

export async function fetchSiengeStockAppropriations(
  costCenterId: number,
  resourceId: number,
  detailId: number | null,
  trademarkId: number | null,
): Promise<SiengeStockAppropriation[]> {
  const appropriations: SiengeStockAppropriation[] = []
  let offset = 0
  let expectedCount: number | null = null
  let pageCount = 0

  while (expectedCount === null || offset < expectedCount) {
    pageCount += 1
    if (pageCount > 1000) {
      throw new SiengeRequestError('A paginação das apropriações do Sienge excedeu o limite de segurança de 1.000 páginas.', 502)
    }

    const query = new URLSearchParams({ offset: String(offset), limit: '200' })
    if (detailId !== null) query.set('detailId', String(detailId))
    if (trademarkId !== null) query.set('trademarkId', String(trademarkId))

    const response = await siengeGet(
      `/stock-inventories/${costCenterId}/items/${resourceId}/building-appropriation?${query.toString()}`,
    )
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new SiengeRequestError('O Sienge respondeu com JSON inválido ao consultar as apropriações do estoque.', 502)
    }
    const parsed = stockAppropriationPageSchema.safeParse(payload)
    if (!parsed.success) {
      const details = parsed.error.issues.slice(0, 5)
        .map((issue) => `${issue.path.map(String).join('.') || 'resposta'}: ${issue.message}`)
        .join('; ')
      throw new SiengeRequestError(
        `O Sienge respondeu em formato inesperado para as apropriações do estoque. ${details}`,
        502,
      )
    }

    const page = parsed.data
    if (page.resultSetMetadata.offset !== offset ||
        page.results.length > page.resultSetMetadata.limit ||
        (expectedCount !== null && page.resultSetMetadata.count !== expectedCount)) {
      throw new SiengeRequestError('A paginação das apropriações do Sienge mudou durante a consulta.', 502)
    }
    expectedCount = page.resultSetMetadata.count
    if (!page.results.length && offset < expectedCount) {
      throw new SiengeRequestError('A paginação das apropriações do Sienge terminou antes de retornar todos os itens.', 502)
    }
    appropriations.push(...page.results)
    offset += page.results.length
  }

  if (appropriations.length !== expectedCount) {
    throw new SiengeRequestError('A quantidade de apropriações recebida não corresponde ao total informado pelo Sienge.', 502)
  }
  return appropriations
}

async function fetchCompleteCenterStock(costCenterId: number): Promise<SiengeStockItem[]> {
  const items: SiengeStockItem[] = []
  const itemKeys = new Set<string>()
  let offset = 0
  let expectedCount: number | null = null
  let pageCount = 0

  while (expectedCount === null || offset < expectedCount) {
    pageCount += 1
    if (pageCount > 1000) {
      throw new SiengeRequestError('A paginação do Sienge excedeu o limite de segurança de 1.000 páginas.', 502)
    }

    const response = await siengeGet(
      `/stock-inventories/${costCenterId}/items?offset=${offset}&limit=200`,
    )
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new SiengeRequestError('O Sienge respondeu com JSON inválido ao consultar o estoque.', 502)
    }
    const parsed = stockPageSchema.safeParse(payload)
    if (!parsed.success) {
      const details = parsed.error.issues.slice(0, 5)
        .map((issue) => `${issue.path.map(String).join('.') || 'resposta'}: ${issue.message}`)
        .join('; ')
      throw new SiengeRequestError(
        `O Sienge respondeu em formato inesperado para a consulta de estoque. ${details}`,
        502,
      )
    }

    const page = parsed.data
    if (page.resultSetMetadata.offset !== offset ||
        page.results.length > page.resultSetMetadata.limit ||
        (expectedCount !== null && page.resultSetMetadata.count !== expectedCount)) {
      throw new SiengeRequestError('A paginação do Sienge mudou durante a sincronização; o snapshot anterior foi preservado.', 502)
    }
    expectedCount = page.resultSetMetadata.count
    if (!page.results.length && offset < expectedCount) {
      throw new SiengeRequestError('A paginação do Sienge terminou antes de retornar todos os itens; o snapshot anterior foi preservado.', 502)
    }
    for (const item of page.results) {
      const itemKey = JSON.stringify([item.resourceId, item.detailId, item.trademarkId])
      if (itemKeys.has(itemKey)) {
        throw new SiengeRequestError('O Sienge retornou combinações de insumo, detalhe e marca duplicadas; o snapshot anterior foi preservado.', 502)
      }
      itemKeys.add(itemKey)
      items.push(item)
    }
    offset += page.results.length
  }

  if (items.length !== expectedCount) {
    throw new SiengeRequestError('A quantidade recebida não corresponde ao total informado pelo Sienge; o snapshot anterior foi preservado.', 502)
  }
  return items
}

async function replaceCenterSnapshot(
  client: PoolClient,
  costCenterId: number,
  userId: number,
  items: SiengeStockItem[],
) {
  const synchronizedAt = new Date()
  await client.query('DELETE FROM sienge_stock_items WHERE cost_center_id = $1', [costCenterId])
  if (items.length) {
    const rows = items.map((item) => ({
      item_id: item.itemId,
      resource_id: item.resourceId,
      resource_description: item.resourceDescription,
      detail_id: item.detailId,
      detail_description: item.detailDescription,
      trademark_id: item.trademarkId,
      trademark_description: item.trademarkDescription,
      quantity: item.quantity,
      unit_of_measure: item.unitOfMeasure,
      average_price: item.averagePrice,
    }))
    await client.query(
      `INSERT INTO sienge_stock_items (
         cost_center_id, sienge_item_id, resource_id, resource_description,
         detail_id, detail_description, trademark_id, trademark_description,
         quantity, unit_of_measure, average_price, synchronized_at
       )
       SELECT $1, item.item_id, item.resource_id, item.resource_description,
              item.detail_id, item.detail_description, item.trademark_id,
              item.trademark_description, item.quantity, item.unit_of_measure,
              item.average_price, $3
       FROM jsonb_to_recordset($2::jsonb) AS item(
          item_id integer, resource_id integer, resource_description text,
         detail_id integer, detail_description text, trademark_id integer,
         trademark_description text, quantity numeric, unit_of_measure text,
         average_price numeric
       )`,
      [costCenterId, JSON.stringify(rows), synchronizedAt],
    )
  }
  await client.query(
    `INSERT INTO sienge_stock_snapshots (cost_center_id, item_count, synchronized_at, synchronized_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cost_center_id)
     DO UPDATE SET item_count = EXCLUDED.item_count,
                   synchronized_at = EXCLUDED.synchronized_at,
                   synchronized_by = EXCLUDED.synchronized_by,
                   needs_refresh = FALSE`,
    [costCenterId, items.length, synchronizedAt, userId],
  )
}

export interface SiengeStockSyncResult {
  costCenterId: number
  itemCount: number | null
  synchronizedAt: string | null
  error: string | null
}

export async function syncSiengeStockCenters(costCenterIds: number[], userId: number) {
  const results: SiengeStockSyncResult[] = []
  let stoppedEarly = false

  for (const costCenterId of costCenterIds) {
    const client = await pool.connect()
    let transactionStarted = false
    try {
      await client.query('SELECT pg_advisory_lock(88001, $1)', [costCenterId])
      const items = await fetchCompleteCenterStock(costCenterId)
      await client.query('BEGIN')
      transactionStarted = true
      await replaceCenterSnapshot(client, costCenterId, userId, items)
      await client.query('COMMIT')
      transactionStarted = false
      results.push({
        costCenterId,
        itemCount: items.length,
        synchronizedAt: new Date().toISOString(),
        error: null,
      })
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK')
      results.push({
        costCenterId,
        itemCount: null,
        synchronizedAt: null,
        error: error instanceof Error ? error.message : 'Falha inesperada ao sincronizar o centro de custo.',
      })
      stoppedEarly = true
      break
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(88001, $1)', [costCenterId])
      } finally {
        client.release()
      }
    }
  }

  return {
    results,
    notAttemptedCenterIds: stoppedEarly ? costCenterIds.slice(results.length) : [],
  }
}
