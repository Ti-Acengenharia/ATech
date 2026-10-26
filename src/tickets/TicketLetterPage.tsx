import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleAlert, Download, FileText, MapPin, Search, ShieldCheck } from 'lucide-react'
import { apiRequest } from '../api/client'
import { createTicketLettersPdf, type LetterTicket } from './letter-pdf'
import type { TicketTag, TicketWarranty } from './types'
import './TicketLetterPage.css'

interface LetterSearchResult extends LetterTicket {
  statusId: number | null
  status: string
  sourceActive: boolean
  openedAt: string | null
  openSeconds: number | null
  customerPhone: string | null
  description: string
  priority: string
  localDueAt: string | null
  backgroundColor: string | null
  textColor: string | null
  commentCount: number
  subtaskCount: number
  completedSubtaskCount: number
  programmingCount: number
  tags: TicketTag[]
  warranty: TicketWarranty | null
}

function todayString() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function normalize(value: string) {
  return value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

function enterpriseKey(value: string) {
  return normalize(value)
}

function locationLabel(ticket: LetterTicket) {
  return [ticket.enterprise, ticket.block, ticket.unit]
    .filter(Boolean).join(' · ')
}

function formatAge(seconds: number | null) {
  if (seconds === null) return 'Sem data de abertura'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor(seconds % 86_400 / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : 'Sem prazo local'
}

function warrantyLabel(warranty: TicketWarranty | null) {
  if (!warranty) return ''
  if (warranty.status === 'within') return 'Dentro da garantia'
  if (warranty.status === 'outside') return 'Fora da garantia'
  return 'Garantia indeterminada'
}

export default function TicketLetterPage() {
  const [search, setSearch] = useState('')
  const [tickets, setTickets] = useState<LetterSearchResult[]>([])
  const [selectedTickets, setSelectedTickets] = useState<LetterSearchResult[]>([])
  const [startDate, setStartDate] = useState(todayString)
  const [addressDrafts, setAddressDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingAddress, setSavingAddress] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const selectedCustomerName = selectedTickets[0]?.customerName ?? ''

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search: search.trim() })
      if (selectedCustomerName) params.set('customerName', selectedCustomerName)
      apiRequest<{ tickets: LetterSearchResult[] }>(`/api/tickets/letters/search?${params}`)
        .then((result) => { if (!cancelled) setTickets(result.tickets) })
        .catch((error: unknown) => {
          if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível pesquisar os chamados.' })
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search, selectedCustomerName])

  const selectedIds = useMemo(() => new Set(selectedTickets.map((ticket) => ticket.id)), [selectedTickets])
  const addressGroups = useMemo(() => {
    const groups = new Map<string, { enterprise: string; workAddress: string }>()
    for (const ticket of selectedTickets) {
      if (!ticket.enterprise.trim()) continue
      const key = enterpriseKey(ticket.enterprise)
      if (!groups.has(key)) groups.set(key, { enterprise: ticket.enterprise, workAddress: ticket.workAddress })
    }
    return [...groups.entries()]
  }, [selectedTickets])
  const missingAddressGroups = addressGroups.filter(([, enterprise]) => !enterprise.workAddress.trim())
  const selectedWithoutEnterprise = selectedTickets.filter((ticket) => !ticket.enterprise.trim())
  const selectedWithoutAddress = selectedTickets.filter((ticket) => !ticket.workAddress.trim())

  function toggleTicket(ticket: LetterSearchResult) {
    setNotice(null)
    if (!selectedTickets.length && !selectedIds.has(ticket.id)) setSearch('')
    setSelectedTickets((current) => {
      if (current.some((selected) => selected.id === ticket.id)) {
        const next = current.filter((selected) => selected.id !== ticket.id)
        return next
      }
      if (current.length && normalize(ticket.customerName) !== normalize(current[0].customerName)) return current
      return [...current, ticket]
    })
  }

  function updateSearch(value: string) {
    setLoading(true)
    setSearch(value)
  }

  async function saveAddress(key: string, enterpriseName: string) {
    const workAddress = addressDrafts[key]?.trim() ?? ''
    if (workAddress.length < 3) {
      setNotice({ kind: 'error', text: 'Informe o endereço completo da obra.' })
      return
    }
    setSavingAddress(key)
    setNotice(null)
    try {
      await apiRequest('/api/tickets/letters/enterprise-address', {
        method: 'PUT',
        body: JSON.stringify({ enterpriseName, workAddress }),
      })
      setSelectedTickets((current) => current.map((ticket) =>
        enterpriseKey(ticket.enterprise) === key ? { ...ticket, workAddress } : ticket))
      setTickets((current) => current.map((ticket) =>
        enterpriseKey(ticket.enterprise) === key ? { ...ticket, workAddress } : ticket))
      setAddressDrafts((current) => ({ ...current, [key]: '' }))
      setNotice({ kind: 'success', text: `Endereço salvo no cadastro de ${enterpriseName}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o endereço.' })
    } finally {
      setSavingAddress(null)
    }
  }

  async function generatePdf() {
    setGenerating(true)
    setNotice(null)
    try {
      const bytes = await createTicketLettersPdf(selectedTickets, startDate)
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `cartas-chamados-${startDate}.pdf`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice({ kind: 'success', text: 'PDF gerado: notificação e duas vias do termo de entrega e recebimento.' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível gerar o PDF.' })
    } finally {
      setGenerating(false)
    }
  }

  const readyToGenerate = selectedTickets.length > 0 && Boolean(startDate) &&
    !selectedWithoutAddress.length && !selectedWithoutEnterprise.length

  return (
    <section className="ticket-letter-page">
      <header className="ticket-letter-heading">
        <span className="ticket-letter-heading-icon"><FileText size={22} /></span>
        <div><span className="eyebrow">DOCUMENTOS DE CHAMADOS</span><h1>Preenchimento de cartas</h1><p>Pesquise chamados na etapa 7.1, selecione os do mesmo cliente e gere a notificação com duas vias simples do termo para impressão.</p></div>
      </header>

      {notice && <div className={`ticket-letter-notice ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

      <div className="ticket-letter-layout">
        <section className="ticket-letter-search-card">
          <header><div><h2>Chamados na etapa 7.1</h2><p>A busca considera ID, protocolo, cliente, empreendimento, bloco, unidade e assunto.</p></div><span>{tickets.length} resultado(s)</span></header>
          <label className="ticket-letter-search"><Search size={16} /><input type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Buscar chamado, cliente, protocolo..." aria-label="Pesquisar chamados da etapa 7.1" /></label>
          {selectedTickets.length > 0 && <div className="ticket-letter-client-lock"><ShieldCheck size={15} /><span>Exibindo chamados 7.1 do mesmo cliente: <strong>{selectedTickets[0].customerName || 'Nome não informado'}</strong>.</span><button type="button" onClick={() => setSelectedTickets([])}>Limpar seleção</button></div>}
          <div className="ticket-letter-results" aria-live="polite">
            {loading ? <p className="ticket-letter-empty">Pesquisando chamados...</p> : tickets.length ? tickets.map((ticket) => {
              const selected = selectedIds.has(ticket.id)
              return (
                <label key={ticket.id} className={`ticket-letter-result ${selected ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleTicket(ticket)} />
                  <span className="ticket-letter-result-content">
                    <span className="ticket-letter-result-top"><strong>ID {ticket.id}</strong><small>Protocolo #{ticket.protocol}</small><i>{ticket.status}</i>{!ticket.sourceActive ? <i>Inativo</i> : ticket.priority && <i>{ticket.priority}</i>}</span>
                    <span className="ticket-letter-result-enterprise">{locationLabel(ticket) || 'Empreendimento não informado'}</span>
                    <span className="ticket-letter-result-subject">{ticket.subject || 'Sem assunto'}{ticket.subsubject && <small>{ticket.subsubject}</small>}</span>
                    <span className="ticket-letter-result-tags">{ticket.tags.map((tag) => <i key={tag.id} style={{ color: tag.color, borderColor: tag.color }}>{tag.name}</i>)}</span>
                    {ticket.warranty && <span className={`ticket-letter-warranty ${ticket.warranty.status}`} title={ticket.warranty.reason}>{warrantyLabel(ticket.warranty)}</span>}
                    <span className="ticket-letter-result-customer sensitive-data" tabIndex={0} title="Passe o cursor ou use o foco para revelar os dados do cliente">{ticket.customerName || 'Cliente não informado'}{ticket.customerPhone && <small>{ticket.customerPhone}</small>}</span>
                    <span className="ticket-letter-result-description">{ticket.description || 'Sem descrição registrada.'}</span>
                    <span className="ticket-letter-result-meta"><i>{formatAge(ticket.openSeconds)}</i><i>{ticket.commentCount} comentários</i><i>{ticket.completedSubtaskCount}/{ticket.subtaskCount} subtarefas</i><i>{ticket.programmingCount} programações</i><i>{formatDate(ticket.localDueAt)}</i></span>
                  </span>
                </label>
              )
            }) : <p className="ticket-letter-empty">Nenhum chamado da etapa 7.1 corresponde à busca.</p>}
          </div>
        </section>

        <aside className="ticket-letter-options">
          <section className="ticket-letter-date-card">
            <h2>Dados das cartas</h2>
            <label><span>Data de início *</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
            <div className="ticket-letter-selection-count"><span>Chamados selecionados</span><strong>{selectedTickets.length}</strong></div>
            {selectedTickets.length > 0 && <div className="ticket-letter-selected-list">{selectedTickets.map((ticket) => <span key={ticket.id}>#{ticket.id} · {ticket.protocol}</span>)}</div>}
          </section>

          {selectedTickets.length > 0 && (missingAddressGroups.length > 0 || selectedWithoutEnterprise.length > 0) && <section className="ticket-letter-address-card">
            <h2><MapPin size={16} /> Endereço da obra</h2>
            <p>O endereço será salvo no cadastro do empreendimento para próximas cartas.</p>
            {selectedWithoutEnterprise.length > 0 && <div className="ticket-letter-address-warning"><AlertTriangle size={15} /> Há chamados selecionados sem empreendimento. Atualize o empreendimento no chamado antes de gerar as cartas.</div>}
            {missingAddressGroups.map(([key, enterprise]) => (
              <div className="ticket-letter-address-entry" key={key}>
                <label><span>{enterprise.enterprise}</span><textarea rows={3} maxLength={500} value={addressDrafts[key] ?? ''} onChange={(event) => setAddressDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="Digite o endereço completo da obra" /></label>
                <button className="secondary-button" type="button" onClick={() => void saveAddress(key, enterprise.enterprise)} disabled={savingAddress !== null}>{savingAddress === key ? 'Salvando...' : 'Salvar endereço'}</button>
              </div>
            ))}
          </section>}

          <div className="ticket-letter-generate">
            <p>O PDF terá duas páginas: a notificação e, na segunda página, duas vias idênticas do termo para separar documentos assinados e os deixados no envelope.</p>
            <button className="primary-button" type="button" onClick={() => void generatePdf()} disabled={!readyToGenerate || generating}>
              <Download size={16} />{generating ? 'Gerando PDF...' : 'Gerar PDF para impressão'}
            </button>
            {!selectedTickets.length && <small>Selecione ao menos um chamado da etapa 7.1.</small>}
            {selectedWithoutAddress.length > 0 && !missingAddressGroups.length && <small>Complete os endereços dos empreendimentos antes de gerar.</small>}
          </div>
        </aside>
      </div>
    </section>
  )
}
