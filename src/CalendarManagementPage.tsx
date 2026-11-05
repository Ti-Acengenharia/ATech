import { useCallback, useEffect, useState, useTransition, type FormEvent } from 'react'
import {
  CalendarCheck2,
  CalendarX2,
  Check,
  CircleAlert,
  Clock,
  Download,
  FileSpreadsheet,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { apiRequest } from './api/client'
import { useLiveSync } from './api/liveSync'
import './CalendarManagementPage.css'

export interface CalendarItem {
  id: string
  date: string
  description: string
  type: 'holiday' | 'work_saturday'
  createdAt: string
  createdByName: string | null
}

export interface WorkingHours {
  monday_thursday: { start: string; end: string }
  friday: { start: string; end: string }
  work_saturday: { start: string; end: string }
}

interface CalendarResponse {
  holidays: CalendarItem[]
  workSaturdays: CalendarItem[]
  workingHours: WorkingHours
}

const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday_thursday: { start: '08:00', end: '18:00' },
  friday: { start: '08:00', end: '17:00' },
  work_saturday: { start: '08:00', end: '18:00' },
}

function formatDateBr(isoDate: string): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

function getDayOfWeekLabel(isoDate: string): string {
  if (!isoDate) return ''
  const dt = new Date(`${isoDate}T12:00:00Z`)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(dt)
}

