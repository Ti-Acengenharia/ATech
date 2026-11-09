import { pool } from '../db.js'
import { env } from '../config.js'
import { broadcastSyncEvent } from './sync-events.js'

export interface CvcrmRawUnit {
  idunidade: number
  nome: string
  idbloco?: number
  andar?: number | string | null
  area_privativa?: string | null
  area_total?: string | null
  tipologia?: string | null
  posicao?: string | null
  valor?: string | null
  valor_avaliacao?: string | null
  situacao?: {
    vendida?: number | string | null
    vendida_idsituacao?: number | string | null
    situacao_mapa_disponibilidade?: number | string | null
    situacao_para_venda?: number | string | null
    nome_situacao_mapa_disponibilidade?: string | null
    bloqueada_motivo?: string | null
  }
}

export interface CvcrmRawBloco {
  idbloco: number
  nome: string
  unidades?: CvcrmRawUnit[]
}

export interface CvcrmRawEtapa {
  idetapa: number
  nome: string
  blocos?: CvcrmRawBloco[]
}

export interface CvcrmEnterpriseDetail {
  idempreendimento: number
  nome: string
  etapas?: CvcrmRawEtapa[]
}

export interface CvcrmEnterpriseListItem {
  idempreendimento: number
  nome: string
  data_entrega?: string | null
  situacao_obra?: Array<{ nome: string; idsituacao_obra: number }> | null
  situacao_comercial?: any
  isDelivered?: boolean
  statusObra?: string | null
}

export function isEnterpriseDelivered(item: {
  data_entrega?: string | null
  situacao_obra?: Array<{ nome: string; idsituacao_obra: number }> | null
}): boolean {
  if (Array.isArray(item.situacao_obra)) {
    const isFinished = item.situacao_obra.some(
      (s) => Number(s.idsituacao_obra) === 2 || /finalizada|concluída|entregue/i.test(String(s.nome))
    )
    if (isFinished) return true
  }
  if (item.data_entrega) {
    const parts = item.data_entrega.trim().split('/')
    if (parts.length === 3) {
      const day = Number(parts[0])
      const month = Number(parts[1]) - 1
      const year = Number(parts[2])
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime()) && d.getTime() <= Date.now()) {
        return true
      }
    }
  }
  return false
}

function cvcrmConfigured(): boolean {
  return Boolean(env.CVCRM_SUBDOMAIN && env.CVCRM_API_EMAIL && env.CVCRM_API_TOKEN)
}

function cvcrmBaseUrl(): string {
  if (!cvcrmConfigured()) {
    throw new Error('CVCRM não configurado. Defina CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }
  return `https://${env.CVCRM_SUBDOMAIN}.cvcrm.com.br/api`
}

function cvcrmHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    email: env.CVCRM_API_EMAIL!,
    token: env.CVCRM_API_TOKEN!,
  }
}

