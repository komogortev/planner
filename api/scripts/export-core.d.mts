// Types for export-core.mjs, so the Worker test (api/test/exportLocal.test.ts) typechecks against it.
export type Query = (sql: string) => Promise<Record<string, unknown>[]>
export const EXPORT_FORMAT: number
export const PULL_MAX: number
export function assertSelect(sql: string): string
export function sq(s: unknown): string
export function buildExport(
  query: Query,
  email: string,
  opts?: { limit?: number; now?: () => number },
): Promise<{
  format: number
  exportedAt: number
  account: unknown
  identities: unknown[]
  entries: unknown[]
  revisions: unknown[]
  records: unknown[]
  recordRevisions: unknown[]
  version_seq: number
}>
export class NoAccountError extends Error {}
export function exportFileName(at?: Date): string
export function exportedMs(v: unknown): number
export function freshness(
  files: { name: string; exportedAt: unknown }[],
  opts: { now?: number; maxAgeMs?: number | null },
): { fresh: boolean; newest: string | null; ageMs: number | null }
export function ageText(ageMs: number): string
