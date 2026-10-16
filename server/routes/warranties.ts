import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePageAccess } from '../auth.js'
import { pool } from '../db.js'
import { syncCvcrmWarrantySubsubjects } from '../services/cvcrm.js'

const router = Router()
const subsubjectIdSchema = z.coerce.number().int().positive()
const warrantySchema = z.object({
  warrantyYears: z.number().int().min(1).max(100).nullable(),
})

router.use(requireAuth, requirePageAccess('warranties'))

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query<{
      source_subsubject_id: number
      name: string
      warranty_years: number | null
      is_active: boolean
      synced_at: Date
    }>(
      `SELECT source_subsubject_id, name, warranty_years, is_active, synced_at
       FROM warranty_subsubjects
       WHERE source_subject_id = 16
       ORDER BY is_active DESC, name`,
    )
    res.json({
      subsubjects: result.rows.map((item) => ({
        sourceSubsubjectId: item.source_subsubject_id,
        name: item.name,
        warrantyYears: item.warranty_years,
        active: item.is_active,
        syncedAt: item.synced_at.toISOString(),
      })),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/sync', async (_req, res, next) => {
  try {
    res.json(await syncCvcrmWarrantySubsubjects())
  } catch (error) {
    if (error instanceof Error && /(CVCRM|catálogo de subassuntos)/i.test(error.message)) {
      res.status(502).json({ error: error.message })
      return
    }
    next(error)
  }
})

router.put('/:id', async (req, res, next) => {
  const id = subsubjectIdSchema.safeParse(req.params.id)
  const parsed = warrantySchema.safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Informe um prazo inteiro entre 1 e 100 anos ou deixe-o em branco.' })
    return
  }

  try {
    const result = await pool.query(
      `UPDATE warranty_subsubjects
       SET warranty_years = $1, updated_at = now()
       WHERE source_subsubject_id = $2 AND source_subject_id = 16
       RETURNING source_subsubject_id`,
      [parsed.data.warrantyYears, id.data],
    )
    if (!result.rowCount) {
      res.status(404).json({ error: 'Subassunto não encontrado. Sincronize o catálogo do CVCRM e tente novamente.' })
      return
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

export default router
