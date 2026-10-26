import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAdmin, requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import {
  decryptPersonalData,
  encryptPersonalData,
  fingerprintCpf,
  isPersonalDataEncryptionConfigured,
} from '../services/personal-data.js'

const router = Router()

const genders = ['feminino', 'masculino', 'outro', 'nao_informar'] as const

function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isValidCpf(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^([0-9])\1{10}$/.test(cpf)) return false
  const digits = cpf.split('').map(Number)
  const first = digits.slice(0, 9).reduce((total, digit, index) => total + digit * (10 - index), 0)
  const firstCheck = (first * 10) % 11 % 10
  const second = digits.slice(0, 10).reduce((total, digit, index) => total + digit * (11 - index), 0)
  const secondCheck = (second * 10) % 11 % 10
  return digits[9] === firstCheck && digits[10] === secondCheck
}

function getAge(birthDate: string) {
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number)
  const today = new Date()
  let years = today.getFullYear() - birthYear
  let months = today.getMonth() + 1 - birthMonth
  let days = today.getDate() - birthDay

  if (days < 0) {
    months -= 1
    days += new Date(today.getFullYear(), today.getMonth(), 0).getDate()
  }
  if (months < 0) {
    years -= 1
    months += 12
  }

  return { years, months, days }
}

const dateSchema = z.string().refine(isCalendarDate, 'Informe uma data válida.')

const childSchema = z.object({
  name: z.string().trim().min(2).max(120),
  birthDate: dateSchema,
  gender: z.enum(genders),
})

const roleKeySchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)

const roleSchema = z.object({
  label: z.string().trim().min(2).max(80),
})

const shirtSizeSchema = z.object({ name: z.string().trim().min(1).max(24) })
const uniformSchema = z.object({
  shirtSizeId: z.coerce.number().int().positive().nullable(),
  shirtShortSleeveQty: z.number().int().min(0).max(3),
  shirtLongSleeveQty: z.number().int().min(0).max(3),
  pantsSize: z.number().int().min(32).max(58).nullable(),
  bootSize: z.number().int().min(34).max(48).nullable(),
}).superRefine((value, context) => {
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty > 3) {
    context.addIssue({ code: 'custom', path: ['shirtLongSleeveQty'], message: 'A quantidade total de camisas não pode ultrapassar 3.' })
  }
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty > 0 && !value.shirtSizeId) {
    context.addIssue({ code: 'custom', path: ['shirtSizeId'], message: 'Selecione o tamanho da camisa.' })
  }
  if (value.pantsSize !== null && (value.pantsSize % 2 !== 0 || value.pantsSize > 58)) {
    context.addIssue({ code: 'custom', path: ['pantsSize'], message: 'O tamanho da calça deve ser par, entre 32 e 58.' })
  }
  if (value.bootSize !== null && value.bootSize > 48) {
    context.addIssue({ code: 'custom', path: ['bootSize'], message: 'O tamanho da bota deve estar entre 34 e 48.' })
  }
})
const uniformDeliverySchema = z.object({
  deliveryDate: dateSchema,
  shirtSizeId: z.coerce.number().int().positive().nullable(),
  shirtShortSleeveQty: z.number().int().min(0).max(99),
  shirtLongSleeveQty: z.number().int().min(0).max(99),
  pantsSize: z.number().int().min(32).max(58).nullable(),
  pantsQty: z.number().int().min(0).max(99),
  bootSize: z.number().int().min(34).max(48).nullable(),
  bootQty: z.number().int().min(0).max(99),
  delivererPin: z.string().regex(/^\d{6,12}$/),
  recipientSignatureBase64: z.string().min(4).max(140_000),
}).superRefine((value, context) => {
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty > 0 && !value.shirtSizeId) {
    context.addIssue({ code: 'custom', path: ['shirtSizeId'], message: 'Selecione o tamanho da camisa entregue.' })
  }
  if (value.pantsQty > 0 && value.pantsSize === null) {
    context.addIssue({ code: 'custom', path: ['pantsSize'], message: 'Selecione o tamanho da calça entregue.' })
  }
  if (value.bootQty > 0 && value.bootSize === null) {
    context.addIssue({ code: 'custom', path: ['bootSize'], message: 'Selecione o tamanho da bota entregue.' })
  }
  if (value.shirtShortSleeveQty + value.shirtLongSleeveQty + value.pantsQty + value.bootQty === 0) {
    context.addIssue({ code: 'custom', path: ['shirtShortSleeveQty'], message: 'Informe ao menos um item entregue.' })
  }
})

const collaboratorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nickname: z.string().trim().max(80).default(''),
  registrationNumber: z.string().trim().max(80).default('').transform((value) => value || null),
  role: roleKeySchema,
  cpf: z.string().transform((value) => value.replace(/\D/g, '') || null)
    .refine((value) => value === null || isValidCpf(value), 'Informe um CPF válido ou deixe o campo vazio.'),
  phone: z.string().trim().max(40).transform((value) => value || null)
    .refine((value) => value === null || value.length >= 8, 'Informe um telefone válido ou deixe o campo vazio.'),
  gender: z.enum(genders),
  birthDate: dateSchema,
  admissionDate: dateSchema,
  terminationDate: dateSchema.nullable(),
  isOnLeave: z.boolean(),
  leaveStartDate: dateSchema.nullable(),
  expectedReturnDate: dateSchema.nullable(),
  leaveReason: z.string().trim().max(2000).nullable(),
  hasChildren: z.boolean(),
  children: z.array(childSchema).max(30),
}).superRefine((value, context) => {
  const today = localDateString(new Date())
  if (value.birthDate > today) {
    context.addIssue({ code: 'custom', path: ['birthDate'], message: 'A data de nascimento não pode ser futura.' })
  }
  if (value.admissionDate > today) {
    context.addIssue({ code: 'custom', path: ['admissionDate'], message: 'A data de admissão não pode ser futura.' })
  }
  if (value.terminationDate && value.terminationDate < value.admissionDate) {
    context.addIssue({ code: 'custom', path: ['terminationDate'], message: 'O desligamento deve ocorrer após a admissão.' })
  }
  const leaveFieldsPresent = Boolean(value.leaveStartDate && value.expectedReturnDate && value.leaveReason)
  if (value.isOnLeave && !leaveFieldsPresent) {
    context.addIssue({ code: 'custom', path: ['leaveStartDate'], message: 'Preencha as datas e o motivo do afastamento.' })
  }
  if (!value.isOnLeave && (value.leaveStartDate || value.expectedReturnDate || value.leaveReason)) {
    context.addIssue({ code: 'custom', path: ['isOnLeave'], message: 'Desmarque o afastamento para remover seus dados.' })
  }
  if (value.leaveStartDate && value.leaveStartDate > today) {
    context.addIssue({ code: 'custom', path: ['leaveStartDate'], message: 'A data do afastamento não pode ser futura.' })
  }
  if (value.leaveStartDate && value.expectedReturnDate && value.expectedReturnDate < value.leaveStartDate) {
    context.addIssue({ code: 'custom', path: ['expectedReturnDate'], message: 'O retorno previsto deve ser após o início do afastamento.' })
  }
  if (value.hasChildren !== (value.children.length > 0)) {
    context.addIssue({ code: 'custom', path: ['children'], message: 'Informe os filhos ou desmarque a opção.' })
  }
  value.children.forEach((child, index) => {
    if (child.birthDate > today) {
      context.addIssue({ code: 'custom', path: ['children', index, 'birthDate'], message: 'A data de nascimento não pode ser futura.' })
    }
  })
})

const filtersSchema = z.object({
  search: z.string().trim().max(100).default(''),
  role: z.string().trim().max(80).default('all'),
  status: z.enum(['all', 'active', 'terminated']).default('all'),
  limit: z.coerce.number().int().min(1).max(5000).default(250),
})

function encryptionSetupRequired(res: import('express').Response) {
  if (isPersonalDataEncryptionConfigured()) return false
  res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY para cadastrar dados pessoais.' })
  return true
}

function isDuplicateCpf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && 'constraint' in error
    && error.code === '23505' && error.constraint === 'collaborators_cpf_fingerprint_unique'
}

function isDuplicateRegistrationNumber(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && 'constraint' in error
    && error.code === '23505' && error.constraint === 'collaborators_registration_number_unique'
}

function decodeSignature(value: string) {
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > 100 * 1024 || bytes.toString('base64') !== value ||
      !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return null
  }
  return bytes
}

router.use(requireAuth, requirePageAccess('collaborators'))

router.get('/roles', async (_req, res, next) => {
  try {
    const result = await pool.query<{ role_key: string; label: string }>(
      'SELECT role_key, label FROM collaborator_roles ORDER BY lower(label), role_key',
    )
    res.json({ roles: result.rows.map(({ role_key, label }) => ({ value: role_key, label })) })
  } catch (error) {
    next(error)
  }
})

router.post('/roles', async (req, res, next) => {
  const parsed = roleSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe uma função com um nome entre 2 e 80 caracteres.' })
    return
  }

  const label = parsed.data.label
  const roleKey = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80).replace(/_+$/g, '')
  const validKey = roleKeySchema.safeParse(roleKey)
  if (!validKey.success) {
    res.status(400).json({ error: 'O nome da função precisa conter letras ou números.' })
    return
  }

  try {
    const result = await pool.query<{ role_key: string; label: string }>(
      `INSERT INTO collaborator_roles (role_key, label)
       VALUES ($1, $2)
       ON CONFLICT (role_key) DO NOTHING
       RETURNING role_key, label`,
      [roleKey, label],
    )
    if (!result.rows[0]) {
      res.status(409).json({ error: 'Já existe uma função com esse nome.' })
      return
    }
    res.status(201).json({ role: { value: result.rows[0].role_key, label: result.rows[0].label } })
  } catch (error) {
    next(error)
  }
})

