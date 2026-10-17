// The Worker client for schedules (H5-S3-SCHEDULES, D-123…D-135). Same transport and errors as models.ts.
import type { RunHeader2 } from '@/domain/harness2'
import { request, type Client } from './models'

export interface ScheduleView {
  kind: 'morning'
  hour: number
  zone: string
  enabled: boolean
  /** Why the Worker paused it (D-128): a call status such as `key_rejected`; null when it is not paused. */
  pausedReason: string | null
  failCount: number
  lastDay: string | null
  lastCallId: string | null
  updatedAt: number
}
export interface WaitingReply { callId: string; modelId: string; header: RunHeader2; reply: string; startedAt: number }

export const listSchedules = (c?: Client) => request<{ schedules: ScheduleView[]; operatorPaused: boolean }>('/me/schedules', { method: 'GET' }, c)
export const saveMorning = (change: { hour?: number; zone?: string; enabled?: boolean }, c?: Client) =>
  request<ScheduleView>('/me/schedules/morning', { method: 'PUT', body: JSON.stringify(change) }, c)
export const listWaiting = async (c?: Client) => (await request<{ waiting: WaitingReply[] }>('/me/schedules/waiting', { method: 'GET' }, c)).waiting
