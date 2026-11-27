const limits = { pdf: 20000000, png: 20000000, jpeg: 20000000, zip: 500000000 }
const mimes = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', zip: 'application/zip' }
export function assertCapacityManifest(rows) {
  if (!Array.isArray(rows) || rows.length !== 12) throw new Error('Require twelve fixed size boundaries')
  const seen = new Set()
  for (const row of rows) {
    const suffix = row.kind === 'jpeg' ? 'jpeg' : row.kind
    if (!Object.hasOwn(limits, row.kind) || ![-1, 0, 1].includes(row.delta) ||
        row.bytes !== limits[row.kind] + row.delta || row.mime !== mimes[row.kind] ||
        row.name !== `${row.kind}-${row.bytes}.${suffix}` ||
        !/^[a-f0-9]{64}$/.test(row.sha256) || seen.has(row.name))
      throw new Error('Invalid or duplicate fixed capacity case')
    seen.add(row.name)
  }
}
const expansionCases = new Map([
  ['expanded-1999999999.zip', [1999999999, 'clean', undefined]],
  ['expanded-2000000000.zip', [2000000000, 'clean', undefined]],
  ['expanded-2000000001.zip', [2000000001, 'rejected', undefined]],
  ['expanded-tail-eicar.zip', [2000000000, 'rejected', 'MALWARE_DETECTED']]
])
export function assertExpansionManifest(rows) {
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('Require all four fixed expansion cases')
  const seen = new Set()
  for (const row of rows) {
    const expected = expansionCases.get(row.name)
    if (!expected || seen.has(row.name) || row.expandedBytes !== expected[0] ||
        row.expected !== expected[1] || row.reason !== expected[2] ||
        !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > 500000000 ||
        !/^[a-f0-9]{64}$/.test(row.sha256))
      throw new Error('Invalid or duplicate fixed expansion case')
    seen.add(row.name)
  }
}
