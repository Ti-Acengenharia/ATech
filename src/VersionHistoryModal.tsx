import { useState } from 'react'
import { Sparkles, Calendar, Tag, CheckCircle2, ChevronRight, X, Shield, Wrench, Palette, Server } from 'lucide-react'
import { APP_CURRENT_VERSION, APP_VERSION_HISTORY, type VersionRelease } from './version'
import './VersionHistoryModal.css'

export default function VersionHistoryModal({ onClose }: { onClose: () => void }) {
  const [selectedVersion, setSelectedVersion] = useState<VersionRelease>(APP_VERSION_HISTORY[0])

  function getCategoryIcon(cat: string) {
    switch (cat) {
      case 'Segurança': return <Shield size={14} className="cat-icon cat-security" />
      case 'Funcionalidade': return <Wrench size={14} className="cat-icon cat-feature" />
      case 'Design & UX': return <Palette size={14} className="cat-icon cat-design" />
      case 'Infraestrutura & VPS': return <Server size={14} className="cat-icon cat-infra" />
      default: return <Sparkles size={14} className="cat-icon" />
    }
  }

  return (
    <div className="version-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="version-modal-title" onClick={onClose}>
      <div className="version-modal" onClick={(e) => e.stopPropagation()}>
        <header className="version-modal-header">
          <div className="version-modal-title-lockup">
            <span className="version-current-badge">{APP_CURRENT_VERSION}</span>
            <div>
              <h2 id="version-modal-title">Controle de Versão e Notas de Atualização</h2>
              <p>Histórico completo de melhorias, correções e novas funcionalidades da plataforma ATech.</p>
            </div>
          </div>
          <button type="button" className="version-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="version-modal-layout">
          {/* Navegação lateral de versões */}
          <aside className="version-sidebar">
            <span className="version-sidebar-title">HISTÓRICO DE RELEASES</span>
            <div className="version-list">
              {APP_VERSION_HISTORY.map((rel) => {
                const isActive = rel.version === selectedVersion.version
                const isCurrent = rel.version === APP_CURRENT_VERSION
                return (
                  <button
                    type="button"
                    key={rel.version}
                    className={`version-nav-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => setSelectedVersion(rel)}
                  >
                    <div className="version-nav-main">
                      <div className="version-nav-row">
                        <strong>{rel.version}</strong>
                        {isCurrent && <span className="version-pill-current">Atual</span>}
                      </div>
                      <small><Calendar size={11} /> {rel.date}</small>
                    </div>
                    <ChevronRight size={14} className="version-nav-chevron" />
                  </button>
                )
              })}
            </div>
          </aside>

          {/* Conteúdo detalhado da versão selecionada */}
          <section className="version-detail-content">
            <div className="version-detail-hero">
              <div className="version-detail-heading-row">
                <span className="version-detail-tag"><Tag size={13} /> {selectedVersion.version}</span>
                <time className="version-detail-date"><Calendar size={13} /> Lançada em {selectedVersion.date}</time>
              </div>
              <h3>{selectedVersion.title}</h3>
              <p className="version-detail-tagline">{selectedVersion.tagline}</p>
            </div>

            <div className="version-categories-list">
              {selectedVersion.changes.map((group) => (
                <div className="version-category-block" key={group.category}>
                  <header className="version-category-header">
                    {getCategoryIcon(group.category)}
                    <h4>{group.category}</h4>
                  </header>
                  <ul className="version-items-list">
                    {group.items.map((item, idx) => (
                      <li key={idx}>
                        <CheckCircle2 size={14} className="version-item-check" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="version-modal-footer">
          <span>AC Engenharia · ATech Gestão Técnica Integrada</span>
          <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>
  )
}

