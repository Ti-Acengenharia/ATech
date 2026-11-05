import { useEffect } from 'react'

export interface SyncEventDetail {
  id?: string
  scope: string
  action?: string
  entityId?: string | number
  meta?: Record<string, unknown>
  timestamp?: number
}

let eventSource: EventSource | null = null
let connectionRefCount = 0
let reconnectTimeout: number | null = null

export function startLiveSync(): () => void {
  if (typeof window === 'undefined') return () => {}

  connectionRefCount++

  if (!eventSource) {
    const connect = () => {
      if (eventSource) return

      try {
        eventSource = new EventSource('/api/sync/events')

        eventSource.onmessage = (event) => {
          if (!event.data) return
          try {
            const parsed = JSON.parse(event.data) as SyncEventDetail
            if (parsed && typeof parsed.scope === 'string') {
              window.dispatchEvent(
                new CustomEvent('atech:sync', {
                  detail: parsed,
                }),
              )
            }
          } catch {
            // ignore non-json messages
          }
        }

        eventSource.onerror = () => {
          // EventSource will automatically retry connecting,
          // but if closed or failed, clean up ref and retry after delay
          if (eventSource && eventSource.readyState === EventSource.CLOSED) {
            eventSource.close()
            eventSource = null
            if (connectionRefCount > 0 && !reconnectTimeout) {
              reconnectTimeout = window.setTimeout(() => {
                reconnectTimeout = null
                if (connectionRefCount > 0) connect()
              }, 5000)
            }
          }
        }
      } catch {
        // SSE not supported or blocked
      }
    }

    connect()
  }

  return () => {
    connectionRefCount = Math.max(0, connectionRefCount - 1)
    if (connectionRefCount === 0) {
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    }
  }
}

export function useLiveSync(
  scopes: string[],
  onSync: (detail: SyncEventDetail) => void,
) {
  useEffect(() => {
    let timeoutId: number | null = null

    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail
      if (!detail || !scopes.includes(detail.scope)) return

      if (timeoutId) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        onSync(detail)
      }, 400)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        onSync({ scope: scopes[0] ?? 'visibility', action: 'wake' })
      }
    }

    window.addEventListener('atech:sync', handleSync)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId)
      window.removeEventListener('atech:sync', handleSync)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [scopes, onSync])
}

