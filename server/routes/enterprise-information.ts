import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'

const router = Router()

const optionalEmail = z.string().trim().max(254).email().or(z.literal(''))
const nullableDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  })
  .nullable()
const informationSchema = z.object({
  enterpriseName: z.string().trim().min(1).max(240),
  syndicName: z.string().trim().max(160),
  syndicPhone: z.string().trim().max(40),
  syndicEmail: optionalEmail,
  supervisorName: z.string().trim().max(160),
  supervisorPhone: z.string().trim().max(40),
  supervisorEmail: optionalEmail,
  condominiumEmail: optionalEmail,
  workAddress: z.string().trim().max(500),
  occupancyPermitDate: nullableDate,
  condominiumDeliveryDate: nullableDate,
})

router.use(requireAuth, requirePageAccess('information'))

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `WITH enterprise_sources AS (
         SELECT lower(btrim(enterprise)) AS enterprise_key, btrim(enterprise) AS enterprise_name, 1 AS ticket_count
         FROM tickets
         WHERE btrim(enterprise) <> ''
         UNION ALL
         SELECT enterprise_key, enterprise_name, 0
         FROM enterprise_information
       ), properties AS (
         SELECT enterprise_key, min(enterprise_name) AS enterprise_name,
                sum(ticket_count)::int AS ticket_count
         FROM enterprise_sources
         GROUP BY enterprise_key
       )
       SELECT p.enterprise_key, p.enterprise_name, p.ticket_count,
              i.syndic_name, i.syndic_phone, i.syndic_email,
              i.supervisor_name, i.supervisor_phone, i.supervisor_email,
              i.condominium_email, i.work_address, i.occupancy_permit_date, i.condominium_delivery_date
       FROM properties p
       LEFT JOIN enterprise_information i USING (enterprise_key)
       ORDER BY lower(p.enterprise_name)`,
    )
    res.json({ enterprises: result.rows })
  } catch (error) {
    next(error)
  }
})

router.put('/', async (req, res, next) => {
  const parsed = informationSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Informações do empreendimento inválidas.' })
    return
  }
  const data = parsed.data
  const enterpriseKey = data.enterpriseName.trim().toLowerCase()
  try {
    await pool.query(
      `INSERT INTO enterprise_information (
         enterprise_key, enterprise_name, syndic_name, syndic_phone, syndic_email,
         supervisor_name, supervisor_phone, supervisor_email, condominium_email,
         work_address, occupancy_permit_date, condominium_delivery_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (enterprise_key) DO UPDATE SET
         enterprise_name = EXCLUDED.enterprise_name,
         syndic_name = EXCLUDED.syndic_name,
         syndic_phone = EXCLUDED.syndic_phone,
         syndic_email = EXCLUDED.syndic_email,
         supervisor_name = EXCLUDED.supervisor_name,
         supervisor_phone = EXCLUDED.supervisor_phone,
         supervisor_email = EXCLUDED.supervisor_email,
         condominium_email = EXCLUDED.condominium_email,
         work_address = EXCLUDED.work_address,
         occupancy_permit_date = EXCLUDED.occupancy_permit_date,
         condominium_delivery_date = EXCLUDED.condominium_delivery_date,
         updated_at = now()`,
      [
        enterpriseKey, data.enterpriseName, data.syndicName, data.syndicPhone, data.syndicEmail,
        data.supervisorName, data.supervisorPhone, data.supervisorEmail, data.condominiumEmail, data.workAddress,
        data.occupancyPermitDate, data.condominiumDeliveryDate,
      ],
    )
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
