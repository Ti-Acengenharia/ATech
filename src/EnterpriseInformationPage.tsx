import { useEffect, useState, type FormEvent } from 'react'
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import { apiRequest } from './api/client'
import MediaViewerModal, { type MediaViewerItem } from './MediaViewerModal'

interface EnterpriseInformation {
  enterprise_key: string
  enterprise_name: string
  ticket_count: number
  document_count?: number
  work_status?: 'finished' | 'in_progress'
  syndic_name: string | null
  syndic_phone: string | null
  syndic_email: string | null
  supervisor_name: string | null
  supervisor_phone: string | null
  supervisor_email: string | null
  condominium_email: string | null
  work_address: string | null
  occupancy_permit_date: string | null
  condominium_delivery_date: string | null
}

interface EnterpriseDocument {
  id: string
  enterprise_key: string
  category: string
  title: string
  file_name: string
  content_type: string
  file_size: number
  created_at: string
  updated_at: string
  uploaded_by: number | null
  uploaded_by_name: string
}

interface EnterpriseForm {
  enterpriseName: string
  workStatus: 'finished' | 'in_progress'
  syndicName: string
  syndicPhone: string
  syndicEmail: string
  supervisorName: string
  supervisorPhone: string
  supervisorEmail: string
  condominiumEmail: string
  workAddress: string
  occupancyPermitDate: string
  condominiumDeliveryDate: string
}

const DOCUMENT_CATEGORIES = [
  'Manual do Proprietário',
  'Manual das Áreas Comuns',
  'Projeto Arquitetônico',
  'Projeto Estrutural',
  'Projeto Elétrico / Hidráulico',
  'Outros Documentos',
] as const

const FILTER_CATEGORIES = ['Todos', 'Manuais', 'Projetos', 'Outros'] as const

function inputDate(value: string | null) {
  return value?.slice(0, 10) ?? ''
}

function displayDate(value: string | null) {
  if (!value) return 'Não informado'
  const date = new Date(`${inputDate(value)}T12:00:00`)
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date)
}

function deliveredDuration(value: string | null, now: number) {
  if (!value) return null
  const start = new Date(`${inputDate(value)}T12:00:00`)
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  if (start > today) return 'Entrega prevista para o futuro'
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
  const years = Math.floor(days / 365.2425)
  const months = Math.floor((days - years * 365.2425) / 30.436875)
  const remainingDays = Math.max(0, Math.floor(days - years * 365.2425 - months * 30.436875))
  return `${years ? `${years} ${years === 1 ? 'ano' : 'anos'}, ` : ''}${months} ${months === 1 ? 'mês' : 'meses'} e ${remainingDays} ${remainingDays === 1 ? 'dia' : 'dias'}`
}

function formFromEnterprise(enterprise: EnterpriseInformation): EnterpriseForm {
  return {
    enterpriseName: enterprise.enterprise_name,
    workStatus: enterprise.work_status === 'finished' ? 'finished' : 'in_progress',
    syndicName: enterprise.syndic_name ?? '',
    syndicPhone: enterprise.syndic_phone ?? '',
    syndicEmail: enterprise.syndic_email ?? '',
    supervisorName: enterprise.supervisor_name ?? '',
    supervisorPhone: enterprise.supervisor_phone ?? '',
    supervisorEmail: enterprise.supervisor_email ?? '',
    condominiumEmail: enterprise.condominium_email ?? '',
    workAddress: enterprise.work_address ?? '',
    occupancyPermitDate: inputDate(enterprise.occupancy_permit_date),
    condominiumDeliveryDate: inputDate(enterprise.condominium_delivery_date),
  }
}

function ContactLine({ label, name, phone, email }: { label: string; name: string | null; phone: string | null; email: string | null }) {
  return (
    <section className="enterprise-contact">
      <span className="enterprise-contact-icon"><UserRound size={16} /></span>
      <div className="enterprise-contact-copy">
        <small>{label}</small>
        <strong>{name || 'Nome não informado'}</strong>
        <div className="enterprise-contact-links">
          {phone ? <a href={`tel:${phone}`}><Phone size={13} />{phone}</a> : <span><Phone size={13} />Telefone não informado</span>}
          {email && <a href={`mailto:${email}`}><Mail size={13} />{email}</a>}
        </div>
      </div>
    </section>
  )
}

