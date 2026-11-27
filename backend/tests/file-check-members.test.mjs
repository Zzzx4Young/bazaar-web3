import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const checker = fileURLToPath(new URL('../file-checker', import.meta.url))
for (const rejectLast of [false, true]) {
  test(`R06 member scan accounts every validated byte and fails closed: rejectLast=${rejectLast}`, () => {
    const program = `
import sys, tempfile, zipfile, os, hashlib
sys.path.insert(0, sys.argv[1])
import file_checker as c
with tempfile.TemporaryDirectory() as root:
    path=os.path.join(root,'sample.zip')
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('a.txt',b'first member')
        z.writestr('empty/',b'')
        z.writestr('last.txt',b'last member')
    seen=[]
    def scan(member, name, size):
        data=member.read()
        assert len(data)==size
        seen.append((name,data))
        if name=='last.txt' and ${rejectLast ? 'True' : 'False'}:
            raise c.UnsafeFile('MALWARE_DETECTED')
    try:
        coverage=c.check_zip(path, scan)
        assert not ${rejectLast ? 'True' : 'False'}
        assert coverage['entries']==3
        assert coverage['expandedBytes']==23
        assert len(coverage['sha256'])==64
    except c.UnsafeFile as error:
        assert ${rejectLast ? 'True' : 'False'} and str(error)=='MALWARE_DETECTED', str(error)
    assert seen==[('a.txt',b'first member'),('empty/',b''),('last.txt',b'last member')],seen
`
    const r = spawnSync('python3', ['-c', program, checker], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  })
}
for (const [reply, expected] of [
  ['fd[9]: OK\0', 'clean'],
  ['fd[9]: Eicar-Test-Signature FOUND\0', 'MALWARE_DETECTED'],
  ['fd[9]: Heuristics.Limits.Exceeded.MaxScanSize FOUND\0', 'MALWARE_SCAN_LIMIT'],
  ['fd[9]: read error ERROR\0', 'MALWARE_SCAN_INCOMPLETE'],
  ['fd[9]: OK\0unexpected\0', 'MALWARE_SCAN_INCOMPLETE']
]) {
  test(`R06 member engine reply is fail-closed: ${expected}`, () => {
    const program = `
import sys,tempfile
sys.path.insert(0,sys.argv[1])
import file_checker as c
scanner=c.MemberScanner()
scanner.request=lambda *args: ${JSON.stringify(reply)}.encode()
with tempfile.TemporaryFile() as f:
    f.write(b'test');f.seek(0)
    try:
        scanner.scan(f,'safe-name',4)
        assert ${JSON.stringify(expected)}=='clean'
    except c.UnsafeFile as error:
        assert str(error)==${JSON.stringify(expected)},str(error)
`
    const r = spawnSync('python3', ['-c', program, checker], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  })
}
test('R06 raw ZIP scan cannot substitute for all-member coverage or integrity', () => {
  const program = `
import sys,tempfile,zipfile,os
sys.path.insert(0,sys.argv[1])
import file_checker as c
with tempfile.TemporaryDirectory() as root:
    path=os.path.join(root,'object.zip')
    with zipfile.ZipFile(path,'w') as z:z.writestr('safe.txt',b'actual member bytes')
    scanned=[]
    raw=[]
    c.malware=lambda path,raw_archive=False: raw.append(raw_archive) or {'clean':True,'engine':'ClamAV'}
    class Scanner:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def scan(self,member,name,size):scanned.append(member.read())
    c.MemberScanner=Scanner
    result=c.malware_zip(path)
    assert raw==[True] and scanned==[b'actual member bytes']
    assert result['members']['entries']==1
    assert result['members']['expandedBytes']==19
    data=bytearray(open(path,'rb').read());data[38]^=1;open(path,'wb').write(data)
    scanned.clear()
    try:c.malware_zip(path);raise AssertionError('corrupt member accepted')
    except c.UnsafeFile as error:assert str(error)=='ZIP_INTEGRITY',str(error)
    assert scanned==[],scanned
`
  const r = spawnSync('python3', ['-c', program, checker], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
