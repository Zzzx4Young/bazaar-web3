// Optional diagnostics are never a replacement for the native clean verdict.
// Historical whole-container reports predate these fields and remain compatible.
export function validZipCoverage(malware: {
  scope?: unknown
  members?: unknown
} | undefined): boolean {
  if (!malware || (malware.scope === undefined && malware.members === undefined)) return true
  if (malware.scope !== 'whole-container-recursive' || !malware.members ||
      typeof malware.members !== 'object') return false
  const value = malware.members as { entries?: unknown; expandedBytes?: unknown; sha256?: unknown }
  return typeof value.entries === 'number' && Number.isSafeInteger(value.entries) &&
    value.entries >= 0 && value.entries <= 10000 &&
    typeof value.expandedBytes === 'number' && Number.isSafeInteger(value.expandedBytes) &&
    value.expandedBytes >= 0 && value.expandedBytes <= 2000000000 &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
}
