import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { env } from '../config.js'
import { pool } from '../db.js'

try {
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await bcrypt.hash(password, 12)
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, updated_at = now()
     WHERE lower(email) = lower($2) AND role = 'admin' AND status = 'active'`,
    [passwordHash, env.ADMIN_EMAIL],
  )

  if (result.rowCount !== 1) {
    throw new Error(`Nenhum administrador ativo encontrado para ${env.ADMIN_EMAIL}.`)
  }

  console.log('Senha do administrador redefinida.')
  console.log(`E-mail: ${env.ADMIN_EMAIL}`)
  console.log(`Nova senha (exibida uma única vez): ${password}`)
} catch (error) {
  console.error('Não foi possível redefinir a senha do administrador:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}