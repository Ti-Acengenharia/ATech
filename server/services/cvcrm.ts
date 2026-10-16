import { pool } from '../db.js'
import { env } from '../config.js'
import { encryptPersonalData } from './personal-data.js'
import { recordTicketActivity } from './ticket-activity.js'
import { getTicketWarranty } from './warranties.js'

interface CvcrmStage {
  idsituacao: number
  nome: string
  ordem?: number
  cor_bg?: string
  cor_nome?: string
  flags?: Record<string, string>
}

interface CvcrmSubsubject {
  idsubassunto: unknown
  nome: unknown
}

interface CvcrmPage {
  dados?: Record<string, unknown>[]
  total?: number
  paginas?: number
  quantidade?: number
  total_de_paginas?: number
  total_de_registros?: number
  total_paginas?: number
  total_registros?: number
  pagina?: number
}

interface CvcrmPageResult {
  page: CvcrmPage
  totalPages: number | null
  totalRecords: number | null
}

class CvcrmHttpError extends Error {
  constructor(status: number, path: string, detail?: string) {
    const accessHint = status === 401 || status === 403
      ? ' Confirme no CVCRM o subdomínio da conta, se o e-mail corresponde ao token, se o token está ativo e se esse usuário tem permissão para consultar atendimentos.'
      : ''
    const safeDetail = detail
      ?.replace(env.CVCRM_API_EMAIL ?? '', env.CVCRM_API_EMAIL ? '[email]' : '')
      .replace(env.CVCRM_API_TOKEN ?? '', env.CVCRM_API_TOKEN ? '[token]' : '')
      .slice(0, 300)
    const detailMessage = safeDetail ? ` Detalhe do CVCRM: ${safeDetail}.` : ''
    super(`CVCRM respondeu HTTP ${status} no endpoint ${path}.${detailMessage}${accessHint}`)
    this.name = 'CvcrmHttpError'
    this.status = status
  }

  readonly status: number
}

function integrationConfigured() {
  return Boolean(env.CVCRM_SUBDOMAIN && env.CVCRM_API_EMAIL && env.CVCRM_API_TOKEN)
}

