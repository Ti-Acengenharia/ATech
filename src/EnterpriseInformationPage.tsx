import { useEffect, useState, type FormEvent } from 'react'
import { Building2, CalendarDays, Check, CircleAlert, Mail, MapPin, Pencil, Phone, Plus, Save, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { apiRequest } from './api/client'

interface EnterpriseInformation {
  enterprise_key: string
  enterprise_name: string
  ticket_count: number
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

interface EnterpriseForm {
  enterpriseName: string
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
    return matchesSearch && matchesDelivery
  })

  return (
    <section className="enterprise-information-page">
      <header className="enterprise-page-heading">
        <span className="enterprise-heading-mark"><Building2 size={21} /></span>
        <div><span className="eyebrow">CADASTRO DOS CONDOMÍNIOS</span><h1>Informações dos empreendimentos</h1><p>Lista única gerada a partir dos empreendimentos encontrados nos chamados.</p></div>
        <span className="enterprise-count-badge">{enterprises.length} {enterprises.length === 1 ? 'empreendimento' : 'empreendimentos'}</span>
        <button className="primary-button enterprise-create-button" type="button" onClick={startCreate}><Plus size={15} /> Cadastrar empreendimento</button>
      </header>
      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
      {creating && form && <article className="enterprise-card enterprise-card-editing enterprise-create-card">
        <header className="enterprise-card-heading"><span className="enterprise-card-icon"><Building2 size={18} /></span><div><h2>Novo empreendimento</h2><span>Preencha o nome e os dados que já tiver disponíveis.</span></div><button type="button" className="icon-button enterprise-cancel-create" aria-label="Cancelar cadastro" onClick={cancelEdit}><X size={16} /></button></header>
        <EnterpriseEditForm form={form} onUpdate={update} onSubmit={(event) => void save(event)} saving={saving} onCancel={cancelEdit} creating />
      </article>}
      {!loading && enterprises.length > 0 && <div className="enterprise-filters">
        <label className="search-box"><Search size={15} /><input type="search" placeholder="Buscar empreendimento, síndico, supervisor ou contato" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label><span>Entrega do condomínio</span><select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value as typeof deliveryFilter)}>
          <option value="all">Todas as datas</option>
          <option value="delivered">Já entregue</option>
          <option value="planned">Entrega prevista</option>
          <option value="missing">Sem data informada</option>
        </select></label>
        <span className="enterprise-filter-count">{filteredEnterprises.length} de {enterprises.length}</span>
        <button className="filter-clear-button" type="button" disabled={!search && deliveryFilter === 'all'} onClick={() => { setSearch(''); setDeliveryFilter('all') }}><X size={14} /> Limpar filtros</button>
      </div>}
      {loading ? <div className="enterprise-empty-state">Carregando empreendimentos...</div> : enterprises.length === 0 ? (
        <div className="enterprise-empty-state"><Building2 size={28} /><strong>Nenhum empreendimento encontrado</strong><span>Os empreendimentos serão listados assim que estiverem presentes nos chamados.</span></div>
      ) : (
        <div className="enterprise-list">
          {filteredEnterprises.map((enterprise) => {
            const duration = deliveredDuration(enterprise.condominium_delivery_date, now)
            const isEditing = editing === enterprise.enterprise_key && form !== null
            return (
              <article className={`enterprise-card ${isEditing ? 'enterprise-card-editing' : ''}`} key={enterprise.enterprise_key}>
                <header className="enterprise-card-heading">
                  <span className="enterprise-card-icon"><Building2 size={18} /></span>
                  <div><h2>{enterprise.enterprise_name}</h2><span>{enterprise.ticket_count} {enterprise.ticket_count === 1 ? 'chamado registrado' : 'chamados registrados'}</span></div>
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
                  </>
                )}
              </article>
            )
          })}
          {!filteredEnterprises.length && <div className="enterprise-empty-state"><Search size={24} /><strong>Nenhum empreendimento corresponde aos filtros</strong><span>Altere os termos ou limpe os filtros para ver os empreendimentos.</span></div>}
        </div>
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
      <footer><button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}><Save size={14} />{saving ? 'Salvando...' : creating ? 'Cadastrar empreendimento' : 'Salvar informações'}</button></footer>
    </form>
  )
}
