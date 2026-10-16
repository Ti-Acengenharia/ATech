import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react'
import { apiRequest } from './api/client'

interface RoleOption {
  value: string
  label: string
}

const defaultRoleOptions: RoleOption[] = [
  { value: 'pedreiro', label: 'Pedreiro' },
  { value: 'ajudante', label: 'Ajudante' },
  { value: 'pintor', label: 'Pintor' },
  { value: 'eletricista', label: 'Eletricista' },
  { value: 'encanador', label: 'Encanador' },
  { value: 'fornecedor_terceirizado', label: 'Fornecedor terceirizado' },
  { value: 'analista', label: 'Analista' },
  { value: 'assistente', label: 'Assistente' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'encarregado', label: 'Encarregado' },
] as const

const genderOptions = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'outro', label: 'Outro' },
  { value: 'nao_informar', label: 'Prefere não informar' },
] as const

type CollaboratorRole = string
type CollaboratorGender = typeof genderOptions[number]['value']

interface Collaborator {
  id: string
  photo_url: string | null
  name: string
  nickname: string
  registration_number: string | null
  role: CollaboratorRole
  role_label: string
  age_years: number
  age_months: number
  age_days: number
  elapsed_years: number
  elapsed_months: number
  elapsed_days: number
  is_active: boolean
  is_on_leave: boolean
  programming_count: number
}

interface ChildRecord {
  name: string
  birthDate: string
  gender: CollaboratorGender
}

interface CollaboratorReport {
  id: string
  name: string
  nickname: string
  registrationNumber: string
  role: CollaboratorRole
  cpf: string
  phone: string
  gender: CollaboratorGender
  birthDate: string
  admissionDate: string
  terminationDate: string | null
  isOnLeave: boolean
  leaveStartDate: string | null
  expectedReturnDate: string | null
  leaveReason: string | null
  hasChildren: boolean
  children: ChildRecord[]
}

interface CollaboratorForm {
  name: string
  nickname: string
  registrationNumber: string
  role: CollaboratorRole
  cpf: string
  phone: string
  gender: CollaboratorGender
  birthDate: string
  admissionDate: string
  terminationDate: string
  isOnLeave: boolean
  leaveStartDate: string
  expectedReturnDate: string
  leaveReason: string
  hasChildren: boolean
  children: ChildRecord[]
}

function emptyForm(): CollaboratorForm {
  return {
    name: '',
    nickname: '',
    registrationNumber: '',
    role: 'pedreiro',
    cpf: '',
    phone: '',
    gender: 'nao_informar',
    birthDate: '',
    admissionDate: localDateString(new Date()),
    terminationDate: '',
    isOnLeave: false,
    leaveStartDate: '',
    expectedReturnDate: '',
    leaveReason: '',
    hasChildren: false,
    children: [],
  }
}

