import type { ReactNode } from 'react'

export interface ATechLoadingProps {
  message?: ReactNode
  subtitle?: ReactNode
  fullscreen?: boolean
  compact?: boolean
  className?: string
}

export function ATechLoading({
  message = 'Carregando informações...',
  subtitle = 'AC Engenharia · ATech',
  fullscreen = false,
  compact = false,
  className = '',
}: ATechLoadingProps) {
  return (
    <div
      className={`atech-loading-screen ${fullscreen ? 'is-fullscreen' : 'is-page'} ${
        compact ? 'is-compact' : ''
      } ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={typeof message === 'string' ? message : 'Carregando informações'}
    >
      <div className="atech-loading-card">
        <div className="atech-loading-halo" aria-hidden="true" />
        <div className="atech-loading-logo-box">
          <img src="/logo-ac.png" alt="AC Engenharia" className="atech-loading-logo-img" />
        </div>
        <div className="atech-loading-title">
          ATech<span className="dot">.</span>
        </div>
        <div className="atech-loading-bar-track" aria-hidden="true">
          <div className="atech-loading-bar-pill" />
        </div>
        <p className="atech-loading-message">{message}</p>
        {subtitle && <p className="atech-loading-subtitle">{subtitle}</p>}
      </div>
    </div>
  )
}

export default ATechLoading

