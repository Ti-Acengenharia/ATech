import { useEffect, useState } from 'react'
import { apiRequest } from './api/client'
import SiengeStockPanel from './SiengeStockPanel'

interface Collaborator {
  id: number
  name: string
  isActive: boolean
  isOnLeave: boolean
}

export default function SiengeInventoryPage({ isAdmin }: { isAdmin: boolean }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void apiRequest<{ collaborators: Collaborator[] }>('/api/inventory/sienge/collaborators')
        .then((result) => setCollaborators(result.collaborators))
        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os colaboradores.'))
        .finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <>
      {error && <div className="sienge-stock-notice error" role="alert">{error}</div>}
      {loading
        ? <p className="sienge-stock-empty">Carregando colaboradores...</p>
        : <SiengeStockPanel isAdmin={isAdmin} collaborators={collaborators} />}
    </>
  )
}
