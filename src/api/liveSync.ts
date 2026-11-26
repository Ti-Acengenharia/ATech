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
let broadcastChannel: BroadcastChannel | null = null
let leaderAbortController: AbortController | null = null

function dispatchLocalSyncEvent(parsed: SyncEventDetail) {
  window.dispatchEvent(
    new CustomEvent('atech:sync', {
      detail: parsed,
    }),
  )
}

function closeEventSource() {
  if (reconnectTimeout) {
    window.clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function connectEventSource() {
  if (eventSource || connectionRefCount <= 0) return

  try {
    eventSource = new EventSource('/api/sync/events')

    eventSource.onmessage = (event) => {
      if (!event.data) return
      try {
        const parsed = JSON.parse(event.data) as SyncEventDetail
        if (parsed && typeof parsed.scope === 'string') {
          dispatchLocalSyncEvent(parsed)
          // Replica o evento para todas as outras abas abertas sem que elas precisem abrir conexões SSE próprias
          try {
            broadcastChannel?.postMessage(parsed)
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore non-json messages
      }
    }

    eventSource.onerror = () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        eventSource.close()
        eventSource = null
        if (connectionRefCount > 0 && !reconnectTimeout) {
          reconnectTimeout = window.setTimeout(() => {
            reconnectTimeout = null
            if (connectionRefCount > 0) connectEventSource()
          }, 5000)
        }
      }
    }
  } catch {
    // SSE not supported or blocked
  }
}

export function startLiveSync(): () => void {
  if (typeof window === 'undefined') return () => {}

  connectionRefCount++

  if (connectionRefCount === 1) {
    // Canal entre abas do mesmo navegador
    if (typeof BroadcastChannel !== 'undefined' && !broadcastChannel) {
      try {
        broadcastChannel = new BroadcastChannel('atech_live_sync_channel')
        broadcastChannel.onmessage = (event) => {
          const data = event.data as SyncEventDetail | undefined
          if (data && typeof data.scope === 'string') {
            dispatchLocalSyncEvent(data)
          }
        }
      } catch {
        broadcastChannel = null
      }
    }

    // Eleição de aba líder via Web Locks API:
    // Garante que apenas 1 única aba mantenha conexão EventSource aberta com o servidor,
    // evitando esgotar o limite de 6 conexões HTTP/1.1 simultâneas do navegador ao abrir várias abas.
    if (typeof navigator !== 'undefined' && 'locks' in navigator && broadcastChannel) {
      leaderAbortController = new AbortController()
      const signal = leaderAbortController.signal

      navigator.locks
        .request(
          'atech_live_sync_sse_leader',
          { signal },
          () =>
            new Promise<void>((resolve) => {
              if (signal.aborted || connectionRefCount <= 0) {
                resolve()
                return
              }
              connectEventSource()
              signal.addEventListener(
                'abort',
                () => {
                  closeEventSource()
                  resolve()
                },
                { once: true },
              )
            }),
        )
        .catch(() => {
          // AbortError normal ao desmontar/fechar a aba
        })
    } else {
      connectEventSource()
    }
  }

  return () => {
    connectionRefCount = Math.max(0, connectionRefCount - 1)
    if (connectionRefCount === 0) {
      if (leaderAbortController) {
        leaderAbortController.abort()
        leaderAbortController = null
      }
      closeEventSource()
      if (broadcastChannel) {
        try {
          broadcastChannel.close()
        } catch {
          // ignore
        }
        broadcastChannel = null
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