function emptyEnterpriseForm(): EnterpriseForm {
  return {
    enterpriseName: '',
    workStatus: 'in_progress',
    syndicName: '',
    syndicPhone: '',
    syndicEmail: '',
    supervisorName: '',
    supervisorPhone: '',
    supervisorEmail: '',
    condominiumEmail: '',
    workAddress: '',
    occupancyPermitDate: '',
    condominiumDeliveryDate: '',
  }
}

export default function EnterpriseInformationPage() {
  const [enterprises, setEnterprises] = useState<EnterpriseInformation[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<EnterpriseForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'delivered' | 'planned' | 'missing'>('all')
  const [workStatusFilter, setWorkStatusFilter] = useState<'all' | 'finished' | 'in_progress'>('all')

  // Estado do Repositório de Documentos (Manuais & Projetos)
  const [expandedDocsEnterprise, setExpandedDocsEnterprise] = useState<string | null>(null)
  const [documentsMap, setDocumentsMap] = useState<Record<string, EnterpriseDocument[]>>({})
  const [loadingDocs, setLoadingDocs] = useState<Set<string>>(() => new Set())
  const [docsCategoryFilter, setDocsCategoryFilter] = useState<Record<string, string>>({})

  // Estado do Modal de Upload de PDF
  const [uploadModalEnterprise, setUploadModalEnterprise] = useState<EnterpriseInformation | null>(null)
  const [uploadCategory, setUploadCategory] = useState<string>(DOCUMENT_CATEGORIES[0])
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Estado do Visualizador de Mídia
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerItems, setViewerItems] = useState<MediaViewerItem[]>([])
  const [viewerIndex, setViewerIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ enterprises: EnterpriseInformation[] }>('/api/enterprise-information')
      .then((result) => { if (!cancelled) setEnterprises(result.enterprises) })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os empreendimentos.' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  async function loadDocuments(enterpriseKey: string) {
    setLoadingDocs((prev) => new Set(prev).add(enterpriseKey))
    try {
      const result = await apiRequest<{ documents: EnterpriseDocument[] }>(
        `/api/enterprise-information/${encodeURIComponent(enterpriseKey)}/documents`,
      )
      setDocumentsMap((prev) => ({ ...prev, [enterpriseKey]: result.documents }))
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Não foi possível carregar os documentos deste empreendimento.' })
    } finally {
      setLoadingDocs((prev) => {
        const next = new Set(prev)
        next.delete(enterpriseKey)
        return next
      })
    }
  }

  function toggleDocs(enterpriseKey: string) {
    if (expandedDocsEnterprise === enterpriseKey) {
      setExpandedDocsEnterprise(null)
    } else {
      setExpandedDocsEnterprise(enterpriseKey)
      if (!documentsMap[enterpriseKey]) {
        void loadDocuments(enterpriseKey)
      }
    }
  }

  function openUploadModal(enterprise: EnterpriseInformation) {
    setUploadModalEnterprise(enterprise)
    setUploadCategory(DOCUMENT_CATEGORIES[0])
    setUploadTitle('')
    setUploadFile(null)
    setUploadError('')
  }

  function closeUploadModal() {
    setUploadModalEnterprise(null)
    setUploadFile(null)
    setUploadTitle('')
    setUploadError('')
  }

  async function handleUploadSubmit(event: FormEvent) {
    event.preventDefault()
    if (!uploadModalEnterprise || !uploadFile) {
      setUploadError('Selecione um arquivo PDF para enviar.')
      return
    }

    if (!uploadFile.name.toLowerCase().endsWith('.pdf') && uploadFile.type !== 'application/pdf') {
      setUploadError('O arquivo selecionado deve ser um documento PDF.')
      return
    }

    if (uploadFile.size > 30 * 1024 * 1024) {
      setUploadError('O arquivo PDF excede o limite máximo de 30 MB.')
      return
    }

    setUploading(true)
    setUploadError('')

    try {
      const buffer = await uploadFile.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      const contentBase64 = btoa(binary)

      const title = uploadTitle.trim() || uploadFile.name.replace(/\.pdf$/i, '')
      const enterpriseKey = uploadModalEnterprise.enterprise_key

      await apiRequest(`/api/enterprise-information/${encodeURIComponent(enterpriseKey)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          category: uploadCategory,
          title,
          fileName: uploadFile.name,
          contentBase64,
        }),
      })

      // Recarrega documentos do empreendimento
      await loadDocuments(enterpriseKey)

      // Atualiza o contador de documentos no card do empreendimento
      setEnterprises((curr) =>
        curr.map((ent) =>
          ent.enterprise_key === enterpriseKey ? { ...ent, document_count: (ent.document_count ?? 0) + 1 } : ent,
        ),
      )

      closeUploadModal()
      setNotice({ kind: 'success', text: `Documento "${title}" anexado com sucesso.` })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Não foi possível enviar o documento.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteDocument(enterpriseKey: string, doc: EnterpriseDocument) {
    if (!window.confirm(`Excluir permanentemente o documento "${doc.title}"?`)) return
    try {
      await apiRequest(
        `/api/enterprise-information/${encodeURIComponent(enterpriseKey)}/documents/${doc.id}`,
        { method: 'DELETE' },
      )
      setDocumentsMap((prev) => ({
        ...prev,
        [enterpriseKey]: (prev[enterpriseKey] || []).filter((d) => d.id !== doc.id),
      }))
      setEnterprises((curr) =>
        curr.map((ent) =>
          ent.enterprise_key === enterpriseKey
            ? { ...ent, document_count: Math.max(0, (ent.document_count ?? 1) - 1) }
            : ent,
        ),
      )
      setNotice({ kind: 'success', text: `Documento "${doc.title}" removido.` })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Não foi possível excluir o documento.' })
    }
  }

  function handleViewDocument(enterprise: EnterpriseInformation, doc: EnterpriseDocument) {
    const docs = documentsMap[enterprise.enterprise_key] || []
    const items: MediaViewerItem[] = docs.map((d) => ({
      id: d.id,
      title: d.title,
      url: `/api/enterprise-information/${encodeURIComponent(d.enterprise_key)}/documents/${d.id}`,
      downloadUrl: `/api/enterprise-information/${encodeURIComponent(d.enterprise_key)}/documents/${d.id}?download=1`,
      fileSize: d.file_size,
      mimeType: d.content_type,
      type: 'pdf',
      source: `${enterprise.enterprise_name} · ${d.category}`,
      createdAt: d.created_at,
    }))

    const foundIndex = items.findIndex((it) => it.id === doc.id)
    setViewerItems(items)
    setViewerIndex(foundIndex >= 0 ? foundIndex : 0)
    setViewerOpen(true)
  }

  function startEdit(enterprise: EnterpriseInformation) {
    setCreating(false)
    setEditing(enterprise.enterprise_key)
    setForm(formFromEnterprise(enterprise))
    setNotice(null)
  }

  function startCreate() {
    setCreating(true)
    setEditing(null)
    setForm(emptyEnterpriseForm())
    setNotice(null)
  }

  function cancelEdit() {
    setCreating(false)
    setEditing(null)
    setForm(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setNotice(null)
    try {
      await apiRequest('/api/enterprise-information', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          occupancyPermitDate: form.occupancyPermitDate || null,
          condominiumDeliveryDate: form.condominiumDeliveryDate || null,
        }),
      })
      const wasCreating = creating
      cancelEdit()
      setNotice({ kind: 'success', text: wasCreating ? 'Empreendimento cadastrado.' : 'Informações do empreendimento atualizadas.' })
      setRefresh((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar as informações.' })
    } finally {
      setSaving(false)
    }
  }

  function update<K extends keyof EnterpriseForm>(key: K, value: EnterpriseForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current)
  }

  const todayDate = new Date(now)
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
  const filteredEnterprises = enterprises.filter((enterprise) => {
    const matchesSearch = !normalizedSearch || [
      enterprise.enterprise_name,
      enterprise.syndic_name,
      enterprise.syndic_phone,
      enterprise.syndic_email,
      enterprise.supervisor_name,
      enterprise.supervisor_phone,
      enterprise.supervisor_email,
      enterprise.condominium_email,
      enterprise.work_address,
    ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    const deliveryDate = inputDate(enterprise.condominium_delivery_date)
    const matchesDelivery = deliveryFilter === 'all' ||
      (deliveryFilter === 'missing' && !deliveryDate) ||
      (deliveryFilter === 'planned' && deliveryDate > today) ||
      (deliveryFilter === 'delivered' && Boolean(deliveryDate) && deliveryDate <= today)
    const matchesWorkStatus = workStatusFilter === 'all' || (enterprise.work_status ?? 'in_progress') === workStatusFilter
    return matchesSearch && matchesDelivery && matchesWorkStatus
  })

  return (
    <section className="enterprise-information-page">
      <header className="enterprise-page-heading">
        <span className="enterprise-heading-mark"><Building2 size={21} /></span>
        <div><span className="eyebrow">CADASTRO DOS CONDOMÍNIOS</span><h1>Informações dos empreendimentos</h1><p>Lista única com contatos, datas técnicas e repositório de manuais e projetos em PDF.</p></div>
        <span className="enterprise-count-badge">{enterprises.length} {enterprises.length === 1 ? 'empreendimento' : 'empreendimentos'}</span>
        <button className="primary-button enterprise-create-button" type="button" onClick={startCreate}><Plus size={15} /> Cadastrar empreendimento</button>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>
          {notice.text}
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {creating && form && (
        <article className="enterprise-card enterprise-card-editing enterprise-create-card">
          <header className="enterprise-card-heading"><span className="enterprise-card-icon"><Building2 size={18} /></span><div><h2>Novo empreendimento</h2><span>Preencha o nome e os dados que já tiver disponíveis.</span></div><button type="button" className="icon-button enterprise-cancel-create" aria-label="Cancelar cadastro" onClick={cancelEdit}><X size={16} /></button></header>
          <EnterpriseEditForm form={form} onUpdate={update} onSubmit={(event) => void save(event)} saving={saving} onCancel={cancelEdit} creating />
        </article>
      )}

      {!loading && enterprises.length > 0 && (
        <div className="enterprise-filters">
          <label className="search-box"><Search size={15} /><input type="search" placeholder="Buscar empreendimento, síndico, supervisor ou contato" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>Situação da obra</span><select value={workStatusFilter} onChange={(event) => setWorkStatusFilter(event.target.value as typeof workStatusFilter)}>
            <option value="all">Todas as situações</option>
            <option value="finished">Obra Finalizada</option>
            <option value="in_progress">Em Andamento</option>
          </select></label>
          <label><span>Entrega do condomínio</span><select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value as typeof deliveryFilter)}>
            <option value="all">Todas as datas</option>
            <option value="delivered">Já entregue</option>
            <option value="planned">Entrega prevista</option>
            <option value="missing">Sem data informada</option>
          </select></label>
          <span className="enterprise-filter-count">{filteredEnterprises.length} de {enterprises.length}</span>
          <button className="filter-clear-button" type="button" disabled={!search && deliveryFilter === 'all' && workStatusFilter === 'all'} onClick={() => { setSearch(''); setDeliveryFilter('all'); setWorkStatusFilter('all') }}><X size={14} /> Limpar filtros</button>
        </div>
      )}

      {loading ? (
        <div className="enterprise-empty-state">Carregando empreendimentos...</div>
      ) : enterprises.length === 0 ? (
        <div className="enterprise-empty-state"><Building2 size={28} /><strong>Nenhum empreendimento encontrado</strong><span>Os empreendimentos serão listados assim que estiverem presentes nos chamados.</span></div>
      ) : (
        <div className="enterprise-list">
          {filteredEnterprises.map((enterprise) => {
            const duration = deliveredDuration(enterprise.condominium_delivery_date, now)
            const isEditing = editing === enterprise.enterprise_key && form !== null
            const isExpandedDocs = expandedDocsEnterprise === enterprise.enterprise_key
            const docs = documentsMap[enterprise.enterprise_key] || []
            const activeCat = docsCategoryFilter[enterprise.enterprise_key] || 'Todos'

            const filteredDocs = docs.filter((d) => {
              if (activeCat === 'Todos') return true
              if (activeCat === 'Manuais') return d.category.toLowerCase().includes('manual')
              if (activeCat === 'Projetos') return d.category.toLowerCase().includes('projeto')
              return !d.category.toLowerCase().includes('manual') && !d.category.toLowerCase().includes('projeto')
            })

            return (
              <article className={`enterprise-card ${isEditing ? 'enterprise-card-editing' : ''}`} key={enterprise.enterprise_key}>
                <header className="enterprise-card-heading">
                  <span className="enterprise-card-icon"><Building2 size={18} /></span>
                  <div>
                    <div className="enterprise-card-title-row">
                      <h2>{enterprise.enterprise_name}</h2>
                      <span className={`enterprise-work-status-tag ${enterprise.work_status === 'finished' ? 'is-finished' : 'is-in-progress'}`}>
                        {enterprise.work_status === 'finished' ? 'Obra Finalizada' : 'Em Andamento'}
                      </span>
                    </div>
                    <span>{enterprise.ticket_count} {enterprise.ticket_count === 1 ? 'chamado registrado' : 'chamados registrados'}</span>
                  </div>
                  {!isEditing && <button className="secondary-button enterprise-edit-button" type="button" onClick={() => startEdit(enterprise)}><Pencil size={14} /> Atualizar dados</button>}
                </header>

                {isEditing && form ? (
                  <EnterpriseEditForm form={form} onUpdate={update} onSubmit={(event) => void save(event)} saving={saving} onCancel={cancelEdit} />
                ) : (
                  <>
                    <div className="enterprise-contacts">
                      <ContactLine label="Síndico atual" name={enterprise.syndic_name} phone={enterprise.syndic_phone} email={enterprise.syndic_email} />
                      <ContactLine label="Supervisor atual" name={enterprise.supervisor_name} phone={enterprise.supervisor_phone} email={enterprise.supervisor_email} />
                    </div>
                    <div className="enterprise-facts">
                      <div className="enterprise-fact"><Mail size={15} /><span><small>E-mail do condomínio</small><strong>{enterprise.condominium_email || 'Não informado'}</strong></span></div>
                      <div className="enterprise-fact"><MapPin size={15} /><span><small>Endereço da obra</small><strong>{enterprise.work_address || 'Não informado'}</strong></span></div>
                      <div className="enterprise-fact"><CalendarDays size={15} /><span><small>Emissão do habite-se</small><strong>{displayDate(enterprise.occupancy_permit_date)}</strong></span></div>
                      <div className="enterprise-fact"><CalendarDays size={15} /><span><small>Entrega do condomínio</small><strong>{displayDate(enterprise.condominium_delivery_date)}</strong></span></div>
                      <div className={`enterprise-delivery-counter ${duration ? 'has-delivery-date' : ''}`}><ShieldCheck size={17} /><span><small>Tempo desde a entrega</small><strong>{duration ?? 'Data de entrega não informada'}</strong></span></div>
                    </div>

                    {/* Repositório de Documentos (Manuais & Projetos em PDF) */}
                    <div className="enterprise-docs-section">
                      <button
                        type="button"
                        className={`enterprise-docs-toggle ${isExpandedDocs ? 'is-expanded' : ''}`}
                        onClick={() => toggleDocs(enterprise.enterprise_key)}
                        title="Ver ou anexar projetos e manuais em PDF"
                      >
                        <FolderOpen size={16} />
                        <span>Manuais & Projetos em PDF</span>
                        <span className="enterprise-doc-count-pill">{enterprise.document_count ?? docs.length}</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                          {isExpandedDocs ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </span>
                      </button>

                      {isExpandedDocs && (
                        <div className="enterprise-docs-body">
                          <div className="enterprise-docs-toolbar">
                            <div className="enterprise-docs-filter-tabs">
                              {FILTER_CATEGORIES.map((cat) => (
                                <button
                                  type="button"
                                  key={cat}
                                  className={`enterprise-docs-filter-btn ${activeCat === cat ? 'is-active' : ''}`}
                                  onClick={() => setDocsCategoryFilter((curr) => ({ ...curr, [enterprise.enterprise_key]: cat }))}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="enterprise-docs-upload-btn"
                              onClick={() => openUploadModal(enterprise)}
                            >
                              <Plus size={13} /> Anexar PDF
                            </button>
                          </div>

                          {loadingDocs.has(enterprise.enterprise_key) ? (
                            <div className="enterprise-doc-empty">Carregando documentos...</div>
                          ) : filteredDocs.length === 0 ? (
                            <div className="enterprise-doc-empty">
                              {activeCat === 'Todos'
                                ? 'Nenhum manual ou projeto anexado neste empreendimento. Clique em "+ Anexar PDF" para adicionar.'
                                : `Nenhum documento encontrado na categoria "${activeCat}".`}
                            </div>
                          ) : (
                            <ul className="enterprise-docs-list">
                              {filteredDocs.map((doc) => (
                                <li className="enterprise-doc-item" key={doc.id}>
                                  <div className="enterprise-doc-item-left">
                                    <FileText size={20} className="enterprise-doc-icon" />
                                    <div className="enterprise-doc-info">
                                      <div className="enterprise-doc-title-row">
                                        <h4 className="enterprise-doc-title" title={doc.title}>{doc.title}</h4>
                                        <span className="enterprise-doc-category-badge">{doc.category}</span>
                                      </div>
                                      <div className="enterprise-doc-meta">
                                        <span>{doc.file_name}</span>
                                        <span>·</span>
                                        <span>{Math.round(doc.file_size / 1024)} KB</span>
                                        <span>·</span>
                                        <span>{doc.uploaded_by_name}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="enterprise-doc-actions">
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      style={{ padding: '4px 9px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      onClick={() => handleViewDocument(enterprise, doc)}
                                      title="Visualizar PDF direto no navegador"
                                    >
                                      <Eye size={13} /> Visualizar
                                    </button>
                                    <a
                                      href={`/api/enterprise-information/${encodeURIComponent(enterprise.enterprise_key)}/documents/${doc.id}?download=1`}
                                      download={doc.file_name}
                                      className="secondary-button"
                                      style={{ padding: '4px 8px', fontSize: '11px' }}
                                      title="Baixar PDF"
                                    >
                                      <Download size={13} />
                                    </a>
                                    <button
                                      type="button"
                                      className="icon-button icon-button-danger"
                                      style={{ width: '28px', height: '28px' }}
                                      onClick={() => void handleDeleteDocument(enterprise.enterprise_key, doc)}
                                      title="Excluir documento"
                                      aria-label={`Excluir ${doc.title}`}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </article>
            )
          })}
          {!filteredEnterprises.length && <div className="enterprise-empty-state"><Search size={24} /><strong>Nenhum empreendimento corresponde aos filtros</strong><span>Altere os termos ou limpe os filtros para ver os empreendimentos.</span></div>}
        </div>
      )}

      {/* Modal de Upload de PDF */}
      {uploadModalEnterprise && (
        <div className="enterprise-upload-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !uploading) closeUploadModal() }}>
          <div className="enterprise-upload-modal" role="dialog" aria-modal="true" aria-label="Anexar documento PDF">
            <header className="enterprise-upload-modal-header">
              <h3>Anexar Manual / Projeto em PDF</h3>
              <button
                type="button"
                className="icon-button"
                onClick={closeUploadModal}
                disabled={uploading}
                aria-label="Fechar modal"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={(e) => void handleUploadSubmit(e)}>
              <div className="enterprise-upload-modal-body">
                {uploadError && (
                  <div className="notice notice-error" style={{ marginBottom: 0 }}>
                    <CircleAlert size={14} /> {uploadError}
                  </div>
                )}

                <div className="enterprise-upload-field">
                  <label>Empreendimento</label>
                  <input type="text" value={uploadModalEnterprise.enterprise_name} disabled style={{ background: '#f1f5f9', color: '#64748b' }} />
                </div>

                <div className="enterprise-upload-field">
                  <label>Categoria do documento</label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    disabled={uploading}
                  >
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="enterprise-upload-field">
                  <label>Título ou descrição amigável (opcional)</label>
                  <input
                    type="text"
                    placeholder="Ex: Manual do Proprietário - Bloco A"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    maxLength={255}
                    disabled={uploading}
                  />
                </div>

                <div className="enterprise-upload-field">
                  <label>Arquivo PDF (até 30 MB)</label>
                  <label className="enterprise-upload-dropzone">
                    <Upload size={24} style={{ color: '#176ca6' }} />
                    {uploadFile ? (
                      <div>
                        <strong style={{ fontSize: '11px', color: '#1e293b' }}>{uploadFile.name}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#64748b' }}>
                          {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB · Clique para trocar
                        </p>
                      </div>
                    ) : (
                      <div>
                        <strong style={{ fontSize: '11px', color: '#1e293b' }}>Clique para selecionar o PDF</strong>
                        <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#64748b' }}>
                          Projetos arquitetônicos, manuais, memoriais (até 30 MB)
                        </p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setUploadFile(file)
                          if (!uploadTitle.trim()) {
                            setUploadTitle(file.name.replace(/\.pdf$/i, ''))
                          }
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <footer className="enterprise-upload-modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeUploadModal}
                  disabled={uploading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={uploading || !uploadFile}
                >
                  {uploading ? 'Enviando PDF...' : 'Anexar Documento'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Visualizador de Mídia (MediaViewerModal) */}
      {viewerOpen && viewerItems.length > 0 && (
        <MediaViewerModal
          items={viewerItems}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}

      <p className="enterprise-readonly-note"><ShieldCheck size={14} /> Todos os usuários podem cadastrar e atualizar as informações dos empreendimentos.</p>
    </section>
  )
}

function EnterpriseEditForm({
  form,
  onUpdate,
  onSubmit,
  saving,
  onCancel,
  creating = false,
}: {
  form: EnterpriseForm
  onUpdate: <K extends keyof EnterpriseForm>(key: K, value: EnterpriseForm[K]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  saving: boolean
  onCancel: () => void
  creating?: boolean
}) {
  return (
    <form className="enterprise-edit-form" onSubmit={onSubmit}>
      <div className="enterprise-form-section">
        <h3>{creating ? 'Identificação e responsáveis' : 'Responsáveis atuais'}</h3>
        {creating && <label className="enterprise-name-field"><span>Nome do empreendimento *</span><input autoFocus required value={form.enterpriseName} maxLength={240} onChange={(event) => onUpdate('enterpriseName', event.target.value)} /></label>}
        <label><span>Nome do síndico</span><input value={form.syndicName} maxLength={160} onChange={(event) => onUpdate('syndicName', event.target.value)} /></label>
        <label><span>Telefone do síndico</span><input type="tel" value={form.syndicPhone} maxLength={40} onChange={(event) => onUpdate('syndicPhone', event.target.value)} /></label>
        <label><span>E-mail do síndico</span><input type="email" value={form.syndicEmail} maxLength={254} onChange={(event) => onUpdate('syndicEmail', event.target.value)} /></label>
        <label><span>Nome do supervisor</span><input value={form.supervisorName} maxLength={160} onChange={(event) => onUpdate('supervisorName', event.target.value)} /></label>
        <label><span>Telefone do supervisor</span><input type="tel" value={form.supervisorPhone} maxLength={40} onChange={(event) => onUpdate('supervisorPhone', event.target.value)} /></label>
        <label><span>E-mail do supervisor</span><input type="email" value={form.supervisorEmail} maxLength={254} onChange={(event) => onUpdate('supervisorEmail', event.target.value)} /></label>
        <label><span>E-mail do condomínio</span><input type="email" value={form.condominiumEmail} maxLength={254} onChange={(event) => onUpdate('condominiumEmail', event.target.value)} /></label>
        <label className="enterprise-address-field"><span>Endereço da obra (usado nas cartas)</span><textarea value={form.workAddress} maxLength={500} rows={3} onChange={(event) => onUpdate('workAddress', event.target.value)} /></label>
      </div>
      <div className="enterprise-form-section enterprise-dates-form">
        <h3>Datas do empreendimento</h3>
        <label><span>Emissão do habite-se</span><input type="date" value={form.occupancyPermitDate} onChange={(event) => onUpdate('occupancyPermitDate', event.target.value)} /></label>
        <label><span>Entrega do condomínio</span><input type="date" value={form.condominiumDeliveryDate} onChange={(event) => onUpdate('condominiumDeliveryDate', event.target.value)} /></label>
      </div>
      <div className="enterprise-form-section enterprise-status-form">
        <h3>Situação da obra (Controle de Estoque e Vistorias)</h3>
        <div className="enterprise-status-options">
          <label className={`enterprise-status-option ${form.workStatus === 'finished' ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="workStatus"
              value="finished"
              checked={form.workStatus === 'finished'}
              onChange={() => onUpdate('workStatus', 'finished')}
            />
            <div>
              <strong>Obra Finalizada / Concluída</strong>
              <small>Considerada entregue no estoque para controle de vistorias técnicas periódicas</small>
            </div>
          </label>
          <label className={`enterprise-status-option ${form.workStatus === 'in_progress' ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="workStatus"
              value="in_progress"
              checked={form.workStatus === 'in_progress'}
              onChange={() => onUpdate('workStatus', 'in_progress')}
            />
            <div>
              <strong>Obra em Andamento</strong>
              <small>Empreendimento ainda em fase de obras ou construção</small>
            </div>
          </label>
        </div>
      </div>
      <footer><button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}><Save size={14} />{saving ? 'Salvando...' : creating ? 'Cadastrar empreendimento' : 'Salvar informações'}</button></footer>
    </form>
  )
}
