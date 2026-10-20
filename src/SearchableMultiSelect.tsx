import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import './SearchableMultiSelect.css'

export default function SearchableMultiSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  emptyLabel = 'Nenhuma opção disponível.',
}: {
  label: string
  options: Array<string | { value: string; label: string }>
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const normalizedOptions = options.map((option) => typeof option === 'string'
    ? { value: option, label: option }
    : option)
  const selectedSummary = value.length ? `${value.length} selecionado${value.length === 1 ? '' : 's'}` : 'Todos'
  const filteredOptions = normalizedOptions.filter((option) => option.label.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  function toggleOption(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  }

  return <div className={`searchable-multiselect ${open ? 'searchable-multiselect-open' : ''}`} ref={wrapperRef}>
    <span className="searchable-multiselect-label">{label}</span>
    <button className="searchable-multiselect-trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{selectedSummary}</span>
      <ChevronDown size={15} />
    </button>
    {open && <div className="searchable-multiselect-popover">
      <label className="searchable-multiselect-search"><Search size={15} /><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Pesquisar ${label.toLocaleLowerCase('pt-BR')}`} /></label>
      <div className="searchable-multiselect-options" role="listbox" aria-label={label} aria-multiselectable="true">
        {filteredOptions.length ? filteredOptions.map((option) => {
          const selected = value.includes(option.value)
          return <button type="button" key={option.value} className={selected ? 'selected' : ''} role="option" aria-selected={selected} onClick={() => toggleOption(option.value)}>
            <span className="searchable-multiselect-checkbox">{selected && <Check size={12} />}</span><span>{option.label}</span>
          </button>
        }) : <span className="searchable-multiselect-empty">{normalizedOptions.length ? 'Nenhum resultado.' : emptyLabel}</span>}
      </div>
      <footer><span>{value.length} selecionado(s)</span><button type="button" onClick={() => { onChange([]); setOpen(false); setQuery('') }} disabled={!value.length}>Limpar</button></footer>
    </div>}
  </div>
}
