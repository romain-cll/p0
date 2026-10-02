// Types shared by the main process and the renderer.

export interface Project {
  path: string
  name: string
}

export interface PermissionModeOption {
  value: string
  label: string
}

export interface AgentInfo {
  permissionModes: PermissionModeOption[]
  defaultPermissionMode: string
}

/** The app's common event type: every agent adapter translates its own events into these. */
export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'action'; kind: string; target: string }
  | { type: 'error'; message: string }
  | { type: 'end'; interrupted: boolean }