function cpfMask(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function formatCpf(value: string) {
  return cpfMask(value)
}

function formatDate(value: string | null) {
  if (!value) return 'Não informado'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function formatAge(person: Collaborator) {
  return `${person.age_years}a ${person.age_months}m ${person.age_days}d`
}

function formatElapsed(person: Collaborator) {
  return `${person.elapsed_years}a ${person.elapsed_months}m ${person.elapsed_days}d`
}

function roleLabel(value: CollaboratorRole, roles: RoleOption[], label?: string) {
  return label ?? roles.find((role) => role.value === value)?.label ?? value.replaceAll('_', ' ')
}

function dateForInput(value: string) {
  return value.slice(0, 10)
}

export default function CollaboratorsPage() {
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>(defaultRoleOptions)
  const [newRoleLabel, setNewRoleLabel] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(() => new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState<CollaboratorForm>(() => emptyForm())
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [report, setReport] = useState<CollaboratorReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const collaboratorGroups = Array.from(
    collaborators.reduce((groups, person) => {
      const group = groups.get(person.role) ?? {
        label: roleLabel(person.role, roleOptions, person.role_label),
        people: [] as Collaborator[],
      }
      group.people.push(person)
      groups.set(person.role, group)
      return groups
    }, new Map<string, { label: string; people: Collaborator[] }>()),
    ([key, group]) => ({ key, ...group }),
  ).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'))
  const collaboratorRows = collaboratorGroups.flatMap((group) => [
    <tr className="collaborator-role-divider" key={`role-${group.key}`}>
      <th colSpan={5}>
        {group.label}
        <span>{group.people.length} {group.people.length === 1 ? 'colaborador' : 'colaboradores'}</span>
        <button
          type="button"
          aria-expanded={!collapsedRoles.has(group.key)}
          onClick={() => setCollapsedRoles((current) => {
            const next = new Set(current)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })}
        >{collapsedRoles.has(group.key) ? 'Mostrar' : 'Recolher'}</button>
      </th>
    </tr>,
    ...(!collapsedRoles.has(group.key) ? group.people.map((person) => (
      <tr key={person.id}>
        <td><div className="collaborator-person">{person.photo_url ? <img className="collaborator-avatar collaborator-photo" src={person.photo_url} alt={`Foto de ${person.name}`} /> : <span className="collaborator-avatar">{person.name.trim().slice(0, 1).toUpperCase()}</span>}<span><strong>{person.name}</strong><small>{[person.nickname ? `“${person.nickname}”` : '', person.registration_number ? `Matrícula ${person.registration_number}` : ''].filter(Boolean).join(' · ') || 'Sem apelido ou matrícula'}</small></span></div></td>
        <td><span className="collaborator-role">{roleLabel(person.role, roleOptions, person.role_label)}</span></td>
        <td><span className="collaborator-age">{formatAge(person)}</span></td>
        <td><div className="collaborator-status-stack"><span className={`collaborator-status ${person.is_active ? 'is-active' : 'is-terminated'}`}><i />{person.is_active ? 'Ativo' : 'Desligado'} · {formatElapsed(person)}</span>{person.is_on_leave && <span className="collaborator-leave-status">Afastado</span>}</div></td>
        <td className="collaborator-actions"><button className="icon-button" type="button" title="Relatório com dados pessoais" aria-label={`Abrir relatório de ${person.name}`} onClick={() => void openReport(person.id)}><FileText size={16} /></button><button className="icon-button" type="button" title="Editar cadastro" aria-label={`Editar ${person.name}`} onClick={() => void openReport(person.id)}><Pencil size={16} /></button><button className="icon-button collaborator-delete-button" type="button" title="Excluir cadastro" aria-label={`Excluir ${person.name}`} disabled={deletingId === person.id} onClick={() => void deleteCollaborator(person.id, person.name)}><Trash2 size={16} /></button></td>
      </tr>
    )) : []),
  ])

  useEffect(() => {
    let cancelled = false
    apiRequest<{ roles: RoleOption[] }>('/api/collaborators/roles')
      .then((result) => { if (!cancelled) setRoleOptions(result.roles) })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar as funções.' })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ search, role: roleFilter, status: statusFilter })
      apiRequest<{ collaborators: Collaborator[] }>(`/api/collaborators?${params}`)
        .then((result) => { if (!cancelled) setCollaborators(result.collaborators) })
        .catch((error: unknown) => {
          if (!cancelled) setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar colaboradores.' })
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [search, roleFilter, statusFilter, refreshKey])

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setPhotoFile(null)
    setPhotoPreview(null)
    setNotice(null)
    setFormOpen(true)
  }

  async function openReport(id: string) {
    setReport(null)
    setReportOpen(true)
    setReportLoading(false)
    setEditingId(id)
  }

  async function revealReport() {
    if (!editingId) return
    setReportLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ report: CollaboratorReport }>(`/api/collaborators/${editingId}/report`)
      setReport(result.report)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível abrir o relatório.' })
      setReportOpen(false)
    } finally {
      setReportLoading(false)
    }
  }

  function editReport() {
    if (!report) return
    setForm({
      name: report.name,
      nickname: report.nickname,
      registrationNumber: report.registrationNumber,
      role: report.role,
      cpf: formatCpf(report.cpf),
      phone: report.phone,
      gender: report.gender,
      birthDate: dateForInput(report.birthDate),
      admissionDate: dateForInput(report.admissionDate),
      terminationDate: report.terminationDate ? dateForInput(report.terminationDate) : '',
      isOnLeave: report.isOnLeave,
      leaveStartDate: report.leaveStartDate ? dateForInput(report.leaveStartDate) : '',
      expectedReturnDate: report.expectedReturnDate ? dateForInput(report.expectedReturnDate) : '',
      leaveReason: report.leaveReason ?? '',
      hasChildren: report.hasChildren,
      children: report.children.map((child) => ({ ...child, birthDate: dateForInput(child.birthDate) })),
    })
    setPhotoFile(null)
    setPhotoPreview(collaborators.find((person) => person.id === report.id)?.photo_url ?? null)
    setReportOpen(false)
    setReport(null)
    setFormOpen(true)
  }

  function closeReport() {
    setReportOpen(false)
    setReport(null)
    setEditingId(null)
  }

  async function deleteCollaborator(id: string, name: string) {
    const collaborator = collaborators.find((person) => person.id === id)
    const scheduleWarning = collaborator?.programming_count
      ? `\n\nAs ${collaborator.programming_count} programação(ões) vinculada(s) também serão removidas da agenda. O histórico dos chamados será preservado.`
      : ''
    if (!window.confirm(`Excluir permanentemente o cadastro de ${name}? Os dados pessoais e foto serão removidos.${scheduleWarning}`)) return

    setDeletingId(id)
    setNotice(null)
    try {
      await apiRequest(`/api/collaborators/${id}`, { method: 'DELETE' })
      setReportOpen(false)
      setReport(null)
      setFormOpen(false)
      setEditingId(null)
      setNotice({ kind: 'success', text: `Cadastro de ${name} excluído. O histórico dos chamados foi mantido.` })
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível excluir o colaborador.' })
    } finally {
      setDeletingId(null)
    }
  }

  function updateField<K extends keyof CollaboratorForm>(field: K, value: CollaboratorForm[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function createRole() {
    const label = newRoleLabel.trim()
    if (label.length < 2) {
      setNotice({ kind: 'error', text: 'Informe um nome de função com pelo menos 2 caracteres.' })
      return
    }
    setSavingRole(true)
    setNotice(null)
    try {
      const result = await apiRequest<{ role: RoleOption }>('/api/collaborators/roles', {
        method: 'POST',
        body: JSON.stringify({ label }),
      })
      setRoleOptions((current) => [...current, result.role].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')))
      updateField('role', result.role.value)
      setNewRoleLabel('')
      setNotice({ kind: 'success', text: `Função “${result.role.label}” cadastrada e selecionada.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível cadastrar a função.' })
    } finally {
      setSavingRole(false)
    }
  }

  function updateChild(index: number, field: keyof ChildRecord, value: string) {
    setForm((current) => ({
      ...current,
      children: current.children.map((child, childIndex) => childIndex === index ? { ...child, [field]: value } : child),
    }))
  }

  async function saveCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setNotice(null)

    const payload = {
      ...form,
      cpf: form.cpf.replace(/\D/g, ''),
      terminationDate: form.terminationDate || null,
      leaveStartDate: form.isOnLeave ? form.leaveStartDate || null : null,
      expectedReturnDate: form.isOnLeave ? form.expectedReturnDate || null : null,
      leaveReason: form.isOnLeave ? form.leaveReason || null : null,
      children: form.hasChildren ? form.children : [],
    }

    try {
      let collaboratorId = editingId
      if (editingId) {
        await apiRequest(`/api/collaborators/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        const created = await apiRequest<{ id: string }>('/api/collaborators', { method: 'POST', body: JSON.stringify(payload) })
        collaboratorId = created.id
      }
      if (photoFile && collaboratorId) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto.'))
          reader.onerror = () => reject(new Error('Não foi possível ler a foto.'))
          reader.readAsDataURL(photoFile)
        })
        await apiRequest(`/api/collaborators/${collaboratorId}/photo`, {
          method: 'PUT',
          body: JSON.stringify({ contentType: photoFile.type, contentBase64: dataUrl.split(',')[1] }),
        })
      }
      setFormOpen(false)
      setReportOpen(false)
      setReport(null)
      setEditingId(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setNotice({ kind: 'success', text: editingId ? 'Cadastro atualizado.' : 'Colaborador cadastrado.' })
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o cadastro.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="collaborators-page" aria-labelledby="collaborators-title">
      {!formOpen && !reportOpen && <>
      <div className="collaborators-heading">
        <div>
          <span className="eyebrow">EQUIPE DA ASSISTÊNCIA TÉCNICA</span>
          <h1 id="collaborators-title">Colaboradores</h1>
          <p>Cadastro e situação da equipe própria e terceirizada.</p>
        </div>
        <button className="primary-button collaborator-add" type="button" onClick={startCreate}><Plus size={17} /> Novo colaborador</button>
      </div>

      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

      <div className="collaborator-filters">
        <label className="search-box collaborator-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou apelido" aria-label="Pesquisar por nome ou apelido" /></label>
        <label className="filter-control"><span>Função</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">Todas</option>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
        <label className="filter-control"><span>Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todas</option><option value="active">Ativos</option><option value="terminated">Desligados</option></select></label>
      </div>

      <div className="collaborator-list-header"><span><UsersRound size={15} /> {loading ? 'Carregando equipe...' : `${collaborators.length} ${collaborators.length === 1 ? 'colaborador' : 'colaboradores'}`}</span><span>Dados pessoais restritos</span></div>
      <div className="collaborator-table-wrap">
        <table className="collaborator-table">
          <thead><tr><th>COLABORADOR</th><th>FUNÇÃO</th><th>IDADE</th><th>SITUAÇÃO</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {loading && collaborators.length === 0 ? <tr><td colSpan={5} className="collaborator-empty">Carregando colaboradores...</td></tr> : collaborators.length === 0 ? <tr><td colSpan={5} className="collaborator-empty"><UserPlus size={22} /><strong>Nenhum colaborador encontrado</strong><span>Cadastre uma pessoa ou ajuste os filtros.</span></td></tr> : collaboratorRows}
          </tbody>
        </table>
      </div>
      <p className="collaborator-privacy-note"><ShieldAlert size={15} /> CPF, telefone e dados dos filhos não aparecem nesta lista. O relatório registra cada visualização.</p>
      </>}

      {reportOpen && (
          <section className="full-page-data report-dialog" role="region" aria-labelledby="report-title">
            <header className="dialog-header"><div><span className="eyebrow">RELATÓRIO INDIVIDUAL</span><h2 id="report-title">{report ? report.name : 'Acesso a dados pessoais'}</h2></div><button className="secondary-button page-back-button" type="button" onClick={closeReport}><ArrowLeft size={16} /> Voltar para colaboradores</button></header>
            {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
            {!report ? (
              <div className="report-warning"><span className="report-warning-icon"><ShieldAlert size={22} /></span><h3>Este relatório contém dados pessoais</h3><p>CPF, telefone, nascimento, filhos e motivo de afastamento são dados pessoais. Ao continuar, o acesso será registrado para fins de auditoria.</p><div className="report-warning-actions"><button className="secondary-button" type="button" onClick={closeReport}>Cancelar</button><button className="primary-button" type="button" onClick={() => void revealReport()} disabled={reportLoading}>{reportLoading ? 'Carregando...' : 'Confirmar e visualizar'}</button></div></div>
            ) : (
              <>
                <div className="report-data-warning"><ShieldAlert size={16} /><span>Contém dados pessoais. Compartilhe apenas quando necessário.</span></div>
                <dl className="report-grid">
                  <div><dt>Nome</dt><dd>{report.name}</dd></div><div><dt>Apelido</dt><dd>{report.nickname || 'Não informado'}</dd></div>
                  <div><dt>Matrícula</dt><dd>{report.registrationNumber || 'Não informada'}</dd></div>
                  <div><dt>Função</dt><dd>{roleLabel(report.role, roleOptions)}</dd></div><div><dt>CPF · dado pessoal</dt><dd className="sensitive-value">{report.cpf ? formatCpf(report.cpf) : 'Não informado'}</dd></div>
                  <div><dt>Telefone · dado pessoal</dt><dd className="sensitive-value">{report.phone || 'Não informado'}</dd></div><div><dt>Gênero</dt><dd>{genderOptions.find((gender) => gender.value === report.gender)?.label ?? report.gender}</dd></div>
                  <div><dt>Data de nascimento</dt><dd>{formatDate(report.birthDate)}</dd></div><div><dt>Data de admissão</dt><dd>{formatDate(report.admissionDate)}</dd></div>
                  <div><dt>Data de desligamento</dt><dd>{formatDate(report.terminationDate)}</dd></div>
                  <div><dt>Situação</dt><dd>{report.terminationDate ? 'Desligado' : report.isOnLeave ? 'Atualmente afastado' : 'Ativo'}</dd></div>
                  {report.isOnLeave && <><div><dt>Data do afastamento</dt><dd>{formatDate(report.leaveStartDate)}</dd></div><div><dt>Retorno previsto</dt><dd>{formatDate(report.expectedReturnDate)}</dd></div><div className="report-children"><dt>Motivo do afastamento</dt><dd>{report.leaveReason}</dd></div></>}
                  <div className="report-children"><dt>Filhos</dt><dd>{report.hasChildren ? report.children.map((child, index) => <span className="report-child" key={`${child.name}-${index}`}>{child.name} · {formatDate(child.birthDate)} · {genderOptions.find((gender) => gender.value === child.gender)?.label ?? 'Não informado'}</span>) : 'Não'}</dd></div>
                </dl>
                <footer className="dialog-footer"><button className="secondary-button danger-button" type="button" disabled={deletingId === report.id} onClick={() => void deleteCollaborator(report.id, report.name)}><Trash2 size={15} />{deletingId === report.id ? 'Excluindo...' : 'Excluir colaborador'}</button><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir relatório</button><button className="secondary-button" type="button" onClick={editReport}><Pencil size={15} /> Editar cadastro</button><button className="primary-button" type="button" onClick={closeReport}>Concluir</button></footer>
              </>
            )}
          </section>
      )}

      {formOpen && (
          <section className="full-page-data collaborator-form-dialog" aria-labelledby="form-title">
            <header className="dialog-header"><div><span className="eyebrow">CADASTRO DA EQUIPE</span><h2 id="form-title">{editingId ? 'Editar colaborador' : 'Novo colaborador'}</h2></div><button className="secondary-button page-back-button" type="button" onClick={() => setFormOpen(false)}><ArrowLeft size={16} /> Voltar para lista</button></header>
            {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}</span>{notice.text}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
            <form onSubmit={(event) => void saveCollaborator(event)}>
              <div className="collaborator-form-grid">
                <label className="form-field form-field-wide"><span>Nome completo *</span><input autoComplete="name" maxLength={160} value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
                <div className="form-field form-field-wide collaborator-photo-field">
                  <span>Foto do colaborador <small>JPEG, PNG ou WebP · até 2 MiB</small></span>
                  <div className="collaborator-photo-input">
                    {photoPreview ? <img className="collaborator-photo-preview" src={photoPreview} alt="Prévia da foto do colaborador" /> : <span className="collaborator-photo-preview collaborator-photo-placeholder">{form.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
                    <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Selecionar foto do colaborador" onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      if (!file) return
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
                        setNotice({ kind: 'error', text: 'Selecione uma foto JPEG, PNG ou WebP de até 2 MiB.' })
                        event.target.value = ''
                        return
                      }
                      setPhotoFile(file)
                      setPhotoPreview(URL.createObjectURL(file))
                    }} />
                  </div>
                </div>
                <label className="form-field"><span>Matrícula</span><input maxLength={80} value={form.registrationNumber} onChange={(event) => updateField('registrationNumber', event.target.value)} /></label>
                <label className="form-field"><span>Apelido</span><input maxLength={80} value={form.nickname} onChange={(event) => updateField('nickname', event.target.value)} /></label>
                <label className="form-field"><span>Função *</span><select value={form.role} onChange={(event) => updateField('role', event.target.value)}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                <div className="form-field form-field-wide role-creation">
                  <span>Adicionar uma função à plataforma</span>
                  <div className="role-creation-controls">
                    <input maxLength={80} value={newRoleLabel} onChange={(event) => setNewRoleLabel(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createRole()
                      }
                    }} placeholder="Ex.: Técnico de refrigeração" aria-label="Nome da nova função" />
                    <button className="secondary-button" type="button" onClick={() => void createRole()} disabled={savingRole || newRoleLabel.trim().length < 2}><Plus size={15} />{savingRole ? 'Salvando...' : 'Cadastrar função'}</button>
                  </div>
                </div>
                <label className="form-field"><span>CPF <small>opcional · criptografado</small></span><input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000.000.000-00" value={form.cpf} onChange={(event) => updateField('cpf', cpfMask(event.target.value))} /></label>
                <label className="form-field"><span>Telefone <small>opcional · criptografado</small></span><input type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
                <label className="form-field"><span>Gênero *</span><select value={form.gender} onChange={(event) => updateField('gender', event.target.value as CollaboratorGender)}>{genderOptions.map((gender) => <option key={gender.value} value={gender.value}>{gender.label}</option>)}</select></label>
                <label className="form-field"><span>Data de nascimento *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.birthDate} onChange={(event) => updateField('birthDate', event.target.value)} required /></span></label>
                <label className="form-field"><span>Data de admissão *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.admissionDate} onChange={(event) => updateField('admissionDate', event.target.value)} required /></span></label>
                <label className="form-field"><span>Data de desligamento</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.terminationDate} onChange={(event) => updateField('terminationDate', event.target.value)} /></span></label>
                <label className="children-toggle leave-toggle"><input type="checkbox" checked={form.isOnLeave} onChange={(event) => setForm((current) => ({ ...current, isOnLeave: event.target.checked, leaveStartDate: event.target.checked ? current.leaveStartDate : '', expectedReturnDate: event.target.checked ? current.expectedReturnDate : '', leaveReason: event.target.checked ? current.leaveReason : '' }))} /><span>Colaborador afastado</span></label>
                {form.isOnLeave && <>
                  <label className="form-field"><span>Data do afastamento *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.leaveStartDate} onChange={(event) => updateField('leaveStartDate', event.target.value)} required /></span></label>
                  <label className="form-field"><span>Data prevista do retorno *</span><span className="date-input-wrap"><CalendarDays size={15} /><input type="date" value={form.expectedReturnDate} onChange={(event) => updateField('expectedReturnDate', event.target.value)} required /></span></label>
                  <label className="form-field form-field-wide"><span>Motivo do afastamento *</span><textarea maxLength={2000} rows={3} value={form.leaveReason} onChange={(event) => updateField('leaveReason', event.target.value)} required /></label>
                </>}
                <label className="children-toggle"><input type="checkbox" checked={form.hasChildren} onChange={(event) => setForm((current) => ({ ...current, hasChildren: event.target.checked, children: event.target.checked ? current.children : [] }))} /><span>O colaborador tem filhos</span></label>
              </div>

              {form.hasChildren && <section className="children-editor" aria-label="Cadastro de filhos"><div className="children-editor-heading"><div><h3>Filhos</h3><p>Nome, nascimento e gênero</p></div><button className="secondary-button add-child-button" type="button" onClick={() => setForm((current) => ({ ...current, children: [...current.children, { name: '', birthDate: '', gender: 'nao_informar' }] }))}><Plus size={15} /> Adicionar filho</button></div>
                {form.children.map((child, index) => <div className="child-form-row" key={index}><label className="form-field"><span>Nome *</span><input value={child.name} onChange={(event) => updateChild(index, 'name', event.target.value)} required /></label><label className="form-field"><span>Nascimento *</span><input type="date" value={child.birthDate} onChange={(event) => updateChild(index, 'birthDate', event.target.value)} required /></label><label className="form-field"><span>Gênero *</span><select value={child.gender} onChange={(event) => updateChild(index, 'gender', event.target.value as CollaboratorGender)}>{genderOptions.map((gender) => <option key={gender.value} value={gender.value}>{gender.label}</option>)}</select></label><button className="icon-button child-remove" type="button" title="Remover filho" aria-label={`Remover filho ${index + 1}`} onClick={() => setForm((current) => ({ ...current, children: current.children.filter((_, childIndex) => childIndex !== index) }))}><Trash2 size={16} /></button></div>)}
                {form.children.length === 0 && <p className="children-empty">Adicione ao menos um filho ou desmarque a opção.</p>}
              </section>}

              <div className="form-privacy-note"><ShieldAlert size={15} /><span>CPF, telefone e dados dos filhos são opcionais e, quando informados, ficam criptografados. CPF e telefone só aparecem no relatório auditado.</span></div>
              {notice?.kind === 'error' && <p className="form-error" role="alert">{notice.text}</p>}
              <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar colaborador'}</button></footer>
            </form>
          </section>
      )}
    </section>
  )
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}