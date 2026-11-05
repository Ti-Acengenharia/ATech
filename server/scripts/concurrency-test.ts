import { pool } from '../db.js'

interface WorkerResult {
  workerId: number
  operationsCompleted: number
  errors: number
  latenciesMs: number[]
}

async function runWorker(workerId: number, durationMs: number): Promise<WorkerResult> {
  const result: WorkerResult = {
    workerId,
    operationsCompleted: 0,
    errors: 0,
    latenciesMs: [],
  }

  const startTime = Date.now()
  while (Date.now() - startTime < durationMs) {
    const opStart = performance.now()
    try {
      // Simulate real-world queries performed by users
      const queryType = result.operationsCompleted % 4
      if (queryType === 0) {
        // Query 1: Active tickets count by enterprise (Home / Dashboard)
        await pool.query(`
          SELECT enterprise, count(*)::int AS total
          FROM tickets
          WHERE source_active = true
          GROUP BY enterprise
          LIMIT 10
        `)
      } else if (queryType === 1) {
        // Query 2: Collaborators listing summary
        await pool.query(`
          SELECT id, name, role, registration_number
          FROM collaborators
          ORDER BY name
          LIMIT 25
        `)
      } else if (queryType === 2) {
        // Query 3: Personal activities listing
        await pool.query(`
          SELECT id, column_id, title, priority, due_date
          FROM personal_activities
          ORDER BY updated_at DESC
          LIMIT 20
        `)
      } else {
        // Query 4: Recent audit logs
        await pool.query(`
          SELECT id, action, resource_type, actor_name, created_at
          FROM system_audit_logs
          ORDER BY created_at DESC
          LIMIT 15
        `)
      }
      const opDuration = performance.now() - opStart
      result.latenciesMs.push(opDuration)
      result.operationsCompleted++
    } catch (error) {
      result.errors++
      console.error(`[Worker ${workerId}] Falha na operação:`, error instanceof Error ? error.message : error)
    }
  }

  return result
}

export async function runConcurrencyTest(numUsers = 15, durationSeconds = 5) {
  console.log('='.repeat(70))
  console.log(`TESTE DE CONCORRÊNCIA E USO SIMULTÂNEO: ${numUsers} USUÁRIOS`)
  console.log(`Duração do teste: ${durationSeconds} segundos`)
  console.log(`Pool PostgreSQL configurado: max ${pool.options.max} conexões`)
  console.log('='.repeat(70))

  // 1. Check database connectivity
  try {
    const testConn = await pool.query('SELECT current_database(), current_user, version()')
    console.log(`✓ Conectado ao banco: ${testConn.rows[0].current_database} (usuário: ${testConn.rows[0].current_user})`)
  } catch (err) {
    console.error('❌ Falha ao conectar ao banco de dados:', err)
    process.exit(1)
  }

  const durationMs = durationSeconds * 1000
  const startOverall = performance.now()

  // Launch simulated concurrent users in parallel
  const workers = Array.from({ length: numUsers }, (_, index) => runWorker(index + 1, durationMs))
  const results = await Promise.all(workers)

  const overallDuration = (performance.now() - startOverall) / 1000

  // Aggregate results
  const totalOperations = results.reduce((acc, r) => acc + r.operationsCompleted, 0)
  const totalErrors = results.reduce((acc, r) => acc + r.errors, 0)
  const allLatencies = results.flatMap((r) => r.latenciesMs).sort((a, b) => a - b)

  const p50 = allLatencies[Math.floor(allLatencies.length * 0.5)] ?? 0
  const p90 = allLatencies[Math.floor(allLatencies.length * 0.9)] ?? 0
  const p95 = allLatencies[Math.floor(allLatencies.length * 0.95)] ?? 0
  const p99 = allLatencies[Math.floor(allLatencies.length * 0.99)] ?? 0
  const avg = allLatencies.reduce((a, b) => a + b, 0) / (allLatencies.length || 1)
  const rps = totalOperations / overallDuration

  console.log('\n--- RESULTADOS DO TESTE DE CONCORRÊNCIA ---')
  console.log(`Operações concluídas com sucesso: ${totalOperations}`)
  console.log(`Total de falhas/erros:           ${totalErrors} (${((totalErrors / (totalOperations || 1)) * 100).toFixed(2)}%)`)
  console.log(`Vazão média (Throughput):        ${rps.toFixed(1)} consultas/segundo`)
  console.log(`Tempo total de execução:         ${overallDuration.toFixed(2)}s`)
  console.log('\n--- LATÊNCIAS DE RESPOSTA ---')
  console.log(`Média (Média Aritmética):        ${avg.toFixed(2)} ms`)
  console.log(`Mediana (p50):                   ${p50.toFixed(2)} ms`)
  console.log(`90º Percentil (p90):             ${p90.toFixed(2)} ms`)
  console.log(`95º Percentil (p95):             ${p95.toFixed(2)} ms`)
  console.log(`99º Percentil (p99):             ${p99.toFixed(2)} ms`)
  console.log('='.repeat(70))

  if (totalErrors === 0) {
    console.log('✅ SUCESSO: Sistema respondeu perfeitamente sob carga concorrente de 15 pessoas!')
  } else {
    console.log('⚠️ ATENÇÃO: Ocorreram erros durante o teste de carga simultânea.')
  }

  await pool.end()
  process.exit(totalErrors === 0 ? 0 : 1)
}

void runConcurrencyTest(15, 4)

