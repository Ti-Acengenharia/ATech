export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  })
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(payload.error ?? 'Não foi possível concluir a solicitação.')
  return payload as T
}