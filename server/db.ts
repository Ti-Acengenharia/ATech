import pg from 'pg'
import { env } from './config.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 40,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

// Tratamento essencial para clientes ociosos: evita que desconexões de socket derrubem o processo Node.js
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool] Erro inesperado em cliente ocioso do pool:', err.message)
})

export async function safeRollback(client: pg.PoolClient) {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Ignora erro de rollback caso o socket já tenha sido encerrado pelo banco
  }
}