import { readFileSync, statSync } from 'node:fs'
import type { ChainDeployment } from './chain-observer.js'
export function readChainDeployment(path: string | undefined): ChainDeployment | undefined {
  if (!path) return
  const file = statSync(path)
  if (!file.isFile() || file.mode & 0o022 || file.size > 4096)
    throw new Error('Unsafe chain deployment configuration')
  const v = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (
    !v ||
    Object.keys(v).sort().join(',') !==
      ['deploymentBlock', 'escrowCodeHash', 'tokenCodeHash', 'administrator', 'arbitrator']
        .sort()
        .join(',') ||
    typeof v.deploymentBlock !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(v.deploymentBlock) ||
    BigInt(v.deploymentBlock) > 9223372036854775807n
  )
    throw new Error('Invalid chain deployment block')
  for (const field of ['escrowCodeHash', 'tokenCodeHash'])
    if (typeof v[field] !== 'string' || !/^0x[0-9a-f]{64}$/.test(v[field] as string))
      throw new Error('Invalid chain code hash')
  for (const field of ['administrator', 'arbitrator'])
    if (
      typeof v[field] !== 'string' ||
      !/^0x[0-9a-f]{40}$/.test(v[field] as string) ||
      v[field] === '0x' + '0'.repeat(40)
    )
      throw new Error('Invalid chain role address')
  if (v.administrator === v.arbitrator) throw new Error('Chain roles must be distinct')
  return v as unknown as ChainDeployment
}
