/** Matches SQLite-style ids used in this app: `lower(hex(randomblob(16)))` → 32 lowercase hex chars */
export function isRecordId(segment: string | undefined): boolean {
  return !!segment && /^[a-f0-9]{32}$/.test(segment);
}
