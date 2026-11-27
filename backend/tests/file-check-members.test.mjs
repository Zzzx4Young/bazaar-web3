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
test('R06 ZIP uses the complete native container after structural validation', () => {
  const program = `
import sys,tempfile,zipfile,os
sys.path.insert(0,sys.argv[1])
import file_checker as c
with tempfile.TemporaryDirectory() as root:
    path=os.path.join(root,'object.zip')
    with zipfile.ZipFile(path,'w') as z:z.writestr('safe.txt',b'actual member bytes')
    calls=[]
    def native(path, zip_archive=False):
        calls.append(zip_archive)
        return {'clean':True,'engine':'ClamAV'}
    c.malware=native
    result=c.malware_zip(path)
    assert calls==[True],calls
    assert result['scope']=='whole-container-recursive'
    assert result['members']['expandedBytes']==19
    assert result['members']['entries']==1
`
  const r = spawnSync('python3', ['-c', program, checker], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
