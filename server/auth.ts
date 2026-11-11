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

  // 1.1: Só atualiza o cookie e lastActivity no banco se passou mais de 2 minutos para evitar I/O contínuo
  if (now - lastActivity > 2 * 60 * 1000) {
    req.session.lastActivity = now
    if (req.session.cookie) {
      req.session.cookie.maxAge = timeoutMs
    }
  }

  // 1.3: Validação de status ativo com cache de 3 minutos por sessão (elimina centenas de queries repetidas)
  const userValidationInterval = 3 * 60 * 1000
  const lastValidation = req.session.lastUserValidation || 0
  if (now - lastValidation < userValidationInterval) {
    next()
    return
  }

  pool.query<{ status: string; role: string }>(
    `SELECT status, role FROM users WHERE id = $1`,
    [user.id],
  ).then((result) => {
    const row = result.rows[0]
    if (row && row.status === 'active') {
      req.session.lastUserValidation = now
      if (req.session.user) {
        req.session.user.role = row.role as any
      }
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

    // 1.3: Checagem instantânea de permissão em memória via sessão (zero queries ao banco)
    if (Array.isArray(req.session.pageAccess)) {
      if (req.session.pageAccess.includes(pageKey)) {
        next()
        return
      }
      res.status(403).json({ error: 'Você não tem acesso a esta página.' })
      return
    }

    // Fallback: busca uma vez no banco e armazena na sessão
    pool.query<{ page_key: string }>(
      'SELECT page_key FROM user_page_access WHERE user_id = $1',
      [user?.id],
    ).then((result) => {
      const accesses = result.rows.map((r) => r.page_key)
      req.session.pageAccess = accesses
      if (accesses.includes(pageKey)) next()
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
