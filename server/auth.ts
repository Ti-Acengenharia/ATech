import type { NextFunction, Request, Response } from 'express'
import { pool } from './db.js'

export const pageAccessKeys = [
  'home',
  'tickets',
  'schedule',
  'collaborators',
  'information',
  'api-validation',
  'warranties',
  'legal-processes',
  'personal-activities',
] as const

export type PageAccessKey = typeof pageAccessKeys[number]

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = req.session.user
  if (!user) {
    res.status(401).json({ error: 'Autenticação necessária.' })
    return
  }

  pool.query(
    `SELECT 1 FROM users
     WHERE id = $1 AND role = $2 AND status = 'active'`,
    [user.id, user.role],
  ).then((result) => {
    if (result.rowCount) {
      next()
      return
    }
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('atech.sid')
      res.status(401).json({ error: 'Esta conta não está ativa. Entre em contato com a administração.' })
    })
  }).catch(next)
}

export function requirePageAccess(pageKey: PageAccessKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user
    if (user?.role === 'admin') {
      next()
      return
    }

    pool.query(
      'SELECT 1 FROM user_page_access WHERE user_id = $1 AND page_key = $2',
      [user?.id, pageKey],
    ).then((result) => {
      if (result.rowCount) next()
      else res.status(403).json({ error: 'Você não tem acesso a esta página.' })
    }).catch(next)
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (error?: unknown) => {
    if (error) {
      next(error)
      return
    }
    if (req.session.user?.role !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito à administração.' })
      return
    }
    next()
  })
}