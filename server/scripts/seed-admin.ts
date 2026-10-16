import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { env } from '../config.js'
import { pool } from '../db.js'

try {
  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase()
  const adminDomain = adminEmail.split('@')[1]

  if (adminDomain === env.CORPORATE_DOMAIN) {
    throw new Error('ADMIN_EMAIL deve ficar fora do domínio corporativo configurado.')
  }

  const existingAdmin = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE role = 'admin' LIMIT 1",
  )

  if (existingAdmin.rowCount) {
    if (existingAdmin.rows[0].email.toLowerCase() !== adminEmail) {
      throw new Error('Já existe um administrador diferente. A plataforma permite somente um.')
    }
    console.log(`Administrador ${adminEmail} já inicializado; nenhuma senha foi alterada.`)
  } else {
    const password = env.ADMIN_INITIAL_PASSWORD ?? randomBytes(24).toString('base64url')
    if (password.length < 12) throw new Error('ADMIN_INITIAL_PASSWORD precisa ter ao menos 12 caracteres.')

    const passwordHash = await bcrypt.hash(password, 12)
    const displayName = 'Administrador ATech'
    await pool.query(
      `INSERT INTO users (email, display_name, role, status, password_hash)
       VALUES ($1, $2, 'admin', 'active', $3)`,
      [adminEmail, displayName, passwordHash],
    )

    console.log('Administrador inicial criado.')
    console.log(`E-mail: ${adminEmail}`)
    console.log(`Senha inicial: ${password}`)
    console.log('Guarde esta senha: ela só é exibida durante a criação da conta.')
  }
} catch (error) {
  console.error('Não foi possível inicializar o administrador:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}