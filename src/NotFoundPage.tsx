import { AlertCircle, ArrowLeft, ClipboardList, Compass, Home } from 'lucide-react'
import './NotFoundPage.css'

export interface NotFoundPageProps {
  kind?: 'not-found' | 'forbidden'
  pageKey?: string
  onGoHome: () => void
  onGoTickets?: () => void
}

export default function NotFoundPage({
  kind = 'not-found',
  pageKey,
  onGoHome,
  onGoTickets,
}: NotFoundPageProps) {
  const isForbidden = kind === 'forbidden'

  return (
    <section className="atech-not-found-page" role="main" aria-label={isForbidden ? 'Acesso não autorizado' : 'Página não encontrada'}>
      <div className="not-found-card">
        <div className="not-found-halo" aria-hidden="true" />
        <div className="not-found-icon-wrap">
          {isForbidden ? <AlertCircle size={36} className="icon-alert" /> : <Compass size={36} className="icon-compass" />}
        </div>
        <span className="not-found-code">{isForbidden ? '403' : '404'}</span>
        <h1 className="not-found-title">
          {isForbidden ? 'Acesso restrito' : 'Página não encontrada'}
        </h1>
        <p className="not-found-description">
          {isForbidden
            ? `Seu usuário não possui permissão para acessar o módulo ${pageKey ? `"${pageKey}"` : 'solicitado'}. Entre em contato com um administrador para solicitar liberação.`
            : `O endereço ou módulo ${pageKey ? `"${pageKey}"` : 'solicitado'} não foi encontrado, foi alterado ou está temporariamente indisponível.`}
        </p>

        <div className="not-found-actions">
          <button type="button" className="primary-button btn-go-home" onClick={onGoHome}>
            <Home size={16} />
            Voltar para o Início
          </button>
          {onGoTickets && (
            <button type="button" className="secondary-button" onClick={onGoTickets}>
              <ClipboardList size={16} />
              Ir para Chamados
            </button>
          )}
          <button type="button" className="text-button btn-go-back" onClick={() => window.history.back()}>
            <ArrowLeft size={14} /> Voltar à página anterior
          </button>
        </div>
      </div>
    </section>
  )
}