router.get('/uniform-options', async (_req, res, next) => {
  try {
    const result = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM collaborator_shirt_sizes ORDER BY lower(name), id',
    )
    res.json({
      shirtSizes: result.rows.map((size) => ({ id: Number(size.id), name: size.name })),
      pantsSizes: Array.from({ length: 14 }, (_, index) => 32 + index * 2),
      bootSizes: Array.from({ length: 15 }, (_, index) => 34 + index),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/shirt-sizes', requireAdmin, async (req, res, next) => {
  const parsed = shirtSizeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Informe um tamanho de camisa válido, com até 24 caracteres.' })
    return
  }
  try {
    const result = await pool.query<{ id: string; name: string }>(
      `INSERT INTO collaborator_shirt_sizes (name)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id, name`,
      [parsed.data.name],
    )
    if (!result.rowCount) {
      res.status(409).json({ error: 'Esse tamanho de camisa já está cadastrado.' })
      return
    }
    res.status(201).json({ shirtSize: { id: Number(result.rows[0].id), name: result.rows[0].name } })
  } catch (error) {
    next(error)
  }
})

router.get('/birthdays', async (_req, res, next) => {
  try {
    const result = await pool.query<{
      id: string
      name: string
      role: string
      birth_date_ciphertext: string
      admission_date: string
      termination_date: string | null
    }>(
      `SELECT id, name, role, birth_date_ciphertext, admission_date::text, termination_date::text
       FROM collaborators
       WHERE termination_date IS NULL OR termination_date > CURRENT_DATE
       ORDER BY lower(name), id`,
    )
    const today = new Date()
    type MonthKey = 'previous' | 'current' | 'next'
    const monthOffset = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const targetMonths = [-1, 0, 1].map((offset) => {
      const date = monthOffset(offset)
      const key: MonthKey = offset === -1 ? 'previous' : offset === 0 ? 'current' : 'next'
      return {
        key,
        month: date.getMonth(),
        year: date.getFullYear(),
        label: new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(date),
      }
    })
    type WorkAnniversary = {
      id: string
      name: string
      role: string
      day: number
      years: number
      months: number
      days: number
      admissionDate: string
      year: number
    }
    const birthdays: Record<MonthKey, { label: string; people: Array<{
      id: string
      name: string
      role: string
      day: number
      month: number
    }> }> = {
      previous: { label: targetMonths[0].label, people: [] },
      current: { label: targetMonths[1].label, people: [] },
      next: { label: targetMonths[2].label, people: [] },
    }
    const workAnniversaries: Record<MonthKey, { label: string; people: WorkAnniversary[] }> = {
      previous: { label: targetMonths[0].label, people: [] },
      current: { label: targetMonths[1].label, people: [] },
      next: { label: targetMonths[2].label, people: [] },
    }

    for (const collaborator of result.rows) {
      const birthDate = decryptPersonalData(collaborator.birth_date_ciphertext, 'birth-date')
      const [, birthMonth, birthDay] = birthDate.split('-').map(Number)
      for (const target of targetMonths) {
        if (birthMonth === target.month + 1) {
          birthdays[target.key].people.push({
            id: collaborator.id,
            name: collaborator.name,
            role: collaborator.role,
            day: birthDay,
            month: birthMonth,
          })
        }
      }

      const [admissionYear, admissionMonth, admissionDay] = collaborator.admission_date.split('-').map(Number)
      for (const target of targetMonths) {
        const years = target.year - admissionYear
        if (admissionMonth === target.month + 1 && years > 0) {
          let elapsedYears = today.getFullYear() - admissionYear
          let elapsedMonths = today.getMonth() + 1 - admissionMonth
          let elapsedDays = today.getDate() - admissionDay
          if (elapsedDays < 0) {
            elapsedMonths -= 1
            elapsedDays += new Date(today.getFullYear(), today.getMonth(), 0).getDate()
          }
          if (elapsedMonths < 0) {
            elapsedYears -= 1
            elapsedMonths += 12
          }

          workAnniversaries[target.key].people.push({
            id: collaborator.id,
            name: collaborator.name,
            role: collaborator.role,
            day: admissionDay,
            years,
            months: elapsedMonths,
            days: elapsedDays,
            admissionDate: collaborator.admission_date,
            year: target.year,
          })
        }
      }
    }

    for (const target of targetMonths) {
      birthdays[target.key].people.sort((a, b) =>
        a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'),
      )
    }
    for (const target of targetMonths) {
      workAnniversaries[target.key].people.sort((a, b) =>
        a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'),
      )
    }
    res.json({ birthdays, workAnniversaries })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/photo', async (req, res, next) => {
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!collaboratorId.success) {
    res.status(400).json({ error: 'Identificador de colaborador inválido.' })
    return
  }
  try {
    const result = await pool.query<{ photo_content_type: string; photo_content: Buffer }>(
      `SELECT photo_content_type, photo_content FROM collaborators
       WHERE id = $1 AND photo_content IS NOT NULL`,
      [collaboratorId.data],
    )
    if (!result.rows[0]) {
      res.status(404).json({ error: 'Foto não encontrada.' })
      return
    }
    res.setHeader('Content-Type', result.rows[0].photo_content_type)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(result.rows[0].photo_content)
  } catch (error) {
    next(error)
  }
})

router.put('/:id/uniform', async (req, res, next) => {
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = uniformSchema.safeParse(req.body)
  if (!collaboratorId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados de fardamento inválidos.' })
    return
  }
  try {
    if (parsed.data.shirtSizeId) {
      const size = await pool.query('SELECT 1 FROM collaborator_shirt_sizes WHERE id = $1', [parsed.data.shirtSizeId])
      if (!size.rowCount) {
        res.status(400).json({ error: 'O tamanho de camisa selecionado não existe.' })
        return
      }
    }
    const result = await pool.query(
      `UPDATE collaborators SET shirt_size_id = $1, shirt_short_sleeve_qty = $2,
         shirt_long_sleeve_qty = $3, pants_size = $4, boot_size = $5, updated_at = now()
       WHERE id = $6 RETURNING id`,
      [parsed.data.shirtSizeId, parsed.data.shirtShortSleeveQty, parsed.data.shirtLongSleeveQty,
        parsed.data.pantsSize, parsed.data.bootSize, collaboratorId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.post('/:id/uniform-deliveries', async (req, res, next) => {
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = uniformDeliverySchema.safeParse(req.body)
  if (!collaboratorId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados de entrega inválidos.' })
    return
  }
  if (!isPersonalDataEncryptionConfigured()) {
    res.status(503).json({ error: 'Configure PII_ENCRYPTION_KEY para registrar a entrega e suas assinaturas.' })
    return
  }
  const recipientSignature = decodeSignature(parsed.data.recipientSignatureBase64)
  if (!recipientSignature) {
    res.status(400).json({ error: 'A assinatura de quem recebe deve ser uma imagem PNG válida de até 100 KiB.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const collaborator = await client.query('SELECT 1 FROM collaborators WHERE id = $1 FOR UPDATE', [collaboratorId.data])
    if (!collaborator.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }
    const deliverer = await client.query<{
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
    const profile = deliverer.rows[0]
    if (!profile?.signature_pin_hash || !profile.signature_data_ciphertext) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Cadastre uma assinatura e um PIN no perfil antes de registrar entregas.' })
      return
    }
    if (profile.signature_pin_locked_until && profile.signature_pin_locked_until > new Date()) {
      await client.query('ROLLBACK')
      res.status(429).json({ error: 'PIN temporariamente bloqueado após várias tentativas. Aguarde 15 minutos.' })
      return
    }
    if (!await bcrypt.compare(parsed.data.delivererPin, profile.signature_pin_hash)) {
      const attempts = profile.signature_pin_locked_until && profile.signature_pin_locked_until <= new Date()
        ? 1
        : profile.signature_pin_failed_attempts + 1
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
      await client.query(
        `UPDATE users SET signature_pin_failed_attempts = $1, signature_pin_locked_until = $2
         WHERE id = $3`,
        [attempts, lockedUntil, req.session.user!.id],
      )
      await client.query('COMMIT')
      res.status(401).json({
        error: lockedUntil
          ? 'PIN incorreto. O acesso à assinatura foi bloqueado por 15 minutos.'
          : `PIN incorreto. Restam ${5 - attempts} tentativa(s).`,
      })
      return
    }
    const delivererSignatureBase64 = decryptPersonalData(profile.signature_data_ciphertext, 'user-signature')
    const delivererSignature = decodeSignature(delivererSignatureBase64)
    if (!delivererSignature) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'A assinatura do perfil está inválida. Atualize-a antes de registrar a entrega.' })
      return
    }
    await client.query(
      `UPDATE users SET signature_pin_failed_attempts = 0, signature_pin_locked_until = NULL
       WHERE id = $1`,
      [req.session.user!.id],
    )
    if (parsed.data.shirtSizeId) {
      const size = await client.query('SELECT 1 FROM collaborator_shirt_sizes WHERE id = $1', [parsed.data.shirtSizeId])
      if (!size.rowCount) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'O tamanho de camisa selecionado não existe.' })
        return
      }
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO collaborator_uniform_deliveries (
         collaborator_id, delivery_date, shirt_size_id, shirt_short_sleeve_qty, shirt_long_sleeve_qty,
         pants_size, pants_qty, boot_size, boot_qty, deliverer_user_id,
         deliverer_signature_ciphertext, recipient_signature_ciphertext
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        collaboratorId.data, parsed.data.deliveryDate, parsed.data.shirtSizeId,
        parsed.data.shirtShortSleeveQty, parsed.data.shirtLongSleeveQty,
        parsed.data.pantsSize, parsed.data.pantsQty, parsed.data.bootSize, parsed.data.bootQty,
        req.session.user!.id,
        encryptPersonalData(delivererSignatureBase64, 'uniform-delivery-signature'),
        encryptPersonalData(parsed.data.recipientSignatureBase64, 'uniform-delivery-signature'),
      ],
    )
    await client.query('COMMIT')
    res.status(201).json({ id: Number(inserted.rows[0].id) })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.put('/:id/photo', async (req, res, next) => {
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = z.object({
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    contentBase64: z.string().min(4).max(2_800_000),
  }).safeParse(req.body)
  if (!collaboratorId.success || !parsed.success) {
    res.status(400).json({ error: 'Foto inválida ou maior que 2 MiB.' })
    return
  }
  const content = Buffer.from(parsed.data.contentBase64, 'base64')
  const signatures: Record<string, (bytes: Buffer) => boolean> = {
    'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': (bytes) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  }
  if (content.length === 0 || content.length > 2 * 1024 * 1024 ||
      content.toString('base64') !== parsed.data.contentBase64 ||
      !signatures[parsed.data.contentType](content)) {
    res.status(400).json({ error: 'A foto deve ser JPEG, PNG ou WebP e ter no máximo 2 MiB.' })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE collaborators SET photo_content_type = $1, photo_content = $2, updated_at = now()
       WHERE id = $3 RETURNING id`,
      [parsed.data.contentType, content, collaboratorId.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

router.get('/', async (req, res, next) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Filtros de colaboradores inválidos.' })
    return
  }

  const { search, role, status, limit } = parsed.data
  const prefix = search ? `${search.toLowerCase()}%` : ''

  try {
    if (role !== 'all') {
      const knownRole = await pool.query('SELECT 1 FROM collaborator_roles WHERE role_key = $1', [role])
      if (!knownRole.rowCount) {
        res.status(400).json({ error: 'A função selecionada não existe.' })
        return
      }
    }
    const result = await pool.query<{
      id: string
      name: string
      nickname: string
      registration_number: string | null
      role: string
      role_label: string
      has_photo: boolean
      birth_date_ciphertext: string
      is_active: boolean
      is_on_leave: boolean
      programming_count: number
      shirt_size: string | null
      shirt_short_sleeve_qty: number
      shirt_long_sleeve_qty: number
      pants_size: number | null
      boot_size: number | null
      elapsed_years: number
      elapsed_months: number
      elapsed_days: number
    }>(
      `SELECT c.id, c.name, c.nickname, c.registration_number, c.role, r.label AS role_label,
              (c.photo_content IS NOT NULL) AS has_photo, c.birth_date_ciphertext,
              shirt_size.name AS shirt_size, c.shirt_short_sleeve_qty, c.shirt_long_sleeve_qty,
              c.pants_size, c.boot_size,
              (c.termination_date IS NULL OR c.termination_date > CURRENT_DATE) AS is_active,
              c.is_on_leave,
              (SELECT count(*)::int FROM ticket_programming p WHERE p.collaborator_id = c.id) AS programming_count,
              EXTRACT(YEAR FROM age(CURRENT_DATE,
                CASE WHEN c.termination_date IS NULL OR c.termination_date > CURRENT_DATE
                     THEN c.admission_date ELSE c.termination_date END))::int AS elapsed_years,
              EXTRACT(MONTH FROM age(CURRENT_DATE,
                CASE WHEN c.termination_date IS NULL OR c.termination_date > CURRENT_DATE
                     THEN c.admission_date ELSE c.termination_date END))::int AS elapsed_months,
              EXTRACT(DAY FROM age(CURRENT_DATE,
                CASE WHEN c.termination_date IS NULL OR c.termination_date > CURRENT_DATE
                     THEN c.admission_date ELSE c.termination_date END))::int AS elapsed_days
       FROM collaborators c
       JOIN collaborator_roles r ON r.role_key = c.role
       LEFT JOIN collaborator_shirt_sizes shirt_size ON shirt_size.id = c.shirt_size_id
       WHERE ($1 = '' OR lower(c.name) LIKE $1 OR lower(c.nickname) LIKE $1)
         AND ($2 = 'all' OR c.role = $2)
         AND ($3 = 'all'
           OR ($3 = 'active' AND (c.termination_date IS NULL OR c.termination_date > CURRENT_DATE))
           OR ($3 = 'terminated' AND c.termination_date <= CURRENT_DATE))
       ORDER BY lower(c.name), c.id
       LIMIT $4`,
      [prefix, role, status, limit],
    )

    res.json({
      collaborators: result.rows.map((collaborator) => {
        const age = getAge(decryptPersonalData(collaborator.birth_date_ciphertext, 'birth-date'))
        return {
          id: collaborator.id,
          name: collaborator.name,
          nickname: collaborator.nickname,
          registration_number: collaborator.registration_number,
          role: collaborator.role,
          role_label: collaborator.role_label,
          photo_url: collaborator.has_photo ? `/api/collaborators/${collaborator.id}/photo` : null,
          age_years: age.years,
          age_months: age.months,
          age_days: age.days,
          is_active: collaborator.is_active,
          is_on_leave: collaborator.is_on_leave,
          shirt_size: collaborator.shirt_size,
          shirt_short_sleeve_qty: collaborator.shirt_short_sleeve_qty,
          shirt_long_sleeve_qty: collaborator.shirt_long_sleeve_qty,
          pants_size: collaborator.pants_size,
          boot_size: collaborator.boot_size,
          programming_count: collaborator.programming_count,
          elapsed_years: collaborator.elapsed_years,
          elapsed_months: collaborator.elapsed_months,
          elapsed_days: collaborator.elapsed_days,
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  if (encryptionSetupRequired(res)) return
  const parsed = collaboratorSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Dados do colaborador inválidos.' })
    return
  }

  const data = parsed.data
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const knownRole = await client.query('SELECT 1 FROM collaborator_roles WHERE role_key = $1', [data.role])
    if (!knownRole.rowCount) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione uma função cadastrada.' })
      return
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO collaborators (
        name, nickname, registration_number, role, cpf_ciphertext, cpf_fingerprint, phone_ciphertext,
        gender, birth_date_ciphertext, admission_date, termination_date, has_children,
        is_on_leave, leave_start_date_ciphertext, expected_return_date_ciphertext,
        leave_reason_ciphertext, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       RETURNING id`,
      [
        data.name,
        data.nickname,
        data.registrationNumber,
        data.role,
        data.cpf ? encryptPersonalData(data.cpf, 'cpf') : null,
        data.cpf ? fingerprintCpf(data.cpf) : null,
        data.phone ? encryptPersonalData(data.phone, 'phone') : null,
        data.gender,
        encryptPersonalData(data.birthDate, 'birth-date'),
        data.admissionDate,
        data.terminationDate,
        data.hasChildren,
        data.isOnLeave,
        data.leaveStartDate ? encryptPersonalData(data.leaveStartDate, 'leave-start-date') : null,
        data.expectedReturnDate ? encryptPersonalData(data.expectedReturnDate, 'expected-return-date') : null,
        data.leaveReason ? encryptPersonalData(data.leaveReason, 'leave-reason') : null,
        req.session.user!.id,
      ],
    )
    const collaboratorId = inserted.rows[0].id

    if (data.isOnLeave && data.leaveStartDate && data.expectedReturnDate && data.leaveReason) {
      await client.query(
        `INSERT INTO collaborator_leave_history (
           collaborator_id, start_date_ciphertext, expected_return_date_ciphertext,
           reason_ciphertext, created_by
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          collaboratorId,
          encryptPersonalData(data.leaveStartDate, 'leave-start-date'),
          encryptPersonalData(data.expectedReturnDate, 'expected-return-date'),
          encryptPersonalData(data.leaveReason, 'leave-reason'),
          req.session.user!.id,
        ],
      )
    }

    for (const child of data.children) {
      await client.query(
        `INSERT INTO collaborator_children (collaborator_id, name_ciphertext, birth_date_ciphertext, gender_ciphertext)
         VALUES ($1, $2, $3, $4)`,
        [
          collaboratorId,
          encryptPersonalData(child.name, 'child-name'),
          encryptPersonalData(child.birthDate, 'child-birth-date'),
          encryptPersonalData(child.gender, 'child-gender'),
        ],
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ id: collaboratorId })
  } catch (error) {
    await client.query('ROLLBACK')
    if (isDuplicateCpf(error)) {
      res.status(409).json({ error: 'Já existe um colaborador cadastrado com esse CPF.' })
      return
    }
    if (isDuplicateRegistrationNumber(error)) {
      res.status(409).json({ error: 'Já existe um colaborador cadastrado com essa matrícula.' })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res, next) => {
  if (encryptionSetupRequired(res)) return
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  const parsed = collaboratorSchema.safeParse(req.body)
  if (!collaboratorId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? 'Identificador inválido.' : parsed.error.issues[0]?.message ?? 'Dados inválidos.' })
    return
  }

  const data = parsed.data
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const previousLeave = await client.query<{
      is_on_leave: boolean
      leave_start_date_ciphertext: string | null
      expected_return_date_ciphertext: string | null
      leave_reason_ciphertext: string | null
    }>(
      `SELECT is_on_leave, leave_start_date_ciphertext, expected_return_date_ciphertext, leave_reason_ciphertext
       FROM collaborators WHERE id = $1 FOR UPDATE`,
      [collaboratorId.data],
    )
    if (!previousLeave.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }
    const knownRole = await client.query('SELECT 1 FROM collaborator_roles WHERE role_key = $1', [data.role])
    if (!knownRole.rowCount) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Selecione uma função cadastrada.' })
      return
    }
    const updated = await client.query(
      `UPDATE collaborators SET
        name = $1, nickname = $2, registration_number = $3, role = $4,
        cpf_ciphertext = $5, cpf_fingerprint = $6, phone_ciphertext = $7,
        gender = $8, birth_date_ciphertext = $9, admission_date = $10,
        termination_date = $11, has_children = $12, is_on_leave = $13,
        leave_start_date_ciphertext = $14, expected_return_date_ciphertext = $15,
        leave_reason_ciphertext = $16, updated_by = $17, updated_at = now()
             WHERE id = $18 RETURNING id`,
      [
        data.name,
        data.nickname,
        data.registrationNumber,
        data.role,
        data.cpf ? encryptPersonalData(data.cpf, 'cpf') : null,
        data.cpf ? fingerprintCpf(data.cpf) : null,
        data.phone ? encryptPersonalData(data.phone, 'phone') : null,
        data.gender,
        encryptPersonalData(data.birthDate, 'birth-date'),
        data.admissionDate,
        data.terminationDate,
        data.hasChildren,
        data.isOnLeave,
        data.leaveStartDate ? encryptPersonalData(data.leaveStartDate, 'leave-start-date') : null,
        data.expectedReturnDate ? encryptPersonalData(data.expectedReturnDate, 'expected-return-date') : null,
        data.leaveReason ? encryptPersonalData(data.leaveReason, 'leave-reason') : null,
        req.session.user!.id,
        collaboratorId.data,
      ],
    )

    if (updated.rowCount === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }

    const previous = previousLeave.rows[0]
    const leaveChanged = previous.is_on_leave !== data.isOnLeave ||
      (data.isOnLeave && (
        !previous.leave_start_date_ciphertext || !previous.expected_return_date_ciphertext || !previous.leave_reason_ciphertext ||
        decryptPersonalData(previous.leave_start_date_ciphertext, 'leave-start-date') !== data.leaveStartDate ||
        decryptPersonalData(previous.expected_return_date_ciphertext, 'expected-return-date') !== data.expectedReturnDate ||
        decryptPersonalData(previous.leave_reason_ciphertext, 'leave-reason') !== data.leaveReason
      ))
    if (leaveChanged) {
      await client.query(
        `UPDATE collaborator_leave_history
         SET is_current = FALSE, ended_at = CURRENT_DATE
         WHERE collaborator_id = $1 AND is_current`,
        [collaboratorId.data],
      )
      if (data.isOnLeave && data.leaveStartDate && data.expectedReturnDate && data.leaveReason) {
        await client.query(
          `INSERT INTO collaborator_leave_history (
             collaborator_id, start_date_ciphertext, expected_return_date_ciphertext,
             reason_ciphertext, created_by
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            collaboratorId.data,
            encryptPersonalData(data.leaveStartDate, 'leave-start-date'),
            encryptPersonalData(data.expectedReturnDate, 'expected-return-date'),
            encryptPersonalData(data.leaveReason, 'leave-reason'),
            req.session.user!.id,
          ],
        )
      }
    }

    await client.query('DELETE FROM collaborator_children WHERE collaborator_id = $1', [collaboratorId.data])
    for (const child of data.children) {
      await client.query(
        `INSERT INTO collaborator_children (collaborator_id, name_ciphertext, birth_date_ciphertext, gender_ciphertext)
         VALUES ($1, $2, $3, $4)`,
        [
          collaboratorId.data,
          encryptPersonalData(child.name, 'child-name'),
          encryptPersonalData(child.birthDate, 'child-birth-date'),
          encryptPersonalData(child.gender, 'child-gender'),
        ],
      )
    }

    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    if (isDuplicateCpf(error)) {
      res.status(409).json({ error: 'Já existe um colaborador cadastrado com esse CPF.' })
      return
    }
    if (isDuplicateRegistrationNumber(error)) {
      res.status(409).json({ error: 'Já existe um colaborador cadastrado com essa matrícula.' })
      return
    }
    next(error)
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res, next) => {
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!collaboratorId.success) {
    res.status(400).json({ error: 'Identificador de colaborador inválido.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const collaborator = await client.query<{ name: string }>(
      'SELECT name FROM collaborators WHERE id = $1 FOR UPDATE',
      [collaboratorId.data],
    )
    if (!collaborator.rowCount) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }

    const appointments = await client.query<{
      id: string
      ticket_id: string
      protocol: string
      activity_description: string
      starts_at: Date
      ends_at: Date
    }>(
      `SELECT p.id, p.ticket_id, t.protocol, p.activity_description, p.starts_at, p.ends_at
       FROM ticket_programming p
       JOIN tickets t ON t.source_id = p.ticket_id
       WHERE p.collaborator_id = $1
       ORDER BY p.starts_at, p.id`,
      [collaboratorId.data],
    )

    await client.query(
      `UPDATE collaborator_sensitive_data_access
       SET collaborator_name_snapshot = $1
       WHERE collaborator_id = $2`,
      [collaborator.rows[0].name, collaboratorId.data],
    )

    for (const appointment of appointments.rows) {
      await client.query(
        `INSERT INTO ticket_activity_history (ticket_id, actor_id, event_type, summary, details)
         VALUES ($1, $2, 'programming_deleted', $3, $4)`,
        [
          appointment.ticket_id,
          req.session.user!.id,
          `Excluiu a programação de ${collaborator.rows[0].name} do protocolo ${appointment.protocol} ao excluir o cadastro do colaborador.`,
          JSON.stringify({
            programmingId: appointment.id,
            collaboratorId: collaboratorId.data,
            collaboratorName: collaborator.rows[0].name,
            protocol: appointment.protocol,
            activityDescription: appointment.activity_description,
            startsAt: appointment.starts_at,
            endsAt: appointment.ends_at,
            reason: 'collaborator_deleted',
          }),
        ],
      )
    }

    await client.query(
      'DELETE FROM ticket_programming WHERE collaborator_id = $1',
      [collaboratorId.data],
    )
    await client.query('DELETE FROM collaborators WHERE id = $1', [collaboratorId.data])
    await client.query('COMMIT')
    res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

router.get('/:id/report', async (req, res, next) => {
  if (encryptionSetupRequired(res)) return
  const collaboratorId = z.coerce.number().int().positive().safeParse(req.params.id)
  if (!collaboratorId.success) {
    res.status(400).json({ error: 'Identificador de colaborador inválido.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      id: string
      name: string
      nickname: string
      role: string
      registration_number: string | null
      cpf_ciphertext: string | null
      phone_ciphertext: string | null
      gender: string
      birth_date_ciphertext: string
      admission_date: string
      termination_date: string | null
      has_children: boolean
      is_on_leave: boolean
      leave_start_date_ciphertext: string | null
      expected_return_date_ciphertext: string | null
      leave_reason_ciphertext: string | null
      has_photo: boolean
      shirt_size_id: string | null
      shirt_size: string | null
      shirt_short_sleeve_qty: number
      shirt_long_sleeve_qty: number
      pants_size: number | null
      boot_size: number | null
    }>(
      `SELECT collaborator.id, collaborator.name, collaborator.nickname, collaborator.role,
              collaborator.registration_number, collaborator.cpf_ciphertext, collaborator.phone_ciphertext,
              collaborator.gender, collaborator.birth_date_ciphertext, collaborator.admission_date,
              collaborator.termination_date, collaborator.has_children, collaborator.is_on_leave,
              collaborator.leave_start_date_ciphertext, collaborator.expected_return_date_ciphertext,
              collaborator.leave_reason_ciphertext, (collaborator.photo_content IS NOT NULL) AS has_photo,
              collaborator.shirt_size_id, shirt_size.name AS shirt_size,
              collaborator.shirt_short_sleeve_qty, collaborator.shirt_long_sleeve_qty,
              collaborator.pants_size, collaborator.boot_size
       FROM collaborators collaborator
       LEFT JOIN collaborator_shirt_sizes shirt_size ON shirt_size.id = collaborator.shirt_size_id
       WHERE collaborator.id = $1`,
      [collaboratorId.data],
    )
    const collaborator = result.rows[0]

    if (!collaborator) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Colaborador não encontrado.' })
      return
    }

    const children = await client.query<{
      name_ciphertext: string
      birth_date_ciphertext: string
      gender_ciphertext: string
    }>(
      `SELECT name_ciphertext, birth_date_ciphertext, gender_ciphertext
       FROM collaborator_children WHERE collaborator_id = $1 ORDER BY id`,
      [collaboratorId.data],
    )
    const leaves = await client.query<{
      id: string
      start_date_ciphertext: string
      expected_return_date_ciphertext: string
      reason_ciphertext: string
      is_current: boolean
      ended_at: string | null
    }>(
      `SELECT id, start_date_ciphertext, expected_return_date_ciphertext, reason_ciphertext,
              is_current, ended_at::text
       FROM collaborator_leave_history WHERE collaborator_id = $1
       ORDER BY is_current DESC, created_at DESC, id DESC`,
      [collaboratorId.data],
    )
    const deliveries = await client.query<{
      id: string
      delivery_date: string
      shirt_size: string | null
      shirt_short_sleeve_qty: number
      shirt_long_sleeve_qty: number
      pants_size: number | null
      pants_qty: number
      boot_size: number | null
      boot_qty: number
      deliverer_name: string
      deliverer_signature_ciphertext: string
      recipient_signature_ciphertext: string
    }>(
      `SELECT delivery.id, delivery.delivery_date::text, shirt.name AS shirt_size,
              delivery.shirt_short_sleeve_qty, delivery.shirt_long_sleeve_qty,
              delivery.pants_size, delivery.pants_qty, delivery.boot_size, delivery.boot_qty,
              user_account.display_name AS deliverer_name,
              delivery.deliverer_signature_ciphertext, delivery.recipient_signature_ciphertext
       FROM collaborator_uniform_deliveries delivery
       LEFT JOIN collaborator_shirt_sizes shirt ON shirt.id = delivery.shirt_size_id
       JOIN users user_account ON user_account.id = delivery.deliverer_user_id
       WHERE delivery.collaborator_id = $1
       ORDER BY delivery.delivery_date DESC, delivery.id DESC`,
      [collaboratorId.data],
    )
    const inventoryHistory = await client.query<{
      id: string
      transaction_date: string
      document_type: 'epi_delivery' | 'tool_delivery' | 'tool_return'
      deliverer_name: string
      deliverer_signature_ciphertext: string
      recipient_signature_ciphertext: string
      item_name: string
      quantity: string
      unit_name: string
    }>(
      `SELECT document.id, document.transaction_date::text, document.document_type,
              user_account.display_name AS deliverer_name,
              document.deliverer_signature_ciphertext, document.recipient_signature_ciphertext,
              item.name AS item_name, line.quantity::text, line.unit_name
       FROM inventory_documents document
       JOIN users user_account ON user_account.id = document.created_by
       JOIN inventory_document_items line ON line.document_id = document.id
       JOIN inventory_items item ON item.id = line.item_id
       WHERE document.collaborator_id = $1
         AND document.document_type IN ('epi_delivery', 'tool_delivery', 'tool_return')
       ORDER BY document.transaction_date DESC, document.id DESC, line.id`,
      [collaboratorId.data],
    )
    await client.query(
      `INSERT INTO collaborator_sensitive_data_access (collaborator_id, accessed_by)
       VALUES ($1, $2)`,
      [collaboratorId.data, req.session.user!.id],
    )
    await client.query('COMMIT')

    const inventoryDeliveries = new Map<number, {
      id: number
      deliveryDate: string
      type: 'epi_delivery' | 'tool_delivery' | 'tool_return'
      delivererName: string
      delivererSignatureBase64: string
      recipientSignatureBase64: string
      items: { name: string; quantity: number; unitName: string }[]
    }>()
    for (const entry of inventoryHistory.rows) {
      const id = Number(entry.id)
      let record = inventoryDeliveries.get(id)
      if (!record) {
        record = {
          id,
          deliveryDate: entry.transaction_date,
          type: entry.document_type,
          delivererName: entry.deliverer_name,
          delivererSignatureBase64: decryptPersonalData(entry.deliverer_signature_ciphertext, 'inventory-delivery-signature'),
          recipientSignatureBase64: decryptPersonalData(entry.recipient_signature_ciphertext, 'inventory-delivery-signature'),
          items: [],
        }
        inventoryDeliveries.set(id, record)
      }
      record.items.push({ name: entry.item_name, quantity: Number(entry.quantity), unitName: entry.unit_name })
    }

    res.json({
      report: {
        id: collaborator.id,
        name: collaborator.name,
        nickname: collaborator.nickname,
        role: collaborator.role,
        registrationNumber: collaborator.registration_number ?? '',
        cpf: collaborator.cpf_ciphertext ? decryptPersonalData(collaborator.cpf_ciphertext, 'cpf') : '',
        phone: collaborator.phone_ciphertext ? decryptPersonalData(collaborator.phone_ciphertext, 'phone') : '',
        gender: collaborator.gender,
        birthDate: decryptPersonalData(collaborator.birth_date_ciphertext, 'birth-date'),
        admissionDate: collaborator.admission_date,
        terminationDate: collaborator.termination_date,
        hasChildren: collaborator.has_children,
        children: children.rows.map((child) => ({
          name: decryptPersonalData(child.name_ciphertext, 'child-name'),
          birthDate: decryptPersonalData(child.birth_date_ciphertext, 'child-birth-date'),
          gender: decryptPersonalData(child.gender_ciphertext, 'child-gender'),
        })),
        isOnLeave: collaborator.is_on_leave,
        leaveStartDate: collaborator.leave_start_date_ciphertext
          ? decryptPersonalData(collaborator.leave_start_date_ciphertext, 'leave-start-date')
          : null,
        expectedReturnDate: collaborator.expected_return_date_ciphertext
          ? decryptPersonalData(collaborator.expected_return_date_ciphertext, 'expected-return-date')
          : null,
        leaveReason: collaborator.leave_reason_ciphertext
          ? decryptPersonalData(collaborator.leave_reason_ciphertext, 'leave-reason')
          : null,
        photoUrl: collaborator.has_photo ? `/api/collaborators/${collaborator.id}/photo` : null,
        uniform: {
          shirtSizeId: collaborator.shirt_size_id ? Number(collaborator.shirt_size_id) : null,
          shirtSize: collaborator.shirt_size,
          shirtShortSleeveQty: collaborator.shirt_short_sleeve_qty,
          shirtLongSleeveQty: collaborator.shirt_long_sleeve_qty,
          pantsSize: collaborator.pants_size,
          bootSize: collaborator.boot_size,
        },
        leaveHistory: leaves.rows.map((leave) => ({
          id: Number(leave.id),
          startDate: decryptPersonalData(leave.start_date_ciphertext, 'leave-start-date'),
          expectedReturnDate: decryptPersonalData(leave.expected_return_date_ciphertext, 'expected-return-date'),
          reason: decryptPersonalData(leave.reason_ciphertext, 'leave-reason'),
          current: leave.is_current,
          endedAt: leave.ended_at,
        })),
        uniformDeliveries: deliveries.rows.map((delivery) => ({
          id: Number(delivery.id),
          deliveryDate: delivery.delivery_date,
          shirtSize: delivery.shirt_size,
          shirtShortSleeveQty: delivery.shirt_short_sleeve_qty,
          shirtLongSleeveQty: delivery.shirt_long_sleeve_qty,
          pantsSize: delivery.pants_size,
          pantsQty: delivery.pants_qty,
          bootSize: delivery.boot_size,
          bootQty: delivery.boot_qty,
          delivererName: delivery.deliverer_name,
          delivererSignatureBase64: decryptPersonalData(delivery.deliverer_signature_ciphertext, 'uniform-delivery-signature'),
          recipientSignatureBase64: decryptPersonalData(delivery.recipient_signature_ciphertext, 'uniform-delivery-signature'),
        })),
        inventoryDeliveries: [...inventoryDeliveries.values()],
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

export default router