export async function fetchCvcrmEnterprises(): Promise<CvcrmEnterpriseListItem[]> {
  const url = `${cvcrmBaseUrl()}/v1/cadastros/empreendimentos`
  const response = await fetch(url, {
    headers: cvcrmHeaders(),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Falha ao consultar empreendimentos no CV CRM (HTTP ${response.status}): ${errorText.slice(0, 200)}`)
  }
  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) return []
  return data.map((item: any) => {
    const isDelivered = isEnterpriseDelivered(item)
    const statusObra = Array.isArray(item.situacao_obra) && item.situacao_obra[0]?.nome
      ? String(item.situacao_obra[0].nome).trim()
      : null
    return {
      idempreendimento: Number(item.idempreendimento),
      nome: String(item.nome || '').trim(),
      data_entrega: item.data_entrega ? String(item.data_entrega).trim() : null,
      situacao_obra: Array.isArray(item.situacao_obra) ? item.situacao_obra : null,
      situacao_comercial: item.situacao_comercial,
      isDelivered,
      statusObra,
    }
  })
}

export async function fetchCvcrmEnterpriseWithUnits(enterpriseId: number): Promise<CvcrmEnterpriseDetail | null> {
  const url = `${cvcrmBaseUrl()}/v1/cadastros/empreendimentos/${enterpriseId}?limite_dados_unidade=500`
  const response = await fetch(url, {
    headers: cvcrmHeaders(),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    if (response.status === 404 || response.status === 400) return null
    const errorText = await response.text()
    throw new Error(`Falha ao consultar unidades do empreendimento ${enterpriseId} no CV CRM: ${errorText.slice(0, 200)}`)
  }
  return (await response.json()) as CvcrmEnterpriseDetail
}

export async function fetchCvcrmUnitDirect(enterpriseId: number, unitId: number): Promise<any | null> {
  const url = `${cvcrmBaseUrl()}/v1/cadastros/empreendimentos/${enterpriseId}/unidades/${unitId}`
  const response = await fetch(url, {
    headers: cvcrmHeaders(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return null
  const data: any = await response.json()
  return data?.dados?.[0] ?? null
}

export function isUnitInStock(unit: CvcrmRawUnit): boolean {
  const sit = unit.situacao
  if (!sit) return true
  const sitId = Number(sit.vendida_idsituacao ?? sit.situacao_mapa_disponibilidade)
  // Situação 3 = Vendida
  if (sitId === 3 || String(sit.vendida) === '3') return false
  return true
}

export function getStatusLabel(unit: CvcrmRawUnit): string {
  const sit = unit.situacao
  if (sit?.nome_situacao_mapa_disponibilidade) {
    return sit.nome_situacao_mapa_disponibilidade
  }
  const sitId = Number(sit?.vendida_idsituacao ?? sit?.situacao_mapa_disponibilidade)
  switch (sitId) {
    case 1:
      return 'Disponível'
    case 2:
      return 'Reservada'
    case 4:
      return 'Bloqueada'
    case 5:
      return 'Em processo de reserva'
    default:
      return 'Em estoque'
  }
}

export async function syncStockUnitsFromCvcrm(): Promise<{
  enterprisesProcessed: number
  totalInStock: number
  enterprisesWithStock: number
}> {
  if (!cvcrmConfigured()) {
    throw new Error('Integração com o CV CRM não está configurada.')
  }

  const enterprises = await fetchCvcrmEnterprises()
  let totalInStock = 0
  let enterprisesWithStock = 0
  let notificationsCreated = false

  const client = await pool.connect()
  try {
    // Busca usuários aptos a receber notificações de estoque (admins e membros com permissão)
    const usersToNotify = await client.query<{ id: number }>(
      `SELECT u.id
       FROM users u
       WHERE u.status = 'active'
         AND (
           u.role = 'admin'
           OR EXISTS (
             SELECT 1 FROM user_page_access upa
             WHERE upa.user_id = u.id AND upa.page_key = 'stock-units'
           )
         )`
    ).then((r) => r.rows)

    // Busca mapa de status das obras em enterprise_information para usar como base
    const localInfoRes = await client.query<{ enterprise_key: string; work_status: string }>(
      `SELECT enterprise_key, work_status FROM enterprise_information`,
    )
    const localStatusMap = new Map(localInfoRes.rows.map((r) => [r.enterprise_key.toLowerCase(), r.work_status]))

    // Carrega todas as unidades existentes em uma única query para evitar N+1 SELECTs
    const existingUnitsRes = await client.query<{
      id: number
      enterprise_id: number
      unit_id: number
      status_name: string
      status_id: number | null
    }>(`SELECT id, enterprise_id, unit_id, status_name, status_id FROM stock_units`)
    const existingUnitsMap = new Map(
      existingUnitsRes.rows.map((r) => [`${r.enterprise_id}:${r.unit_id}`, r]),
    )

    for (const emp of enterprises) {
      const detail = await fetchCvcrmEnterpriseWithUnits(emp.idempreendimento)
      if (!detail) continue

      const localStatus = localStatusMap.get(emp.nome.trim().toLowerCase())
      const isDelivered = localStatus === 'finished' ? true : localStatus === 'in_progress' ? false : Boolean(emp.isDelivered)
      const enterpriseStatus = isDelivered ? 'Obras Finalizadas' : (emp.statusObra || 'Em Andamento')
      const deliveryDate = emp.data_entrega || null

      const activeStockUnits: Array<{
        unitId: number
        unitName: string
        blockId: number | null
        blockName: string | null
        stageName: string | null
        floor: string | null
        typology: string | null
        position: string | null
        privateArea: number | null
        totalArea: number | null
        statusId: number | null
        statusName: string
        statusReason: string | null
        valuationValue: number | null
      }> = []

      for (const etapa of detail.etapas || []) {
        for (const bloco of etapa.blocos || []) {
          for (const u of bloco.unidades || []) {
            if (isUnitInStock(u)) {
              activeStockUnits.push({
                unitId: Number(u.idunidade),
                unitName: String(u.nome || '').trim(),
                blockId: bloco.idbloco ? Number(bloco.idbloco) : null,
                blockName: String(bloco.nome || '').trim() || null,
                stageName: String(etapa.nome || '').trim() || null,
                floor: u.andar !== null && u.andar !== undefined ? String(u.andar) : null,
                typology: u.tipologia ? String(u.tipologia).trim() : null,
                position: u.posicao ? String(u.posicao).trim() : null,
                privateArea: u.area_privativa ? Number(u.area_privativa) || null : null,
                totalArea: u.area_total ? Number(u.area_total) || null : null,
                statusId: Number(u.situacao?.vendida_idsituacao ?? u.situacao?.situacao_mapa_disponibilidade) || null,
                statusName: getStatusLabel(u),
                statusReason: u.situacao?.bloqueada_motivo ? String(u.situacao.bloqueada_motivo).trim() : null,
                valuationValue: u.valor_avaliacao ? Number(u.valor_avaliacao) || null : u.valor ? Number(u.valor) || null : null,
              })
            }
          }
        }
      }

      if (activeStockUnits.length > 0) {
        enterprisesWithStock++
        totalInStock += activeStockUnits.length

        for (const su of activeStockUnits) {
          const prevUnit = existingUnitsMap.get(`${emp.idempreendimento}:${su.unitId}`)
          const isStatusChanged = prevUnit && (prevUnit.status_name !== su.statusName || (prevUnit.status_id !== null && su.statusId !== null && prevUnit.status_id !== su.statusId))

          const upsertResult = await client.query<{ id: number }>(
            `INSERT INTO stock_units (
              enterprise_id, enterprise_name, unit_id, unit_name,
              block_id, block_name, stage_name, floor, typology, position,
              private_area, total_area, status_id, status_name, status_reason,
              valuation_value, raw_data, is_delivered, enterprise_status, enterprise_delivery_date,
              synced_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, '{}'::jsonb, $17, $18, $19, NOW(), NOW())
            ON CONFLICT (enterprise_id, unit_id) DO UPDATE SET
              enterprise_name = EXCLUDED.enterprise_name,
              unit_name = EXCLUDED.unit_name,
              block_id = EXCLUDED.block_id,
              block_name = EXCLUDED.block_name,
              stage_name = EXCLUDED.stage_name,
              floor = EXCLUDED.floor,
              typology = EXCLUDED.typology,
              position = EXCLUDED.position,
              private_area = EXCLUDED.private_area,
              total_area = EXCLUDED.total_area,
              status_id = EXCLUDED.status_id,
              status_name = EXCLUDED.status_name,
              status_reason = EXCLUDED.status_reason,
              valuation_value = EXCLUDED.valuation_value,
              is_delivered = EXCLUDED.is_delivered,
              enterprise_status = EXCLUDED.enterprise_status,
              enterprise_delivery_date = EXCLUDED.enterprise_delivery_date,
              synced_at = EXCLUDED.synced_at,
              updated_at = EXCLUDED.updated_at
            RETURNING id`,
            [
              emp.idempreendimento,
              emp.nome,
              su.unitId,
              su.unitName,
              su.blockId,
              su.blockName,
              su.stageName,
              su.floor,
              su.typology,
              su.position,
              su.privateArea,
              su.totalArea,
              su.statusId,
              su.statusName,
              su.statusReason,
              su.valuationValue,
              isDelivered,
              enterpriseStatus,
              deliveryDate,
            ],
          )

          const stockUnitDbId = upsertResult.rows[0]?.id ?? prevUnit?.id

          // Notifica quando uma unidade de obra já concluída tem sua situação modificada
          if (isStatusChanged && isDelivered && stockUnitDbId && usersToNotify.length > 0) {
            const notifMsg = `Situação da unidade ${su.blockName ? su.blockName + ' - ' : ''}${su.unitName} (${emp.nome}) alterada de "${prevUnit.status_name}" para "${su.statusName}". Agende uma vistoria técnica.`
            const userIds = usersToNotify.map((u) => u.id)
            await client.query(
              `INSERT INTO stock_unit_notifications (
                user_id, stock_unit_id, enterprise_id, enterprise_name,
                unit_name, block_name, old_status, new_status, message
              )
              SELECT unnest($1::bigint[]), $2, $3, $4, $5, $6, $7, $8, $9`,
              [
                userIds,
                stockUnitDbId,
                emp.idempreendimento,
                emp.nome,
                su.unitName,
                su.blockName,
                prevUnit.status_name,
                su.statusName,
                notifMsg,
              ],
            )
            notificationsCreated = true
          }
        }

        // Remove unidades desse empreendimento que não estão mais na lista de estoque (foram vendidas)
        const activeIds = activeStockUnits.map((u) => u.unitId)
        await client.query(
          `DELETE FROM stock_units WHERE enterprise_id = $1 AND NOT (unit_id = ANY($2::int[]))`,
          [emp.idempreendimento, activeIds],
        )
      } else {
        // Se todas as unidades foram vendidas, remove quaisquer registros remanescentes
        await client.query(
          `DELETE FROM stock_units WHERE enterprise_id = $1`,
          [emp.idempreendimento],
        )
      }
    }

    void broadcastSyncEvent({ scope: 'stock-units', action: 'synced' })
    if (notificationsCreated) {
      void broadcastSyncEvent({ scope: 'notifications', action: 'created' })
    }

    return {
      enterprisesProcessed: enterprises.length,
      totalInStock,
      enterprisesWithStock,
    }
  } finally {
    client.release()
  }
}

