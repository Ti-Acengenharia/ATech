import { apiRequest } from '../api/client'

export interface ProgrammingRoleVisibility {
  hiddenRoleKeys: string[]
  updatedAt: string | null
}

export function getProgrammingRoleVisibility() {
  return apiRequest<ProgrammingRoleVisibility>('/api/programming/role-visibility')
}

export function saveProgrammingRoleVisibility(hiddenRoleKeys: string[]) {
  return apiRequest<ProgrammingRoleVisibility>('/api/programming/role-visibility', {
    method: 'PUT',
    body: JSON.stringify({ hiddenRoleKeys }),
  })
}
