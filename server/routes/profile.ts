import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { pool } from '../db.js'
import { decryptPersonalData, encryptPersonalData, isPersonalDataEncryptionConfigured } from '../services/personal-data.js'

const router = Router()
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  jobTitle: z.string().trim().max(120),
})
const pinSchema = z.string().regex(/^\d{6,12}$/, 'O PIN deve conter de 6 a 12 números.')
const unlockSchema = z.object({ pin: pinSchema })
const signatureSchema = z.object({
  pin: pinSchema.optional(),
  newPin: pinSchema.optional(),
  signatureBase64: z.string().max(140_000).nullable(),
})
const maximumFailedAttempts = 5
const lockDurationMs = 15 * 60 * 1000

router.use(requireAuth)

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query<{
      display_name: string
      job_title: string
      has_signature: boolean
      has_pin: boolean
    }>(
      `SELECT display_name, job_title,
              signature_data_ciphertext IS NOT NULL AS has_signature,
              signature_pin_hash IS NOT NULL AS has_pin
       FROM users WHERE id = $1 AND status = 'active'`,
      [req.session.user!.id],
    )
    const profile = result.rows[0]
    if (!profile) {
      res.status(404).json({ error: 'Perfil não encontrado.' })
      return
    }
    res.json({
      displayName: profile.display_name,
      jobTitle: profile.job_title,
      hasSignature: profile.has_signature,
      hasPin: profile.has_pin,
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/', async (req, res, next) => {
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um nome e cargo válidos.' })
    return
  }

  try {
    const result = await pool.query<{ id: number; display_name: string }>(
      `UPDATE users SET display_name = $1, display_name_customized = TRUE,
                        job_title = $2, updated_at = now()
       WHERE id = $3 AND status = 'active'
       RETURNING id, display_name`,
      [parsed.data.displayName, parsed.data.jobTitle, req.session.user!.id],
    )
    const updated = result.rows[0]
    if (!updated) {
      res.status(404).json({ error: 'Perfil não encontrado.' })
      return
    }

    req.session.user!.displayName = updated.display_name
    req.session.save((error) => {
      if (error) {
        next(error)
        return
      }
      res.json({ displayName: updated.display_name })
    })
  } catch (error) {
    next(error)
  }
})

