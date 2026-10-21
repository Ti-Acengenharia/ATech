import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  CORPORATE_DOMAIN: z
    .string()
    .min(3)
    .transform((domain) => domain.trim().toLowerCase().replace(/^@/, '')),
  GOOGLE_CLIENT_ID: z.string().default(''),
  ADMIN_EMAIL: z.string().email().default('admin@atech.local'),
  ADMIN_INITIAL_PASSWORD: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(12).optional(),
  ),
  PII_ENCRYPTION_KEY: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().regex(/^[\da-f]{64}$/i).optional(),
  ),
  CVCRM_SUBDOMAIN: z.preprocess(
    (value) => {
      if (typeof value !== 'string' || value.trim() === '') return undefined
      const host = value.trim().replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0]
      return host.replace(/\.cvcrm\.com\.br$/i, '')
    },
    z.string().regex(/^[a-z\d-]+$/i).optional(),
  ),
  CVCRM_API_EMAIL: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().email().optional(),
  ),
  CVCRM_API_TOKEN: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(10).optional(),
  ),
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  throw new Error(`Configuração inválida: ${z.prettifyError(parsedEnv.error)}`)
}

export const env = parsedEnv.data