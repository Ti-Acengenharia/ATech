/// <reference path="./types/express-session.d.ts" />
import type { NextFunction, Request, Response } from 'express'
import { pool } from './db.js'
import { getSessionTimeoutMinutes } from './services/session-settings.js'

export const pageAccessKeys = [
  'home',
  'tickets',
  'letter-filling',
  'schedule',
  'collaborators',
  'inventory',
  'stock-units',
  'information',
  'warranties',
  'legal-processes',
  'personal-activities',
] as const

export type PageAccessKey = typeof pageAccessKeys[number]

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = req.session.user
  if (!user) {
    res.status(401).json({ error: 'Autenticação necessária.', code: 'SESSION_REQUIRED' })
    return
  }

  // Dynamic session timeout enforcement
  const timeoutMinutes = await getSessionTimeoutMinutes()
  const timeoutMs = timeoutMinutes * 60 * 1000
  const now = Date.now()
  const lastActivity = req.session.lastActivity || req.session.loginTime || now

  if (now - lastActivity > timeoutMs) {
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('atech.sid')
      res.status(401).json({
        error: `Sua sessão expirou por tempo limite (${timeoutMinutes} min). Faça login novamente.`,
        code: 'SESSION_REQUIRED',
      })
    })
    return
  }

  req.session.lastActivity = now
  if (req.session.cookie) {
    req.session.cookie.maxAge = timeoutMs
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
      res.status(401).json({ error: 'Esta conta não está ativa. Entre em contato com a administração.', code: 'ACCOUNT_INACTIVE' })
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