export default function CalendarManagementPage() {
  const [holidays, setHolidays] = useState<CalendarItem[]>([])
  const [workSaturdays, setWorkSaturdays] = useState<CalendarItem[]>([])
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS)
  const [loading, setLoading] = useState(true)
  const [savingHours, setSavingHours] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Filtros de feriados
  const [holidaySearch, setHolidaySearch] = useState('')
  const [selectedYear, setSelectedYear] = useState<string>('all')

  // Cadastro individual de feriado
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayDesc, setNewHolidayDesc] = useState('')
  const [creatingHoliday, setCreatingHoliday] = useState(false)

  // Cadastro de sábado trabalhado
  const [newSatDate, setNewSatDate] = useState('')
  const [newSatDesc, setNewSatDesc] = useState('')
  const [creatingSat, setCreatingSat] = useState(false)

  // Modal CSV
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [csvFileContent, setCsvFileContent] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [csvParsedPreview, setCsvParsedPreview] = useState<Array<{ date: string; description: string }>>([])
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const [importingCsv, setImportingCsv] = useState(false)

  const [, startTransition] = useTransition()
  const [todayIso] = useState(() => new Date().toISOString().slice(0, 10))

  const loadCalendar = useCallback(async () => {
    try {
      const data = await apiRequest<CalendarResponse>('/api/calendar')
      startTransition(() => {
        setHolidays(data.holidays || [])
        setWorkSaturdays(data.workSaturdays || [])
        if (data.workingHours) {
          setWorkingHours(data.workingHours)
        }
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Não foi possível carregar os dados de calendário.',
      })
    } finally {
      setLoading(false)
    }
  }, [startTransition])

  useEffect(() => {
    let cancelled = false
    apiRequest<CalendarResponse>('/api/calendar')
      .then((data) => {
        if (cancelled) return
        startTransition(() => {
          setHolidays(data.holidays || [])
          setWorkSaturdays(data.workSaturdays || [])
          if (data.workingHours) {
            setWorkingHours(data.workingHours)
          }
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Não foi possível carregar os dados de calendário.',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [startTransition])

  useLiveSync(['settings'], () => {
    void loadCalendar()
  })

  // Salvar Jornada de Trabalho
  async function handleSaveWorkingHours(e: FormEvent) {
    e.preventDefault()
    setSavingHours(true)
    setNotice(null)
    try {
      await apiRequest('/api/calendar/working-hours', {
        method: 'PUT',
        body: JSON.stringify(workingHours),
      })
      setNotice({ kind: 'success', text: 'Jornada de trabalho atualizada com sucesso.' })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar horários de trabalho.',
      })
    } finally {
      setSavingHours(false)
    }
  }

  // Cadastrar Feriado Manual
  async function handleAddHoliday(e: FormEvent) {
    e.preventDefault()
    if (!newHolidayDate || !newHolidayDesc.trim()) return
    setCreatingHoliday(true)
    setNotice(null)
    try {
      await apiRequest('/api/calendar', {
        method: 'POST',
        body: JSON.stringify({
          date: newHolidayDate,
          type: 'holiday',
          description: newHolidayDesc.trim(),
        }),
      })
      setNewHolidayDate('')
      setNewHolidayDesc('')
      setNotice({ kind: 'success', text: 'Feriado cadastrado com sucesso.' })
      await loadCalendar()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao cadastrar feriado.',
      })
    } finally {
      setCreatingHoliday(false)
    }
  }

  // Cadastrar Sábado Trabalhado (Compensação)
  async function handleAddWorkSaturday(e: FormEvent) {
    e.preventDefault()
    if (!newSatDate || !newSatDesc.trim()) return
    const dt = new Date(`${newSatDate}T12:00:00Z`)
    if (dt.getUTCDay() !== 6) {
      setNotice({ kind: 'error', text: 'A data selecionada não cai em um sábado.' })
      return
    }

    setCreatingSat(true)
    setNotice(null)
    try {
      await apiRequest('/api/calendar', {
        method: 'POST',
        body: JSON.stringify({
          date: newSatDate,
          type: 'work_saturday',
          description: newSatDesc.trim(),
        }),
      })
      setNewSatDate('')
      setNewSatDesc('')
      setNotice({ kind: 'success', text: 'Sábado trabalhado (compensação) cadastrado com sucesso.' })
      await loadCalendar()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao cadastrar sábado trabalhado.',
      })
    } finally {
      setCreatingSat(false)
    }
  }

  // Excluir Item do Calendário
  async function handleDeleteItem(item: CalendarItem) {
    const isHoliday = item.type === 'holiday'
    const label = isHoliday ? 'o feriado' : 'o sábado trabalhado'
    if (!window.confirm(`Deseja realmente remover ${label} de ${formatDateBr(item.date)} (${item.description})?`)) {
      return
    }

    setNotice(null)
    try {
      await apiRequest(`/api/calendar/${item.id}`, { method: 'DELETE' })
      setNotice({ kind: 'success', text: 'Registro removido com sucesso.' })
      await loadCalendar()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao remover registro.',
      })
    }
  }

  // Baixar Modelo CSV
  function handleDownloadCsvTemplate() {
    const header = 'data,descricao\n'
    const currentYear = new Date().getFullYear()
    const rows = [
      `${currentYear}-01-01,Confraternização Universal`,
      `${currentYear}-04-21,Tiradentes`,
      `${currentYear}-05-01,Dia do Trabalho`,
      `${currentYear}-09-07,Independência do Brasil`,
      `${currentYear}-10-12,Nossa Senhora Aparecida`,
      `${currentYear}-11-02,Finados`,
      `${currentYear}-11-15,Proclamação da República`,
      `${currentYear}-11-20,Dia da Consciência Negra`,
      `${currentYear}-12-25,Natal`,
    ].join('\n')

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `modelo_feriados_atech_${currentYear}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Selecionar e Pré-visualizar Arquivo CSV
  function handleSelectCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)
    setCsvErrors([])

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = String(event.target?.result || '')
      setCsvFileContent(text)

      // Pré-visualização simples no cliente
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const preview: Array<{ date: string; description: string }> = []
      const errs: string[] = []

      let startIndex = 0
      if (lines.length && (lines[0].toLowerCase().includes('data') || lines[0].toLowerCase().includes('date') || lines[0].toLowerCase().includes('feriado'))) {
        startIndex = 1
      }

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i]
        const delimiter = line.includes(';') ? ';' : ','
        const parts = line.split(delimiter).map((p) => p.trim().replace(/^["']|["']$/g, ''))
        if (!parts[0]) continue

        let isoDate: string | null = null
        // YYYY-MM-DD
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(parts[0])) {
          const [y, m, d] = parts[0].split(/[-/]/)
          isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(parts[0])) {
          const [d, m, y] = parts[0].split(/[-/]/)
          isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        }

        if (isoDate) {
          preview.push({ date: isoDate, description: parts[1] || 'Feriado' })
        } else {
          errs.push(`Linha ${i + 1}: Data inválida "${parts[0]}"`)
        }
      }

      setCsvParsedPreview(preview)
      setCsvErrors(errs)
    }
    reader.readAsText(file)
  }

  // Confirmar Importação CSV
  async function handleConfirmCsvImport() {
    if (!csvFileContent.trim()) return
    setImportingCsv(true)
    setNotice(null)
    try {
      const res = await apiRequest<{ success: boolean; importedCount: number; errors: string[] }>('/api/calendar/upload-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText: csvFileContent }),
      })
      setShowCsvModal(false)
      setCsvFileContent('')
      setCsvFileName('')
      setCsvParsedPreview([])
      setCsvErrors([])
      setNotice({
        kind: 'success',
        text: `${res.importedCount} feriado(s) importado(s) com sucesso.`,
      })
      await loadCalendar()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha na importação do arquivo CSV.',
      })
    } finally {
      setImportingCsv(false)
    }
  }

  // Filtragem de feriados
  const years = Array.from(new Set(holidays.map((h) => h.date.slice(0, 4)))).sort()
  const filteredHolidays = holidays.filter((h) => {
    if (selectedYear !== 'all' && h.date.slice(0, 4) !== selectedYear) return false
    if (holidaySearch.trim()) {
      const q = holidaySearch.toLowerCase().trim()
      const descMatch = h.description.toLowerCase().includes(q)
      const dateMatch = formatDateBr(h.date).includes(q)
      return descMatch || dateMatch
    }
    return true
  })

  return (
    <div className="calendar-mgmt-page">
      <header className="calendar-mgmt-header">
        <span className="eyebrow">ADMINISTRAÇÃO & EXPEDIENTE</span>
        <h1>Expediente e Calendário</h1>
        <p>
          Configure os horários de trabalho da assistência técnica, cadastre feriados para bloqueio de agenda e autorize
          sábados trabalhados para compensações.
        </p>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span className="notice-symbol">
            {notice.kind === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}
          </span>
          {notice.text}
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {/* CARD 1: JORNADA DE TRABALHO (HORAS ÚTEIS) */}
      <section className="calendar-mgmt-card" aria-labelledby="hours-title">
        <header className="calendar-mgmt-card-header">
          <div className="calendar-mgmt-card-title">
            <Clock size={20} />
            <div>
              <h2 id="hours-title">Jornada de Trabalho (Horas Úteis)</h2>
              <p>Define a janela permitida para agendamentos e cálculo de horários livres em comum.</p>
            </div>
          </div>
        </header>

        <form onSubmit={handleSaveWorkingHours}>
          <div className="working-hours-grid">
            {/* Seg a Qui */}
            <div className="working-hours-box">
              <div className="working-hours-box-header">
                <strong>Segunda a Quinta-feira</strong>
                <span className="working-hours-badge">Padrão</span>
              </div>
              <div className="working-hours-inputs">
                <label>
                  Início
                  <input
                    type="time"
                    value={workingHours.monday_thursday.start}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        monday_thursday: { ...prev.monday_thursday, start: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
                <span className="working-hours-separator">às</span>
                <label>
                  Término
                  <input
                    type="time"
                    value={workingHours.monday_thursday.end}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        monday_thursday: { ...prev.monday_thursday, end: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
              </div>
            </div>

            {/* Sextas-feiras */}
            <div className="working-hours-box">
              <div className="working-hours-box-header">
                <strong>Sexta-feira</strong>
                <span className="working-hours-badge badge-friday">Até às 17h</span>
              </div>
              <div className="working-hours-inputs">
                <label>
                  Início
                  <input
                    type="time"
                    value={workingHours.friday.start}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        friday: { ...prev.friday, start: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
                <span className="working-hours-separator">às</span>
                <label>
                  Término
                  <input
                    type="time"
                    value={workingHours.friday.end}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        friday: { ...prev.friday, end: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
              </div>
            </div>

            {/* Sábados Trabalhados */}
            <div className="working-hours-box">
              <div className="working-hours-box-header">
                <strong>Sábados Trabalhados (Compensações)</strong>
                <span className="working-hours-badge badge-saturday">Compensação</span>
              </div>
              <div className="working-hours-inputs">
                <label>
                  Início
                  <input
                    type="time"
                    value={workingHours.work_saturday.start}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        work_saturday: { ...prev.work_saturday, start: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
                <span className="working-hours-separator">às</span>
                <label>
                  Término
                  <input
                    type="time"
                    value={workingHours.work_saturday.end}
                    onChange={(e) =>
                      setWorkingHours((prev) => ({
                        ...prev,
                        work_saturday: { ...prev.work_saturday, end: e.target.value },
                      }))
                    }
                    required
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="working-hours-actions">
            <button className="primary-button" type="submit" disabled={savingHours}>
              <Save size={15} /> {savingHours ? 'Salvando...' : 'Salvar jornada de trabalho'}
            </button>
          </div>
        </form>
      </section>

      {/* CARD 2: FERIADOS (BLOQUEIO DE AGENDA) */}
      <section className="calendar-mgmt-card" aria-labelledby="holidays-title">
        <header className="calendar-mgmt-card-header">
          <div className="calendar-mgmt-card-title">
            <CalendarX2 size={20} />
            <div>
              <h2 id="holidays-title">Feriados (Bloqueio Automático de Agenda)</h2>
              <p>Feriados impedem novos agendamentos e sinalizam bloqueio na agenda dos colaboradores.</p>
            </div>
          </div>
          <div className="calendar-action-btns">
            <button className="secondary-button" type="button" onClick={handleDownloadCsvTemplate} title="Baixar modelo de planilha CSV para preencher e importar">
              <Download size={14} /> Baixar modelo CSV
            </button>
            <button className="primary-button" type="button" onClick={() => setShowCsvModal(true)} title="Subir arquivo CSV de feriados">
              <Upload size={14} /> Subir modelo CSV
            </button>
          </div>
        </header>

        {/* Cadastro manual rápido de feriado */}
        <form className="calendar-inline-form" onSubmit={handleAddHoliday}>
          <label className="calendar-form-field">
            <span>Data do feriado</span>
            <input
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              required
            />
          </label>
          <label className="calendar-form-field" style={{ flex: '2 1 280px' }}>
            <span>Nome / Descrição do feriado</span>
            <input
              type="text"
              placeholder="Ex: Proclamação da República, Consciência Negra..."
              value={newHolidayDesc}
              onChange={(e) => setNewHolidayDesc(e.target.value)}
              maxLength={255}
              required
            />
          </label>
          <button className="secondary-button" type="submit" disabled={creatingHoliday}>
            <Plus size={15} /> {creatingHoliday ? 'Cadastrando...' : 'Adicionar feriado'}
          </button>
        </form>

        {/* Barra de Filtro de Feriados */}
        <div className="calendar-action-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Ano:</span>
            <select
              style={{ height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', padding: '0 8px' }}
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="all">Todos os anos ({holidays.length})</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} ({holidays.filter((h) => h.date.startsWith(y)).length})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Search size={14} style={{ color: '#94a3b8' }} />
            <input
              type="search"
              placeholder="Buscar feriado..."
              value={holidaySearch}
              onChange={(e) => setHolidaySearch(e.target.value)}
              style={{ height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '12px', width: '200px' }}
            />
          </div>
        </div>

        {/* Tabela de Feriados */}
        <div className="calendar-table-wrap">
          <table className="calendar-table">
            <thead>
              <tr>
                <th style={{ width: '190px' }}>DATA DO FERIADO</th>
                <th>DESCRIÇÃO / NOME</th>
                <th style={{ width: '180px' }}>CADASTRADO POR</th>
                <th style={{ width: '60px', textAlign: 'center' }}>AÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="calendar-empty-row">Carregando feriados...</td>
                </tr>
              ) : filteredHolidays.length === 0 ? (
                <tr>
                  <td colSpan={4} className="calendar-empty-row">
                    {holidays.length ? 'Nenhum feriado corresponde à busca.' : 'Nenhum feriado cadastrado ainda. Use o formulário acima ou suba um arquivo CSV.'}
                  </td>
                </tr>
              ) : (
                filteredHolidays.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <div className="calendar-date-cell">
                        <strong>{formatDateBr(h.date)}</strong>
                        <span>{getDayOfWeekLabel(h.date)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="calendar-desc-cell">
                        <strong>{h.description}</strong>
                      </div>
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {h.createdByName || 'Administrador'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="calendar-delete-btn"
                        onClick={() => void handleDeleteItem(h)}
                        title={`Excluir feriado ${h.description}`}
                        aria-label={`Excluir feriado ${h.description}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* CARD 3: SÁBADOS TRABALHADOS (COMPENSAÇÕES) */}
      <section className="calendar-mgmt-card" aria-labelledby="saturdays-title">
        <header className="calendar-mgmt-card-header">
          <div className="calendar-mgmt-card-title">
            <CalendarCheck2 size={20} />
            <div>
              <h2 id="saturdays-title">Sábados Trabalhados (Compensações)</h2>
              <p>Cadastre sábados que terão expediente para liberar a agenda e programações de assistência técnica.</p>
            </div>
          </div>
        </header>

        {/* Cadastro rápido de sábado trabalhado */}
        <form className="calendar-inline-form" onSubmit={handleAddWorkSaturday}>
          <label className="calendar-form-field">
            <span>Data do sábado trabalhado</span>
            <input
              type="date"
              value={newSatDate}
              onChange={(e) => setNewSatDate(e.target.value)}
              required
            />
          </label>
          <label className="calendar-form-field" style={{ flex: '2 1 280px' }}>
            <span>Motivo / Descrição da compensação</span>
            <input
              type="text"
              placeholder="Ex: Compensação de Carnaval, Mutirão de entregas, Plantão..."
              value={newSatDesc}
              onChange={(e) => setNewSatDesc(e.target.value)}
              maxLength={255}
              required
            />
          </label>
          <button className="secondary-button" type="submit" disabled={creatingSat}>
            <Plus size={15} /> {creatingSat ? 'Cadastrando...' : 'Cadastrar sábado trabalhado'}
          </button>
        </form>

        {/* Tabela de Sábados Trabalhados */}
        <div className="calendar-table-wrap">
          <table className="calendar-table">
            <thead>
              <tr>
                <th style={{ width: '180px' }}>DATA DO SÁBADO</th>
                <th>MOTIVO DA COMPENSAÇÃO</th>
                <th style={{ width: '130px' }}>STATUS</th>
                <th style={{ width: '180px' }}>CADASTRADO POR</th>
                <th style={{ width: '60px', textAlign: 'center' }}>AÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="calendar-empty-row">Carregando sábados compensados...</td>
                </tr>
              ) : workSaturdays.length === 0 ? (
                <tr>
                  <td colSpan={5} className="calendar-empty-row">
                    Nenhum sábado de compensação cadastrado. Por padrão, sábados ficam bloqueados para novas programações.
                  </td>
                </tr>
              ) : (
                workSaturdays.map((s) => {
                  const isPast = s.date < todayIso
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="calendar-date-cell">
                          <strong>{formatDateBr(s.date)}</strong>
                          <span>Sábado</span>
                        </div>
                      </td>
                      <td>
                        <div className="calendar-desc-cell">
                          <strong>{s.description}</strong>
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '99px',
                            background: isPast ? '#f1f5f9' : '#dcfce7',
                            color: isPast ? '#64748b' : '#15803d',
                          }}
                        >
                          {isPast ? 'Concluído' : 'Programado'}
                        </span>
                      </td>
                      <td style={{ color: '#64748b' }}>
                        {s.createdByName || 'Administrador'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="calendar-delete-btn"
                          onClick={() => void handleDeleteItem(s)}
                          title={`Excluir sábado ${formatDateBr(s.date)}`}
                          aria-label={`Excluir sábado ${formatDateBr(s.date)}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL DE IMPORTAÇÃO CSV */}
      {showCsvModal && (
        <div className="csv-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="csv-modal-title">
          <div className="csv-modal-box">
            <header className="csv-modal-header">
              <h3 id="csv-modal-title">
                <FileSpreadsheet size={18} style={{ color: '#2563eb' }} />
                Importar Feriados via CSV
              </h3>
              <button
                type="button"
                className="text-action-btn"
                onClick={() => {
                  setShowCsvModal(false)
                  setCsvFileContent('')
                  setCsvFileName('')
                  setCsvParsedPreview([])
                  setCsvErrors([])
                }}
              >
                <X size={18} />
              </button>
            </header>

            <div className="csv-modal-body">
              <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
                Faça upload de uma planilha CSV contendo as colunas de data e descrição dos feriados.
                Formatos de data suportados: <strong>AAAA-MM-DD</strong> ou <strong>DD/MM/AAAA</strong>.
              </p>

              <label className="csv-dropzone">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleSelectCsvFile}
                  style={{ display: 'none' }}
                />
                <div className="csv-dropzone-content">
                  <Upload size={24} />
                  <span>{csvFileName ? `Arquivo selecionado: ${csvFileName}` : 'Clique para selecionar um arquivo CSV'}</span>
                  <small style={{ color: '#94a3b8' }}>Separação por vírgula (,) ou ponto e vírgula (;)</small>
                </div>
              </label>

              {csvErrors.length > 0 && (
                <div className="csv-errors-box">
                  <strong>Avisos no arquivo:</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {csvErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {csvParsedPreview.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Pré-visualização ({csvParsedPreview.length} feriados identificados):
                  </span>
                  <div className="csv-preview-table-wrap">
                    <table className="calendar-table" style={{ fontSize: '11px' }}>
                      <thead>
                        <tr>
                          <th>DATA</th>
                          <th>DESCRIÇÃO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvParsedPreview.slice(0, 10).map((row, i) => (
                          <tr key={i}>
                            <td><strong>{formatDateBr(row.date)}</strong></td>
                            <td>{row.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvParsedPreview.length > 10 && (
                    <small style={{ color: '#64748b' }}>
                      + {csvParsedPreview.length - 10} outros feriados a serem importados.
                    </small>
                  )}
                </div>
              )}
            </div>

            <footer className="csv-modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowCsvModal(false)
                  setCsvFileContent('')
                  setCsvFileName('')
                  setCsvParsedPreview([])
                  setCsvErrors([])
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={csvParsedPreview.length === 0 || importingCsv}
                onClick={handleConfirmCsvImport}
              >
                {importingCsv ? 'Importando...' : `Confirmar importação de ${csvParsedPreview.length} feriados`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

