export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'ATechClient')
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  })
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}))

  if (!response.ok) {
    if (
      response.status === 401 &&
      (payload.code === 'SESSION_REQUIRED' || payload.code === 'ACCOUNT_INACTIVE')
    ) {
      window.dispatchEvent(
        new CustomEvent('atech:session-expired', {
          detail: {
            message: payload.error ?? 'Sua sessão expirou. Faça login novamente para continuar.',
          },
        }),
      )
    }
    throw new Error(payload.error ?? 'Não foi possível concluir a solicitação.')
  }
  return payload as T
}
