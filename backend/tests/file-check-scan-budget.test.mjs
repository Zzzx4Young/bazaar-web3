import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('../file-checker', import.meta.url))
for (const [code, output, expected] of [
  [0, '/input/object: OK', 'clean'],
  [1, 'Heuristics.Limits.Exceeded.MaxScanSize FOUND', 'MALWARE_SCAN_LIMIT'],
  [0, 'Heuristics.Limits.Exceeded.MaxScanSize FOUND', 'MALWARE_SCAN_LIMIT'],
  [1, 'Heuristics.Limits.Exceeded.MaxScanTime FOUND', 'MALWARE_SCAN_LIMIT'],
  [1, 'Heuristics.Limits.Exceeded.MaxFiles FOUND', 'MALWARE_SCAN_LIMIT'],
  [1, 'Eicar-Test-Signature FOUND', 'MALWARE_DETECTED'],
  [2, 'read error', 'MALWARE_SCAN_INCOMPLETE']
]) {
  test(`R06 bounded aggregate scan budget preserves verdict ${expected}: ${output}`, () => {
    const program = `
import sys, datetime
sys.path.insert(0, sys.argv[1])
import file_checker as c
version = ('ClamAV 1.4.6/28190/' + datetime.datetime.now(datetime.timezone.utc).strftime('%a %b %d %H:%M:%S %Y')).encode()
calls = []
def run(args):
    calls.append(args)
    return (0, version) if '--version' in args else (${code}, ${JSON.stringify(output)}.encode())
c.run_limited = run
try:
    result = c.malware('/input/object')
    assert ${JSON.stringify(expected)} == 'clean'
    assert result['clean'] is True
except c.UnsafeFile as error:
    assert str(error) == ${JSON.stringify(expected)}, str(error)
scan = calls[-1]
assert '--max-scansize=2000000000' in scan, scan
assert '--max-filesize=500000000' in scan, scan
assert '--alert-exceeds-max=yes' in scan, scan
assert '--alert-encrypted=yes' in scan, scan
assert '--max-scantime=120000' in scan, scan
assert not any(arg in scan for arg in ('--scan-archive=no', '--normalize=no', '--max-scansize=0'))
`
    const result = spawnSync('python3', ['-c', program, checker], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  })
}
