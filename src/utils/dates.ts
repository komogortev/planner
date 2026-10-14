/** Current ISO-8601 timestamp with timezone. */
export function nowISO(): string {
  return new Date().toISOString()
}
