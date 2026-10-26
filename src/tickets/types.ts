export interface TicketSummary {
  id: string
  protocol: string
  statusId: number | null
  status: string
  sourceActive: boolean
  openedAt: string | null
  openSeconds: number | null
  customerName: string
  customerPhone: string | null
  subject: string
  subsubject: string
  description: string
  enterprise: string
  block: string
  unit: string
  priority: string
  localDueAt: string | null
  estimatedCost: string | null
  actualCost: string | null
  backgroundColor: string | null
  textColor: string | null
  commentCount: number
  subtaskCount: number
  completedSubtaskCount: number
  programmingCount: number
  tags?: TicketTag[]
  warranty?: TicketWarranty | null
}

export interface LegalProcessOption {
  id: string
  title: string
  enterprise_name: string
  claimant: string
  child_process_numbers: string[]
}

export interface TicketTag {
  id: string
  name: string
  color: string
}

export interface CvTicketAttachment {
  id: string | null
  name: string
  type: string
  size: string
  createdAt: string
  url: string
  responseId: string | null
}

export interface CvTicketMessage {
  id: string
  createdAt: string
  author: string
  body: string
  attachments: CvTicketAttachment[]
}

export interface TicketWarranty {
  status: 'within' | 'outside' | 'undetermined'
  reason: string
  deliveryDate: string | null
  expiresAt: string | null
  warrantyYears: number | null
}

export interface TicketWorkflowStage {
  id: number
  name: string
  position: number
  background_color: string | null
  text_color: string | null
  flags: Record<string, string>
}

export interface TeamMentionTarget {
  id: string
  displayName: string
  email: string
}

export interface TicketProgramming {
  id: string
  ticket_id: string
  collaborator_id: string
  activity_description: string
  enterprise: string
  block: string
  unit: string
  common_area_location: string
  materials: string[]
  equipment: string[]
  tools: string[]
  completed: boolean
  programming_type: 'general' | 'foreman'
  starts_at: string
  ends_at: string
  collaborator_name: string
  collaborator_nickname: string
}
