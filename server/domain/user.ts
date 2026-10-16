export type UserRole = 'admin' | 'member'
export type UserStatus = 'invited' | 'active' | 'suspended'

export interface SessionUser {
  id: number
  email: string
  displayName: string
  role: UserRole
}

export interface ManagedUser extends SessionUser {
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
}