router.post('/signature/unlock', async (req, res, next) => {
  const parsed = unlockSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'PIN inválido.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      signature_data_ciphertext: string | null
      signature_pin_hash: string | null
      signature_pin_failed_attempts: number
      signature_pin_locked_until: Date | null
    }>(
      `SELECT signature_data_ciphertext, signature_pin_hash,
              signature_pin_failed_attempts, signature_pin_locked_until
       FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [req.session.user!.id],
    )
    const profile = result.rows[0]
    if (!profile) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Perfil não encontrado.' })
      return
    }
    if (!profile.signature_pin_hash) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Cadastre um PIN e uma assinatura no perfil antes de continuar.' })
      return
    }
    if (profile.signature_pin_locked_until && profile.signature_pin_locked_until > new Date()) {
      await client.query('ROLLBACK')
      res.status(429).json({ error: 'PIN temporariamente bloqueado após várias tentativas. Aguarde 15 minutos.' })
      return
    }

    const pinIsValid = await bcrypt.compare(parsed.data.pin, profile.signature_pin_hash)
    if (!pinIsValid) {
      const attempts = profile.signature_pin_locked_until && profile.signature_pin_locked_until <= new Date()
        ? 1
        : profile.signature_pin_failed_attempts + 1
      const lockedUntil = attempts >= maximumFailedAttempts
        ? new Date(Date.now() + lockDurationMs)
        : null
      await client.query(
        `UPDATE users SET signature_pin_failed_attempts = $1, signature_pin_locked_until = $2
         WHERE id = $3`,
        [attempts, lockedUntil, req.session.user!.id],
      )
      await client.query('COMMIT')
      res.status(401).json({
        error: lockedUntil
          ? 'PIN incorreto. O acesso à assinatura foi bloqueado por 15 minutos.'
          : `PIN incorreto. Restam ${maximumFailedAttempts - attempts} tentativa(s).`,
      })
      return
    }

    if (profile.signature_data_ciphertext && !isPersonalDataEncryptionConfigured()) {
      await client.query('ROLLBACK')
      res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY para consultar a assinatura do perfil.' })
      return
    }
    const signatureBase64 = profile.signature_data_ciphertext
      ? decryptPersonalData(profile.signature_data_ciphertext, 'user-signature')
      : null

    await client.query(
      `UPDATE users SET signature_pin_failed_attempts = 0, signature_pin_locked_until = NULL
       WHERE id = $1`,
      [req.session.user!.id],
    )
    await client.query('COMMIT')
    res.json({ signatureBase64 })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.put('/signature', async (req, res, next) => {
  const parsed = signatureSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados da assinatura inválidos.' })
    return
  }

  const signature = parsed.data.signatureBase64 === null
    ? null
    : Buffer.from(parsed.data.signatureBase64, 'base64')
  if (signature && (
    signature.length === 0 ||
    signature.length > 100 * 1024 ||
    signature.toString('base64') !== parsed.data.signatureBase64 ||
    !signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )) {
    res.status(400).json({ error: 'A assinatura deve ser uma imagem PNG válida de até 100 KiB.' })
    return
  }
  if (signature && !isPersonalDataEncryptionConfigured()) {
    res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY para salvar assinaturas de perfil.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      signature_data_ciphertext: string | null
      signature_pin_hash: string | null
      signature_pin_failed_attempts: number
      signature_pin_locked_until: Date | null
    }>(
      `SELECT signature_data_ciphertext, signature_pin_hash,
              signature_pin_failed_attempts, signature_pin_locked_until
       FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [req.session.user!.id],
    )
    const profile = result.rows[0]
    if (!profile) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Perfil não encontrado.' })
      return
    }

    if (profile.signature_pin_hash) {
      if (profile.signature_pin_locked_until && profile.signature_pin_locked_until > new Date()) {
        await client.query('ROLLBACK')
        res.status(429).json({ error: 'PIN temporariamente bloqueado após várias tentativas. Aguarde 15 minutos.' })
        return
      }
      const pinIsValid = parsed.data.pin
        ? await bcrypt.compare(parsed.data.pin, profile.signature_pin_hash)
        : false
      if (!pinIsValid) {
        const attempts = profile.signature_pin_locked_until && profile.signature_pin_locked_until <= new Date()
          ? 1
          : profile.signature_pin_failed_attempts + 1
        const lockedUntil = attempts >= maximumFailedAttempts
          ? new Date(Date.now() + lockDurationMs)
          : null
        await client.query(
          `UPDATE users SET signature_pin_failed_attempts = $1, signature_pin_locked_until = $2
           WHERE id = $3`,
          [attempts, lockedUntil, req.session.user!.id],
        )
        await client.query('COMMIT')
        res.status(401).json({
          error: lockedUntil
            ? 'PIN incorreto. O acesso à assinatura foi bloqueado por 15 minutos.'
            : `PIN incorreto. Restam ${maximumFailedAttempts - attempts} tentativa(s).`,
        })
        return
      }
    } else if (!parsed.data.newPin) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Cadastre um PIN para proteger sua assinatura.' })
      return
    }

    const signatureCiphertext = signature
      ? encryptPersonalData(signature.toString('base64'), 'user-signature')
      : profile.signature_pin_hash
        ? null
        : profile.signature_data_ciphertext
    const pinHash = parsed.data.newPin
      ? await bcrypt.hash(parsed.data.newPin, 12)
      : profile.signature_pin_hash
    await client.query(
      `UPDATE users
       SET signature_data_ciphertext = $1, signature_pin_hash = $2,
           signature_pin_failed_attempts = 0, signature_pin_locked_until = NULL,
           updated_at = now()
       WHERE id = $3`,
      [signatureCiphertext, pinHash, req.session.user!.id],
    )
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

export default router