function apiBase() {
  if (!integrationConfigured()) {
    throw new Error('Configure CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }
  return `https://${env.CVCRM_SUBDOMAIN}.cvcrm.com.br/api`
}

function toText(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function toTimestamp(value: unknown) {
  const text = toText(value)
  if (!text) return null
  const parsed = new Date(text.replace(' ', 'T'))
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function isTicketActive(ticket: Record<string, unknown>) {
  const situation = toText(ticket.situacao)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
  return !/(?:^|\s)(?:cancelado|cancelada|finalizado|finalizada)(?:\s|$)/.test(situation)
}

function extractEnterprise(ticket: Record<string, unknown>) {
  const enterprise = ticket.empreendimento
  if (typeof enterprise === 'string') return enterprise
  if (enterprise && typeof enterprise === 'object' && 'nome' in enterprise) {
    return toText(enterprise.nome)
  }
  return ''
}

function extractSourceCreator(ticket: Record<string, unknown>) {
  for (const value of [ticket.nome, ticket.usuario_cadastro, ticket.criado_por, ticket.responsavel]) {
    if (typeof value === 'string' || typeof value === 'number') {
      const name = toText(value)
      if (name) return name
    }
    if (value && typeof value === 'object') {
      const person = value as Record<string, unknown>
      const name = toText(person.nome) || toText(person.name) || toText(person.usuario)
      if (name) return name
    }
  }
  return ''
}

function normalizeCvAttachment(value: unknown, responseId: string | null = null) {
  if (!value || typeof value !== 'object') return null
  const file = value as Record<string, unknown>
  const rawUrl = toText(file.url)
  let url = ''
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'https:' && (parsed.hostname === 'cvcrm.com.br' || parsed.hostname.endsWith('.cvcrm.com.br'))) {
      url = parsed.toString()
    }
  } catch {
    url = ''
  }
  return {
    id: toText(file.idarquivo) || null,
    name: toText(file.nome) || 'Anexo do CVCRM',
    type: toText(file.tipo),
    size: toText(file.tamanho),
    createdAt: toText(file.data_cad),
    url,
    responseId,
  }
}

function extractCvConversation(ticket: Record<string, unknown>) {
  const responses = Array.isArray(ticket.respostas) ? ticket.respostas : []
  const messages = responses.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return []
    const response = value as Record<string, unknown>
    const id = toText(response.idresposta) || String(index + 1)
    const attachments = Array.isArray(response.arquivos)
      ? response.arquivos.map((file) => normalizeCvAttachment(file, id)).filter((file) => file !== null)
      : []
    const body = toText(response.resposta)
    if (!body && !attachments.length) return []
    return [{
      id,
      createdAt: toText(response.dataCriacao),
      author: toText(response.atendente) || 'CVCRM',
      body,
      attachments,
    }]
  })
  const attachments = (Array.isArray(ticket.arquivos) ? ticket.arquivos : [])
    .map((file) => normalizeCvAttachment(file))
    .filter((file) => file !== null)
  const seen = new Set<string>()
  return {
    messages,
    attachments: attachments.filter((file) => {
      const key = file.id || `${file.name}:${file.createdAt}:${file.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}

async function getCvcrmResponse<T>(path: string, query?: URLSearchParams) {
  const url = new URL(`${apiBase()}${path}`)
  if (query) url.search = query.toString()

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      email: env.CVCRM_API_EMAIL!,
      token: env.CVCRM_API_TOKEN!,
    },
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const body = await response.text()
    let detail: string | undefined
    try {
      const payload: unknown = JSON.parse(body)
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        detail = toText(record.error) || toText(record.message) || toText(record.mensagem) || undefined
      }
    } catch {
      detail = undefined
    }
    throw new CvcrmHttpError(response.status, path, detail)
  }

  return {
    data: await response.json() as T,
    headers: response.headers,
  }
}

async function getCvcrm<T>(path: string, query?: URLSearchParams): Promise<T> {
  return (await getCvcrmResponse<T>(path, query)).data
}

async function fetchCvcrmTicketPage(page: number): Promise<CvcrmPageResult> {
  const query = new URLSearchParams({ pagina: String(page), registros_por_pagina: '500' })
  let response: Awaited<ReturnType<typeof getCvcrmResponse<unknown>>>
  try {
    response = await getCvcrmResponse<unknown>('/v1/relacionamento/atendimentos/listar', query)
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`O CVCRM excedeu o limite de 60 segundos ao consultar a página ${page}. A sincronização foi interrompida sem atualizar a base local.`)
    }
    throw error
  }
  const result: CvcrmPage = Array.isArray(response.data)
    ? { dados: response.data as Record<string, unknown>[] }
    : response.data && typeof response.data === 'object'
      ? response.data as CvcrmPage
      : {}
  const returnedPage = result.pagina === undefined ? null : Number(result.pagina)
  if (returnedPage !== null && (!Number.isSafeInteger(returnedPage) || returnedPage !== page)) {
    const received = Number.isSafeInteger(returnedPage) ? String(returnedPage) : 'indefinida'
    throw new Error(
      `A paginação do CVCRM não corresponde à solicitação: página ${page} solicitada, página ${received} retornada. Importação e sincronização interrompidas para evitar dados incompletos; confirme com o CVCRM o parâmetro de paginação deste endpoint.`,
    )
  }
  const headerPageValue = response.headers.get('X-Total-Paginas')
  const bodyPageValue = result.paginas ?? result.total_paginas ?? result.total_de_paginas
  const headerRecordValue = response.headers.get('X-Total-Registros')
  const bodyRecordValue = result.total ?? result.total_registros ?? result.total_de_registros
  const rawTotalPages = headerPageValue?.trim() || bodyPageValue
  const rawTotalRecords = headerRecordValue?.trim() || bodyRecordValue
  const totalPages = rawTotalPages === undefined ? null : Number(rawTotalPages)
  const totalRecords = rawTotalRecords === undefined ? null : Number(rawTotalRecords)
  if (totalPages !== null && (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000)) {
    throw new Error('O CVCRM retornou uma quantidade de páginas inválida.')
  }
  if (totalRecords !== null && (!Number.isSafeInteger(totalRecords) || totalRecords < 0)) {
    throw new Error('O CVCRM retornou uma quantidade de registros inválida.')
  }
  if (totalPages !== null && page > totalPages) {
    throw new Error(`O CVCRM informou ${totalPages} páginas, mas retornou a página ${page}.`)
  }
  if (!Array.isArray(result.dados)) {
    throw new Error(`O CVCRM não retornou a lista de registros da página ${page}.`)
  }
  if (result.dados.length > 500) {
    throw new Error(`O CVCRM retornou ${result.dados.length} registros para a página ${page}, acima do limite de 500.`)
  }
  return { page: result, totalPages, totalRecords }
}

function findProtocolMatch(tickets: Record<string, unknown>[], protocol: string) {
  return tickets.find((ticket) =>
    normalizeProtocol(ticket.protocolo) === protocol ||
    String(ticket.idatendimento) === protocol
  ) ?? null
}

async function fetchAllTickets() {
  const allTickets: Record<string, unknown>[] = []
  const seenIds = new Set<number>()
  const seenProtocols = new Map<string, number>()
  const firstPage = await fetchCvcrmTicketPage(1)
  if (firstPage.totalPages === null || firstPage.totalRecords === null) {
    throw new Error('O CVCRM não informou X-Total-Paginas e X-Total-Registros; importação interrompida para evitar uma carga incompleta.')
  }
  const totalPages = firstPage.totalPages
  const totalRecords = firstPage.totalRecords

  const appendPage = (pageNumber: number, result: CvcrmPageResult) => {
    if (result.totalPages === null || result.totalRecords === null) {
      throw new Error(`O CVCRM não informou X-Total-Paginas e X-Total-Registros na página ${pageNumber}; importação interrompida para evitar uma carga incompleta.`)
    }
    if (result.totalPages !== totalPages || result.totalRecords !== totalRecords) {
      throw new Error(`Os totais de paginação do CVCRM mudaram durante a importação (página ${pageNumber}); a carga foi interrompida.`)
    }
    for (const ticket of result.page.dados!) {
      const id = toNumber(ticket.idatendimento)
      if (id === null) {
        throw new Error(`O CVCRM retornou um atendimento sem idatendimento na página ${pageNumber}; importação interrompida.`)
      }
      if (seenIds.has(id)) {
        throw new Error(`O CVCRM repetiu o atendimento ${id} entre páginas; a importação foi interrompida para evitar duplicidade ou dados incompletos.`)
      }
      const protocol = normalizeProtocol(ticket.protocolo) || normalizeProtocol(ticket.referencia)
      const previousId = protocol ? seenProtocols.get(protocol) : undefined
      if (previousId !== undefined && previousId !== id) {
        throw new Error(`O CVCRM retornou o protocolo ${toText(ticket.protocolo) || protocol} nos atendimentos ${previousId} e ${id}; importação interrompida para evitar chamados duplicados.`)
      }
      seenIds.add(id)
      if (protocol) seenProtocols.set(protocol, id)
      allTickets.push(ticket)
    }
  }

  appendPage(1, firstPage)
  for (let firstPendingPage = 2; firstPendingPage <= totalPages; firstPendingPage += 4) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const pageNumbers = [firstPendingPage, firstPendingPage + 1, firstPendingPage + 2, firstPendingPage + 3]
      .filter((pageNumber) => pageNumber <= totalPages)
    const pages = await Promise.all(pageNumbers.map((pageNumber) => fetchCvcrmTicketPage(pageNumber)))
    pages.forEach((result, index) => appendPage(pageNumbers[index], result))
  }

  if (allTickets.length !== totalRecords) {
    throw new Error(`O CVCRM informou ${totalRecords} atendimentos, mas foram recebidos ${allTickets.length} após percorrer ${totalPages} páginas. Importação interrompida.`)
  }
  return { tickets: allTickets, totalPages, totalRecords }
}

async function fetchTicketByProtocol(protocol: string) {
  let currentPage = 1
  let totalPages = 1
  do {
    const result = await fetchCvcrmTicketPage(currentPage)
    const tickets = result.page.dados!
    const match = findProtocolMatch(tickets, protocol)
    if (match) return match

    if (result.totalPages === null || result.totalRecords === null) {
      throw new Error('O CVCRM não informou os totais de paginação; não é possível continuar a busca com segurança.')
    }
    totalPages = result.totalPages
    currentPage += 1
    if (currentPage <= totalPages) await new Promise((resolve) => setTimeout(resolve, 350))
  } while (currentPage <= totalPages)

  return null
}

async function persistWorkflowStages(stages: CvcrmStage[]) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM ticket_workflow_stages')

    for (const [index, stage] of stages.entries()) {
      const sourceStatusId = toNumber(stage.idsituacao)
      const name = toText(stage.nome)
      if (sourceStatusId === null || !name) continue

      await client.query(
        `INSERT INTO ticket_workflow_stages
          (source_status_id, name, position, background_color, text_color, flags, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [
          sourceStatusId,
          name,
          toNumber(stage.ordem) ?? index,
          toText(stage.cor_bg) || null,
          toText(stage.cor_nome) || null,
          JSON.stringify(stage.flags ?? {}),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function persistActiveTickets(
  rows: Record<string, unknown>[],
  replaceActiveSnapshot = true,
) {
  const activeTickets = rows.filter(isTicketActive)
  const activeProtocols = new Map<string, number>()
  const activeReferences = new Map<string, number>()
  for (const ticket of activeTickets) {
    const sourceId = toNumber(ticket.idatendimento)
    const protocol = normalizeProtocol(ticket.protocolo) || normalizeProtocol(ticket.referencia)
    if (sourceId === null || !protocol) continue
    const existingId = activeProtocols.get(protocol)
    if (existingId !== undefined && existingId !== sourceId) {
      throw new Error(`O CVCRM retornou o protocolo ${toText(ticket.protocolo) || protocol} em mais de um chamado (${existingId} e ${sourceId}); sincronização interrompida para evitar duplicidade.`)
    }
    activeProtocols.set(protocol, sourceId)
    const reference = toText(ticket.referencia) || String(sourceId)
    const previousReferenceId = activeReferences.get(reference)
    if (previousReferenceId !== undefined && previousReferenceId !== sourceId) {
      throw new Error(`O CVCRM retornou a referência ${reference} em mais de um chamado; sincronização interrompida para evitar duplicidade.`)
    }
    activeReferences.set(reference, sourceId)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (activeProtocols.size) {
      const existingProtocols = await client.query<{ protocol_key: string; source_id: string }>(
        `SELECT upper(regexp_replace(btrim(protocol), '[[:space:]]+', '', 'g')) AS protocol_key, source_id
         FROM tickets
         WHERE upper(regexp_replace(btrim(protocol), '[[:space:]]+', '', 'g')) = ANY($1::text[])
         FOR UPDATE`,
        [[...activeProtocols.keys()]],
      )
      for (const existing of existingProtocols.rows) {
        const incomingId = activeProtocols.get(existing.protocol_key)
        if (incomingId !== undefined && String(incomingId) !== existing.source_id) {
          throw new Error(`O protocolo ${existing.protocol_key} já pertence ao chamado ${existing.source_id}; o registro ${incomingId} não foi importado para evitar duplicidade.`)
        }
      }
    }
    if (activeReferences.size) {
      const existingReferences = await client.query<{ reference: string; source_id: string }>(
        'SELECT reference, source_id FROM tickets WHERE reference = ANY($1::varchar[]) FOR UPDATE',
        [[...activeReferences.keys()]],
      )
      for (const existing of existingReferences.rows) {
        const incomingId = activeReferences.get(existing.reference)
        if (incomingId !== undefined && String(incomingId) !== existing.source_id) {
          throw new Error(`A referência ${existing.reference} já pertence ao chamado ${existing.source_id}; o registro ${incomingId} não foi importado para evitar duplicidade.`)
        }
      }
    }
    const sourceIds = rows
      .map((ticket) => toNumber(ticket.idatendimento))
      .filter((id): id is number => id !== null)
    const previousStatuses = sourceIds.length
      ? await client.query<{
        source_id: string
        source_status_id: number | null
        source_status_name: string
      }>(
        `SELECT source_id, source_status_id, source_status_name
         FROM tickets WHERE source_id = ANY($1::bigint[])`,
        [sourceIds],
      )
      : { rows: [] }
    const previousById = new Map(previousStatuses.rows.map((row) => [row.source_id, row]))
    for (const ticket of rows) {
      const sourceId = toNumber(ticket.idatendimento)
      if (sourceId === null) continue
      const previous = previousById.get(String(sourceId))
      const statusId = toNumber(ticket.idsituacao)
      const statusName = toText(ticket.situacao) || 'Sem situação'
      if (previous && previous.source_status_id !== statusId) {
        await recordTicketActivity(
          client,
          sourceId,
          null,
          'stage_changed',
          `Etapa alterada de "${previous.source_status_name}" para "${statusName}" pelo CVCRM.`,
          { from: previous.source_status_name, to: statusName, source: 'cvcrm' },
        )
      }
      if (replaceActiveSnapshot && !isTicketActive(ticket)) {
        await client.query(
          `UPDATE tickets SET source_status_id = $1, source_status_name = $2,
             source_modified_at = $3, source_active = FALSE, updated_at = now()
           WHERE source_id = $4`,
          [
            statusId,
            statusName,
            toTimestamp(ticket.data_modificacao) ??
              toTimestamp(ticket.dataModificacao) ??
              toTimestamp(ticket.dataUltimaModificacaoSituacao),
            sourceId,
          ],
        )
      }
    }
    if (replaceActiveSnapshot) {
      await client.query('UPDATE tickets SET source_active = FALSE, updated_at = now() WHERE source_active = TRUE')
    }

    for (const ticket of activeTickets) {
      const sourceId = toNumber(ticket.idatendimento)
      if (sourceId === null) continue

      const reference = toText(ticket.referencia) || String(sourceId)
      const enterprise = extractEnterprise(ticket)
      const phone = toText(ticket.telefone_atendimento) || toText(ticket.telefone_cliente) || toText(ticket.telefone)
      const statusId = toNumber(ticket.idsituacao)
      const opening = toTimestamp(ticket.data_cad) ?? toTimestamp(ticket.dataCad)
      const modified = toTimestamp(ticket.data_modificacao) ??
        toTimestamp(ticket.dataModificacao) ??
        toTimestamp(ticket.dataUltimaModificacaoSituacao)
      const unit = toText(ticket.unidade) || toText(ticket.unidades)
      const subject = toText(ticket.titulo) || toText(ticket.assunto)
      const subsubject = toText(ticket.subassunto) || toText(ticket.subAssunto)
      const sourceSubjectId = toNumber(ticket.idassunto) ?? toNumber(ticket.idAssunto)
      const sourceSubsubjectId = toNumber(ticket.idsubassunto) ?? toNumber(ticket.idSubassunto)
      const description = toText(ticket.descricao)
      const sourceCreatorName = extractSourceCreator(ticket)
      const conversation = extractCvConversation(ticket)

      await client.query(
        `INSERT INTO tickets (
          source_id, reference, protocol, source_status_id, source_status_name, source_active,
          source_modified_at, opened_at, customer_name, customer_phone_ciphertext,
          subject, source_subject_id, subsubject, source_subsubject_id, description, source_creator_name,
          cv_responses, cv_attachments, enterprise, block, unit, priority, imported_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20, $21, now(), now()
        )
        ON CONFLICT (source_id) DO UPDATE SET
          reference = EXCLUDED.reference,
          protocol = EXCLUDED.protocol,
          source_status_id = EXCLUDED.source_status_id,
          source_status_name = EXCLUDED.source_status_name,
          source_active = TRUE,
          source_modified_at = EXCLUDED.source_modified_at,
          opened_at = EXCLUDED.opened_at,
          customer_name = EXCLUDED.customer_name,
          customer_phone_ciphertext = EXCLUDED.customer_phone_ciphertext,
          subject = EXCLUDED.subject,
          source_subject_id = EXCLUDED.source_subject_id,
          subsubject = EXCLUDED.subsubject,
          source_subsubject_id = EXCLUDED.source_subsubject_id,
          description = EXCLUDED.description,
          source_creator_name = EXCLUDED.source_creator_name,
          cv_responses = EXCLUDED.cv_responses,
          cv_attachments = EXCLUDED.cv_attachments,
          enterprise = EXCLUDED.enterprise,
          block = EXCLUDED.block,
          unit = EXCLUDED.unit,
          priority = EXCLUDED.priority,
          imported_at = now(),
          updated_at = now()`,
        [
          sourceId,
          reference,
          toText(ticket.protocolo) || reference,
          statusId,
          toText(ticket.situacao) || 'Sem situação',
          modified,
          opening,
          toText(ticket.nome_cliente) || toText(ticket.nome) || toText(ticket.cliente),
          phone ? encryptPersonalData(phone, 'ticket-phone') : null,
          subject,
          sourceSubjectId,
          subsubject,
          sourceSubsubjectId,
          description,
          sourceCreatorName,
          JSON.stringify(conversation.messages),
          JSON.stringify(conversation.attachments),
          enterprise,
          toText(ticket.bloco),
          unit,
          toText(ticket.prioridade),
        ],
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return activeTickets.length
}

function normalizeProtocol(value: unknown) {
  return toText(value).replace(/\s/g, '').toLocaleUpperCase('pt-BR')
}

export async function ensureWorkflowStagesExist() {
  const existing = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM ticket_workflow_stages')
  if (Number(existing.rows[0]?.count ?? 0) === 0 && integrationConfigured()) {
    try {
      const stages = await getCvcrm<CvcrmStage[]>('/v1/configuracoes/workflows/atendimentos')
      if (Array.isArray(stages) && stages.length > 0) {
        await persistWorkflowStages(stages)
      }
    } catch (error) {
      console.warn('Não foi possível pré-carregar etapas do workflow CVCRM:', error instanceof Error ? error.message : error)
    }
  }
}

export async function validateCvcrmConnection() {
  if (!integrationConfigured()) {
    throw new Error('Configure CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }

  try {
    const [stages, firstPage] = await Promise.all([
      getCvcrm<CvcrmStage[]>('/v1/configuracoes/workflows/atendimentos'),
      fetchCvcrmTicketPage(1),
    ])
    const firstIds = firstPage.page.dados!.map((ticket) => toNumber(ticket.idatendimento)).filter((id): id is number => id !== null)
    if (firstPage.page.dados!.length && firstIds.length !== firstPage.page.dados!.length) {
      throw new Error('A página 1 contém atendimentos sem idatendimento.')
    }
    if (firstPage.totalRecords !== null && firstPage.page.dados!.length > firstPage.totalRecords) {
      throw new Error('A primeira página contém mais atendimentos que o total informado pelo CVCRM.')
    }
    if (firstIds.length !== new Set(firstIds).size) {
      throw new Error('A página 1 contém IDs de atendimento repetidos.')
    }
    let secondPage: CvcrmPageResult | null = null
    if (firstPage.totalPages === null || firstPage.totalPages > 1) {
      secondPage = await fetchCvcrmTicketPage(2)
      if ((firstPage.totalPages !== null && secondPage.totalPages !== firstPage.totalPages) ||
          (firstPage.totalRecords !== null && secondPage.totalRecords !== firstPage.totalRecords)) {
        throw new Error('Os totais de páginas ou registros mudaram entre as consultas de validação do CVCRM.')
      }
      const firstIdSet = new Set(firstIds)
      const secondIds = secondPage.page.dados!.map((ticket) => toNumber(ticket.idatendimento)).filter((id): id is number => id !== null)
      if (secondPage.page.dados!.length && secondIds.length !== secondPage.page.dados!.length) {
        throw new Error('A página 2 contém atendimentos sem idatendimento.')
      }
      const duplicateIds = secondPage.page.dados!
        .map((ticket) => toNumber(ticket.idatendimento))
        .filter((id): id is number => id !== null && firstIdSet.has(id))
      if (duplicateIds.length) {
        throw new Error(`A validação de paginação falhou: as páginas 1 e 2 repetiram os atendimentos ${duplicateIds.slice(0, 10).join(', ')}.`)
      }
      if (secondIds.length !== new Set(secondIds).size) {
        throw new Error('A página 2 contém IDs de atendimento repetidos.')
      }
      if (firstPage.totalRecords !== null && firstPage.page.dados!.length + secondPage.page.dados!.length > firstPage.totalRecords) {
        throw new Error('A paginação retornou mais atendimentos nas duas primeiras páginas do que o total informado pelo CVCRM.')
      }
    }
    if (firstPage.totalPages === null || firstPage.totalRecords === null ||
        secondPage && (secondPage.totalPages === null || secondPage.totalRecords === null)) {
      throw new Error('O CVCRM não retornou X-Total-Registros e X-Total-Paginas; a paginação não foi validada para importar com segurança.')
    }
    const validStages = Array.isArray(stages)
      ? stages.filter((stage) => toText(stage.nome).length > 0)
      : []
    await persistWorkflowStages(validStages)
    await pool.query(
      `INSERT INTO ticket_sync_state (id, api_validated_at, last_success, error_message, updated_at)
       VALUES (1, now(), TRUE, NULL, now())
       ON CONFLICT (id) DO UPDATE SET api_validated_at = now(), last_success = TRUE, error_message = NULL, updated_at = now()`,
    )

    return {
      success: true,
      stages: validStages.filter((stage) => toText(stage.nome)).length,
      sampleReturned: firstPage.page.dados!.length,
      totalRecords: firstPage.totalRecords,
      totalPages: firstPage.totalPages,
      pagesTested: secondPage ? 2 : 1,
      secondPageReturned: secondPage?.page.dados!.length ?? 0,
      sampleIds: [...firstPage.page.dados!, ...(secondPage?.page.dados ?? [])]
        .map((ticket) => toNumber(ticket.idatendimento))
        .filter((id): id is number => id !== null)
        .slice(0, 10),
      validatedAt: new Date().toISOString(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na validação com CVCRM'
    await pool.query(
      `INSERT INTO ticket_sync_state (id, api_validated_at, last_success, error_message, updated_at)
       VALUES (1, NULL, FALSE, $1, now())
       ON CONFLICT (id) DO UPDATE SET
         api_validated_at = NULL, last_success = FALSE,
         error_message = EXCLUDED.error_message, updated_at = now()`,
      [message.slice(0, 490)],
    )
    throw error
  }
}

export async function syncCvcrmWarrantySubsubjects() {
  if (!integrationConfigured()) {
    throw new Error('Configure CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }

  const response = await getCvcrm<unknown>('/v1/cvbot/assuntos/16/sub-assuntos')
  if (!Array.isArray(response)) {
    throw new Error('O CVCRM retornou um formato inválido para o catálogo de subassuntos do assunto 16.')
  }

  const subsubjects: { id: number; name: string }[] = []
  const seenIds = new Set<number>()
  for (const entry of response) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('O CVCRM retornou um item inválido no catálogo de subassuntos do assunto 16.')
    }
    const item = entry as CvcrmSubsubject
    const id = toNumber(item.idsubassunto)
    const name = toText(item.nome)
    if (id === null || id < 1 || !name || seenIds.has(id)) {
      throw new Error('O CVCRM retornou identificadores ou nomes inválidos no catálogo de subassuntos do assunto 16.')
    }
    seenIds.add(id)
    subsubjects.push({ id, name })
  }
  if (!subsubjects.length) {
    throw new Error('O catálogo de subassuntos do assunto 16 veio vazio ou sem identificadores válidos; os dados salvos foram preservados.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE warranty_subsubjects
       SET is_active = FALSE, updated_at = now()
       WHERE source_subject_id = 16`,
    )
    for (const subsubject of subsubjects) {
      await client.query(
        `INSERT INTO warranty_subsubjects
          (source_subsubject_id, source_subject_id, name, is_active, synced_at, updated_at)
         VALUES ($1, 16, $2, TRUE, now(), now())
         ON CONFLICT (source_subsubject_id) DO UPDATE SET
           source_subject_id = EXCLUDED.source_subject_id,
           name = EXCLUDED.name,
           is_active = TRUE,
           synced_at = now(),
           updated_at = now()`,
        [subsubject.id, subsubject.name],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return { synced: subsubjects.length }
}

export async function fetchCvcrmTicketByProtocol(protocol: string): Promise<Record<string, unknown> | null> {
  if (!integrationConfigured()) {
    throw new Error('Configure CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }

  const clean = normalizeProtocol(protocol)
  if (!clean) {
    throw new Error('Informe um número de protocolo válido.')
  }

  return fetchTicketByProtocol(clean)
}

export async function fetchAndImportCvcrmTicketByProtocol(protocol: string) {
  const remoteTicket = await fetchCvcrmTicketByProtocol(protocol)
  if (!remoteTicket) {
    throw new Error(`Chamado com protocolo "${protocol}" não foi localizado no CVCRM.`)
  }

  await ensureWorkflowStagesExist()
  if (!isTicketActive(remoteTicket)) {
    throw new Error(`O chamado com protocolo "${protocol}" está encerrado no CVCRM e não foi importado como ativo.`)
  }
  await persistActiveTickets([remoteTicket], false)

  const sourceId = toNumber(remoteTicket.idatendimento)
  const result = await pool.query<{
    source_id: string
    protocol: string
    source_status_id: number | null
    source_status_name: string
    source_active: boolean
    customer_name: string
    enterprise: string
    block: string
    unit: string
    subject: string
    subsubject: string
    description: string
    priority: string
    opened_at: Date | null
  }>(
    `SELECT source_id, protocol, source_status_id, source_status_name, source_active,
            customer_name, enterprise, block, unit, subject, subsubject, description, priority, opened_at
     FROM tickets WHERE source_id = $1`,
    [sourceId],
  )

  const imported = result.rows[0]
  return {
    ticket: imported ? {
      id: imported.source_id,
      protocol: imported.protocol,
      statusId: imported.source_status_id,
      status: imported.source_status_name,
      sourceActive: imported.source_active,
      customerName: imported.customer_name,
      enterprise: imported.enterprise,
      block: imported.block,
      unit: imported.unit,
      subject: imported.subject,
      subsubject: imported.subsubject,
      warranty: imported.source_id ? await getTicketWarranty(Number(imported.source_id)) : null,
      description: imported.description,
      priority: imported.priority,
      openedAt: imported.opened_at,
    } : null,
    raw: {
      idatendimento: remoteTicket.idatendimento,
      protocolo: remoteTicket.protocolo,
      situacao: remoteTicket.situacao,
      cliente: remoteTicket.nome_cliente || remoteTicket.nome || remoteTicket.cliente,
      empreendimento: extractEnterprise(remoteTicket),
      assunto: remoteTicket.titulo || remoteTicket.assunto,
      ativo: remoteTicket.ativo,
    },
  }
}

export async function importCvcrmProtocols(protocols: string[]) {
  if (!integrationConfigured()) {
    throw new Error('Configure CVCRM_SUBDOMAIN, CVCRM_API_EMAIL e CVCRM_API_TOKEN no .env.')
  }

  const syncState = await pool.query<{ api_validated_at: Date | null }>(
    'SELECT api_validated_at FROM ticket_sync_state WHERE id = 1',
  )
  if (!syncState.rows[0]?.api_validated_at) {
    throw new Error('Valide a conexão com a API CVCRM antes de importar a carga inicial.')
  }

  const requestedProtocols = [...new Set(protocols.map(normalizeProtocol).filter(Boolean))]
  if (!requestedProtocols.length) throw new Error('O arquivo CSV não contém protocolos válidos.')
  if (requestedProtocols.length > 5000) throw new Error('O CSV pode conter no máximo 5.000 protocolos por importação.')

  await ensureWorkflowStagesExist()

  const requested = new Set(requestedProtocols)
  const { tickets: remoteTickets } = await fetchAllTickets()

  const found = remoteTickets.filter((ticket) =>
    requested.has(normalizeProtocol(ticket.protocolo)) ||
    requested.has(normalizeProtocol(ticket.referencia)) ||
    requested.has(String(ticket.idatendimento))
  )

  const active = found.filter(isTicketActive)
  const importedCount = await persistActiveTickets(active, false)

  const foundProtocols = new Set(found.map((ticket) => normalizeProtocol(ticket.protocolo)))
  const importedProtocols = new Set(active.map((ticket) => normalizeProtocol(ticket.protocolo)))
  const inactiveProtocols = found
    .filter((ticket) => !isTicketActive(ticket))
    .map((ticket) => toText(ticket.protocolo) || String(ticket.idatendimento))
  const missingProtocols = requestedProtocols.filter((protocol) => !foundProtocols.has(protocol))

  const baselineCompleted = importedCount > 0
  await pool.query(
    `INSERT INTO ticket_sync_state (id, baseline_completed, last_success, imported_count, error_message, updated_at)
     VALUES (1, $1, TRUE, $2, NULL, now())
     ON CONFLICT (id) DO UPDATE SET
       baseline_completed = EXCLUDED.baseline_completed,
       auto_sync_enabled = CASE
         WHEN EXCLUDED.baseline_completed THEN ticket_sync_state.auto_sync_enabled
         ELSE FALSE
       END,
       last_success = TRUE,
       imported_count = EXCLUDED.imported_count,
       error_message = NULL,
       updated_at = now()`,
    [baselineCompleted, importedCount],
  )

  return {
    requestedCount: requestedProtocols.length,
    foundCount: foundProtocols.size,
    importedCount,
    baselineCompleted,
    inactiveProtocols,
    missingProtocols,
    importedProtocols: [...importedProtocols],
  }
}

export async function importAllActiveCvcrmTickets() {
  if (!integrationConfigured()) {
    throw new Error('CVCRM não configurado. Defina subdomínio, e-mail e token no .env.')
  }
  const state = await pool.query<{ api_validated_at: Date | null }>(
    'SELECT api_validated_at FROM ticket_sync_state WHERE id = 1',
  )
  if (!state.rows[0]?.api_validated_at) {
    throw new Error('Valide a paginação da API CVCRM antes de importar todos os chamados ativos.')
  }

  const client = await pool.connect()
  let locked = false
  let started = false
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [73490211],
    )
    locked = lock.rows[0]?.acquired ?? false
    if (!locked) throw new Error('Já existe uma sincronização CVCRM em andamento.')

    await pool.query(
      `INSERT INTO ticket_sync_state (id, last_started_at, last_success, error_message, updated_at)
       VALUES (1, now(), NULL, NULL, now())
       ON CONFLICT (id) DO UPDATE SET last_started_at = now(), last_success = NULL, error_message = NULL, updated_at = now()`,
    )
    started = true
    const [stages, snapshot] = await Promise.all([
      getCvcrm<CvcrmStage[]>('/v1/configuracoes/workflows/atendimentos'),
      fetchAllTickets(),
    ])
    const validStages = Array.isArray(stages) ? stages : []
    await persistWorkflowStages(validStages)
    const importedCount = await persistActiveTickets(snapshot.tickets, true)
    await pool.query(
      `INSERT INTO ticket_sync_state
         (id, baseline_completed, last_started_at, last_finished_at, last_success, imported_count, error_message, updated_at)
       VALUES (1, TRUE, now(), now(), TRUE, $1, NULL, now())
       ON CONFLICT (id) DO UPDATE SET
         baseline_completed = TRUE, last_finished_at = now(), last_success = TRUE,
         imported_count = EXCLUDED.imported_count, error_message = NULL, updated_at = now()`,
      [importedCount],
    )
    return {
      totalRecords: snapshot.totalRecords || snapshot.tickets.length,
      totalPages: snapshot.totalPages,
      receivedCount: snapshot.tickets.length,
      importedCount,
      stageCount: validStages.filter((stage) => toText(stage.nome)).length,
      baselineCompleted: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 490) : 'Falha desconhecida na importação CVCRM.'
    if (started) {
      await pool.query(
        `INSERT INTO ticket_sync_state (id, last_started_at, last_finished_at, last_success, imported_count, error_message, updated_at)
         VALUES (1, now(), now(), FALSE, 0, $1, now())
         ON CONFLICT (id) DO UPDATE SET
           last_finished_at = now(), last_success = FALSE, error_message = EXCLUDED.error_message, updated_at = now()`,
        [message],
      )
    }
    throw error
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [73490211])
    client.release()
  }
}

export async function syncCvcrmTickets() {
  if (!integrationConfigured()) {
    throw new Error('CVCRM não configurado. Defina subdomínio, e-mail e token no .env.')
  }

  const syncState = await pool.query<{ api_validated_at: Date | null; baseline_completed: boolean }>(
    'SELECT api_validated_at, baseline_completed FROM ticket_sync_state WHERE id = 1',
  )
  if (!syncState.rows[0]?.api_validated_at || !syncState.rows[0]?.baseline_completed) {
    throw new Error('Valide a API e importe os protocolos iniciais antes de atualizar todos os chamados.')
  }

  const client = await pool.connect()
  let locked = false
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [73490211],
    )
    locked = lockResult.rows[0]?.acquired ?? false
    if (!locked) throw new Error('Já existe uma sincronização CVCRM em andamento.')

    await pool.query(
      `INSERT INTO ticket_sync_state (id, last_started_at, last_success, error_message, updated_at)
       VALUES (1, now(), NULL, NULL, now())
       ON CONFLICT (id) DO UPDATE SET last_started_at = now(), error_message = NULL, updated_at = now()`,
    )

    const stages = await getCvcrm<CvcrmStage[]>('/v1/configuracoes/workflows/atendimentos')
    const { tickets } = await fetchAllTickets()
    const validStages = Array.isArray(stages) ? stages : []
    await persistWorkflowStages(validStages)
    const importedCount = await persistActiveTickets(tickets, true)

    await pool.query(
      `INSERT INTO ticket_sync_state (id, last_started_at, last_finished_at, last_success, imported_count, error_message, updated_at)
       VALUES (1, now(), now(), TRUE, $1, NULL, now())
       ON CONFLICT (id) DO UPDATE SET
         last_finished_at = now(), last_success = TRUE, imported_count = EXCLUDED.imported_count,
         error_message = NULL, updated_at = now()`,
      [importedCount],
    )

    return { importedCount, stageCount: validStages.filter((stage) => toText(stage.nome)).length }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 490) : 'Falha desconhecida na sincronização CVCRM.'
    await pool.query(
      `INSERT INTO ticket_sync_state (id, last_started_at, last_finished_at, last_success, imported_count, error_message, updated_at)
       VALUES (1, now(), now(), FALSE, 0, $1, now())
       ON CONFLICT (id) DO UPDATE SET
         last_finished_at = now(), last_success = FALSE, error_message = EXCLUDED.error_message, updated_at = now()`,
      [safeMessage],
    )
    throw error
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [73490211])
    client.release()
  }
}

export function cvcrmIsConfigured() {
  return integrationConfigured()
}

export function cvcrmSyncIntervalMs() {
  return env.CVCRM_SYNC_INTERVAL_SECONDS * 1000
}

export async function cvcrmAutoSyncIsEnabled() {
  const state = await pool.query<{ auto_sync_enabled: boolean; baseline_completed: boolean; api_validated_at: Date | null }>(
    'SELECT auto_sync_enabled, baseline_completed, api_validated_at FROM ticket_sync_state WHERE id = 1',
  )
  return Boolean(
    state.rows[0]?.auto_sync_enabled &&
    state.rows[0]?.baseline_completed &&
    state.rows[0]?.api_validated_at,
  )
}

export async function toggleCvcrmAutoSync(enabled: boolean) {
  if (enabled) {
    const state = await pool.query<{ api_validated_at: Date | null; baseline_completed: boolean }>(
      'SELECT api_validated_at, baseline_completed FROM ticket_sync_state WHERE id = 1',
    )
    if (!state.rows[0]?.api_validated_at || !state.rows[0]?.baseline_completed) {
      throw new Error('Valide a API e importe ao menos um chamado ativo via CSV antes de ativar a sincronização automática.')
    }
  }

  await pool.query(
    `INSERT INTO ticket_sync_state (id, auto_sync_enabled, updated_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET auto_sync_enabled = EXCLUDED.auto_sync_enabled, updated_at = now()`,
    [enabled],
  )
  return enabled
}

export async function getCvcrmIntegrationStatus() {
  const [stateResult, countsResult, stagesResult] = await Promise.all([
    pool.query<{
      api_validated_at: Date | null
      baseline_completed: boolean
      auto_sync_enabled: boolean
      last_started_at: Date | null
      last_finished_at: Date | null
      last_success: boolean | null
      imported_count: number
      error_message: string | null
      updated_at: Date
    }>(
      `SELECT api_validated_at, baseline_completed, auto_sync_enabled,
              last_started_at, last_finished_at, last_success, imported_count, error_message, updated_at
       FROM ticket_sync_state WHERE id = 1`,
    ),
    pool.query<{ total: string; active: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE source_active = TRUE)::text AS active FROM tickets`,
    ),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ticket_workflow_stages
       WHERE name IS NOT NULL AND length(btrim(name)) > 0`,
    ),
  ])

  return {
    configured: cvcrmIsConfigured(),
    hasToken: Boolean(env.CVCRM_API_TOKEN),
    syncIntervalSeconds: env.CVCRM_SYNC_INTERVAL_SECONDS,
    state: stateResult.rows[0] ?? {
      api_validated_at: null,
      baseline_completed: false,
      auto_sync_enabled: false,
      last_started_at: null,
      last_finished_at: null,
      last_success: null,
      imported_count: 0,
      error_message: null,
      updated_at: new Date(),
    },
    stats: {
      totalTickets: Number(countsResult.rows[0]?.total ?? 0),
      activeTickets: Number(countsResult.rows[0]?.active ?? 0),
      stagesCount: Number(stagesResult.rows[0]?.count ?? 0),
    },
  }
}