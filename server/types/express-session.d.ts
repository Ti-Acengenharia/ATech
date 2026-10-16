import 'express-session'
import type { SessionUser } from '../domain/user.js'

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser
  }
}