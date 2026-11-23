const healthUrl = 'http://127.0.0.1:4000/api/health'
const timeoutAt = Date.now() + 60_000
let lastFailure = 'A API ainda nao respondeu.'
let ready = false

while (Date.now() < timeoutAt) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) })
    if (response.ok) {
      ready = true
      break
    }
    lastFailure = `A API respondeu HTTP ${response.status}; verifique se o PostgreSQL esta disponivel.`
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

if (!ready) {
  console.error(`Nao foi possivel iniciar a interface: API e banco nao ficaram prontos em 60 segundos. ${lastFailure}`)
  process.exitCode = 1
} else {
  console.log('API e banco de dados prontos; iniciando a interface.')
}
