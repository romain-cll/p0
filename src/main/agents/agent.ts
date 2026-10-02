import type { AgentEvent, AgentInfo } from '../../shared/chat'

export interface AgentRun {
  cwd: string
  prompt: string
  permissionMode: string
  sessionId?: string
}

export interface AgentAdapter extends AgentInfo {
  start(run: AgentRun, emit: (event: AgentEvent) => void): { stop(): void }
}
