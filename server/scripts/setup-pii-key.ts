import { randomBytes } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const envPath = resolve('.env')

try {
  const contents = await readFile(envPath, 'utf8')
  const configuredLine = contents.split(/\r?\n/).find((line) => line.startsWith('PII_ENCRYPTION_KEY='))

  if (configuredLine) {
    const configuredKey = configuredLine.slice('PII_ENCRYPTION_KEY='.length).replace(/^['"]|['"]$/g, '')
    if (!/^[\da-f]{64}$/i.test(configuredKey)) {
      throw new Error('PII_ENCRYPTION_KEY já existe, mas não contém 64 caracteres hexadecimais. Nenhuma alteração foi feita.')
    }
    console.log('Chave de dados pessoais já configurada; nenhuma alteração foi feita.')
  } else {
    const lineBreak = contents.endsWith('\n') ? '' : '\n'
    const key = randomBytes(32).toString('hex')
    await appendFile(envPath, `${lineBreak}PII_ENCRYPTION_KEY=${key}\n`, 'utf8')
    console.log('Chave AES-256 criada no .env sem exibi-la. Reinicie a API para carregar a configuração.')
  }
} catch (error) {
  console.error('Não foi possível configurar a chave de dados pessoais:', error instanceof Error ? error.message : 'erro desconhecido')
  process.exitCode = 1
}