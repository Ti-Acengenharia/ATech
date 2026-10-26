import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { env } from '../config.js'

export type PersonalDataField =
  | 'cpf'
  | 'phone'
  | 'birth-date'
  | 'child-name'
  | 'child-birth-date'
  | 'child-gender'
  | 'leave-start-date'
  | 'expected-return-date'
  | 'leave-reason'
  | 'ticket-phone'
  | 'uniform-delivery-signature'
  | 'inventory-delivery-signature'
  | 'user-signature'

export function isPersonalDataEncryptionConfigured() {
  return Boolean(env.PII_ENCRYPTION_KEY)
}

function encryptionKey() {
  if (!env.PII_ENCRYPTION_KEY) {
    throw new Error('Configure PII_ENCRYPTION_KEY para armazenar ou consultar dados pessoais.')
  }

  return Buffer.from(env.PII_ENCRYPTION_KEY, 'hex')
}

export function encryptPersonalData(value: string, field: PersonalDataField) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(`atech:${field}:v1`))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':')
}

export function decryptPersonalData(value: string, field: PersonalDataField) {
  const [version, iv, tag, encrypted] = value.split(':')
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('Formato de dado pessoal criptografado inválido.')
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(`atech:${field}:v1`))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function fingerprintCpf(cpf: string) {
  return createHmac('sha256', encryptionKey()).update(cpf).digest('hex')
}