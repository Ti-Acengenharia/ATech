let lastExpiredDispatch = 0

export function notifySessionExpired(message = 'Sua sessão expirou. Faça login novamente para continuar.') {
  const now = Date.now()
  if (now - lastExpiredDispatch < 3000) return
  lastExpiredDispatch = now
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('atech:session-expired', {
        detail: { message },
      }),
    )
  }
}

function isLoginPath(path: string): boolean {
  return (
    path.includes('/admin/login') ||
    path.includes('/auth/google') ||
    path.includes('/auth/login')
  )
}

async function executeFetch(path: string, options: RequestInit, headers: Headers): Promise<Response> {
  const isGet = !options.method || options.method.toUpperCase() === 'GET'
  try {
    return await fetch(path, {
      ...options,
      credentials: 'include',
      headers,
    })
  } catch (error) {
    if (isGet) {
      await new Promise((resolve) => setTimeout(resolve, 350))
      try {
        return await fetch(path, {
          ...options,
          credentials: 'include',
          headers,
        })
      } catch {
        // Second attempt failed, bubble error
      }
    }
    throw error
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'ATechClient')
  }

  let response: Response
  try {
    response = await executeFetch(path, options, headers)
  } catch (error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Você está sem conexão com a internet. Verifique sua rede e tente novamente.')
    }

    if (!isLoginPath(path)) {
      notifySessionExpired('A conexão com o servidor foi interrompida ou sua sessão expirou. Faça login novamente.')
      throw new Error('A conexão com o servidor foi interrompida ou sua sessão expirou.')
    }

    throw new Error(
      error instanceof Error && error.message !== 'Failed to fetch'
        ? error.message
        : 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    )
  }

  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) {
      const isPinError = typeof payload?.error === 'string' && payload.error.toLowerCase().includes('pin')
      if (!isLoginPath(path) && !isPinError) {
        notifySessionExpired(payload.error ?? 'Sua sessão expirou. Faça login novamente para continuar.')
      }
    }
    throw new Error(payload.error ?? 'Não foi possível concluir a solicitação.')
  }
  return payload as T
}
