import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Info, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { apiRequest } from './api/client'
import SearchableMultiSelect from './SearchableMultiSelect'
import './HomepageTicketsFilterSettings.css'

export interface HomepageTicketsFilterConfig {
  enterprises: string[]
  ticketTypes: ('client' | 'condominium')[]
  subjects: string[]
  fromYear: number | null
}

interface FilterOptions {
  enterprises: string[]
  subjects: string[]
  years: number[]
  ticketTypes: Array<{ value: 'client' | 'condominium'; label: string }>
}

const defaultConfig: HomepageTicketsFilterConfig = {
  enterprises: [],
  ticketTypes: [],
  subjects: [],
  fromYear: null,
}

export default function HomepageTicketsFilterSettings({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState<HomepageTicketsFilterConfig>(defaultConfig)
  const [savedConfig, setSavedConfig] = useState<HomepageTicketsFilterConfig>(defaultConfig)
  const [options, setOptions] = useState<FilterOptions>({
    enterprises: [],
    subjects: [],
    years: [],
    ticketTypes: [
      { value: 'client', label: 'Cliente' },
      { value: 'condominium', label: 'Condomínio' },
    ],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    apiRequest<{ config: HomepageTicketsFilterConfig; options: FilterOptions }>('/api/home/tickets-filter-config')
      .then((data) => {
        if (cancelled) return
        setConfig(data.config)
        setSavedConfig(data.config)
        setOptions(data.options)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Não foi possível carregar as configurações do filtro.',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const isCustomFilterActive = useMemo(() => {
    return (
      savedConfig.enterprises.length > 0 ||
      savedConfig.ticketTypes.length > 0 ||
      savedConfig.subjects.length > 0 ||
      savedConfig.fromYear !== null
    )
  }, [savedConfig])

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(config) !== JSON.stringify(savedConfig)
  }, [config, savedConfig])

  function toggleTicketType(type: 'client' | 'condominium') {
    setConfig((prev) => {
      const exists = prev.ticketTypes.includes(type)
      const nextTypes = exists
        ? prev.ticketTypes.filter((t) => t !== type)
        : [...prev.ticketTypes, type]
      return { ...prev, ticketTypes: nextTypes }
    })
  }

  function handleReset() {
    setConfig(defaultConfig)
  }

  async function handleSave() {
    setSaving(true)
    setFeedback(null)

    try {
      const result = await apiRequest<{ success: boolean; config: HomepageTicketsFilterConfig; message: string }>(
        '/api/home/tickets-filter-config',
        {
          method: 'PUT',
          body: JSON.stringify(config),
        },
      )
      setSavedConfig(result.config)
      setConfig(result.config)
      setFeedback({
        type: 'success',
        message: 'Filtro da homepage salvo com sucesso. A contagem de chamados ativos já reflete essa regra para todos.',
      })
      if (onSaved) onSaved()
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao salvar as configurações.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="homepage-filter-settings-card" aria-labelledby="homepage-filter-heading">
      <div className="homepage-filter-header">
        <div className="homepage-filter-header-left">
          <div className="homepage-filter-icon">
            <SlidersHorizontal size={20} />
          </div>
          <div className="homepage-filter-title-wrap">
            <h2 id="homepage-filter-heading">Filtro de contagem de chamados da Homepage</h2>
            <p>
              Configure quais obras, tipos de chamado, assuntos e ano de abertura são contabilizados no
              indicador <strong>Chamados Ativos</strong> da tela inicial de todos os usuários.
            </p>
          </div>
        </div>

        <div>
          {isCustomFilterActive ? (
            <span className="homepage-filter-status-badge homepage-filter-status-active">
              <CheckCircle2 size={13} /> Filtro personalizado ativo
            </span>
          ) : (
            <span className="homepage-filter-status-badge homepage-filter-status-default">
              <Info size={13} /> Padrão: todos os chamados ativos
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '20px 0', color: '#64748b', fontSize: '13px' }}>
          Carregando opções de filtros da homepage...
        </div>
      ) : (
        <>
          <div className="homepage-filter-grid">
            {/* 1. Obras / Empreendimentos */}
            <div className="homepage-filter-field">
              <span className="homepage-filter-field-label">Obras (Empreendimentos)</span>
              <SearchableMultiSelect
                label="Obras consideradas"
                options={options.enterprises}
                value={config.enterprises}
                onChange={(values) => setConfig((prev) => ({ ...prev, enterprises: values }))}
                emptyLabel="Nenhuma obra encontrada."
              />
              <span className="homepage-filter-field-help">
                {config.enterprises.length === 0
                  ? 'Todas as obras estão incluídas.'
                  : `${config.enterprises.length} obra(s) selecionada(s).`}
              </span>
            </div>

            {/* 2. Tipo de chamado */}
            <div className="homepage-filter-field">
              <span className="homepage-filter-field-label">Tipo de chamado</span>
              <div className="homepage-filter-type-options">
                <button
                  type="button"
                  className={`homepage-filter-type-btn ${config.ticketTypes.includes('client') ? 'is-active' : ''}`}
                  onClick={() => toggleTicketType('client')}
                  aria-pressed={config.ticketTypes.includes('client')}
                >
                  <span className="homepage-filter-type-checkbox">
                    {config.ticketTypes.includes('client') && <Check size={12} />}
                  </span>
                  <span>Cliente</span>
                </button>
                <button
                  type="button"
                  className={`homepage-filter-type-btn ${config.ticketTypes.includes('condominium') ? 'is-active' : ''}`}
                  onClick={() => toggleTicketType('condominium')}
                  aria-pressed={config.ticketTypes.includes('condominium')}
                >
                  <span className="homepage-filter-type-checkbox">
                    {config.ticketTypes.includes('condominium') && <Check size={12} />}
                  </span>
                  <span>Condomínio</span>
                </button>
              </div>
              <span className="homepage-filter-field-help">
                {config.ticketTypes.length === 0 || config.ticketTypes.length === 2
                  ? 'Ambos (Cliente e Condomínio).'
                  : config.ticketTypes[0] === 'client'
                  ? 'Apenas chamados de Cliente.'
                  : 'Apenas chamados de Condomínio.'}
              </span>
            </div>

            {/* 3. Assuntos */}
            <div className="homepage-filter-field">
              <span className="homepage-filter-field-label">Assunto</span>
              <SearchableMultiSelect
                label="Assuntos considerados"
                options={options.subjects}
                value={config.subjects}
                onChange={(values) => setConfig((prev) => ({ ...prev, subjects: values }))}
                emptyLabel="Nenhum assunto encontrado."
              />
              <span className="homepage-filter-field-help">
                {config.subjects.length === 0
                  ? 'Todos os assuntos estão incluídos.'
                  : `${config.subjects.length} assunto(s) selecionado(s).`}
              </span>
            </div>

            {/* 4. A partir de qual ano */}
            <div className="homepage-filter-field">
              <label htmlFor="homepage-filter-from-year" className="homepage-filter-field-label">
                A partir de qual ano
              </label>
              <select
                id="homepage-filter-from-year"
                className="homepage-filter-select"
                value={config.fromYear ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null
                  setConfig((prev) => ({ ...prev, fromYear: val }))
                }}
              >
                <option value="">Todos os anos (sem corte)</option>
                {options.years.map((year) => (
                  <option key={year} value={year}>
                    A partir de {year}
                  </option>
                ))}
              </select>
              <span className="homepage-filter-field-help">
                {config.fromYear ? `Apenas chamados abertos em ${config.fromYear} ou depois.` : 'Sem restrição por ano.'}
              </span>
            </div>
          </div>

          {/* Resumo Dinâmico em Linguagem Natural */}
          <div className="homepage-filter-preview-box">
            <div className="homepage-filter-preview-title">
              <Info size={14} /> Regra calculada para a Homepage:
            </div>
            <div className="homepage-filter-preview-content">
              <span className="homepage-filter-preview-item">
                Obras: <strong>{config.enterprises.length ? config.enterprises.join(', ') : 'Todas'}</strong>
              </span>
              <span>·</span>
              <span className="homepage-filter-preview-item">
                Tipo:{' '}
                <strong>
                  {config.ticketTypes.length === 1
                    ? config.ticketTypes[0] === 'client'
                      ? 'Apenas Clientes'
                      : 'Apenas Condomínios'
                    : 'Clientes e Condomínios'}
                </strong>
              </span>
              <span>·</span>
              <span className="homepage-filter-preview-item">
                Assuntos: <strong>{config.subjects.length ? config.subjects.join(', ') : 'Todos'}</strong>
              </span>
              <span>·</span>
              <span className="homepage-filter-preview-item">
                Abertura:{' '}
                <strong>{config.fromYear ? `A partir de 01/01/${config.fromYear}` : 'Histórico completo'}</strong>
              </span>
            </div>
          </div>

          {/* Barra de Ações */}
          <div className="homepage-filter-actions">
            <div>
              {feedback && (
                <div className={`homepage-filter-feedback ${feedback.type}`} role="status">
                  {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{feedback.message}</span>
                </div>
              )}
            </div>

            <div className="homepage-filter-actions-right">
              <button
                type="button"
                className="homepage-filter-reset-btn"
                onClick={handleReset}
                disabled={saving || (!isCustomFilterActive && !hasUnsavedChanges)}
                title="Redefinir para considerar todos os chamados"
              >
                <RotateCcw size={14} /> Restaurar padrão
              </button>

              <button
                type="button"
                className="homepage-filter-save-btn"
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
              >
                <Save size={15} />
                <span>{saving ? 'Salvando...' : 'Salvar configurações'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
