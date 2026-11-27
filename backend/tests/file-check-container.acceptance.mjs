import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

test('R06 native ZIP context signatures remain active; raw/member-only paths are a negative control', () => {
  const image = process.env.PRIVATE_FILE_CHECK_IMAGE
  assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/)
  const code = `
import sys,tempfile,zipfile,subprocess,json
sys.path.insert(0,'/checker')
import file_checker as c
with tempfile.TemporaryDirectory() as root:
    path=root+'/sample.zip'; db=root+'/context.cdb'
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('context-only.txt',b'harmless original member')
    open(db,'w').write('Bazaar.Container.Context:CL_TYPE_ZIP:*:context-only[.]txt:*:*:*:*:*:*\\n')
    raw=subprocess.run(['clamscan','--no-summary','--scan-archive=no','--database='+db,path],capture_output=True)
    assert raw.returncode==0,raw.stdout
    native=c.run_limited
    def with_signature(args,*rest):
        if args[0]=='clamscan' and '--version' not in args:args=args+['--database='+db]
        return native(args,*rest)
    c.run_limited=with_signature
    try:
        c.malware_zip(path)
    except c.UnsafeFile as error:
        assert str(error)=='MALWARE_DETECTED',str(error)
    else:raise AssertionError('Full native container context was not scanned')
    print(json.dumps({'rawNegativeControl':raw.returncode,'wholeContainer':'MALWARE_DETECTED'}))
`
  const name = 'bazaar-context-' + randomUUID()
  const args = ['-n', 'docker', 'run', '--name', name, '--rm', '-i', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=4000000000',
    '--memory-swap=4000000000', '--cpus=1', '--pids-limit=32', '--user=65532:65532',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=64000000', '--entrypoint=python3', image, '-']
  try {
    const result = spawnSync('sudo', args, { input: code, encoding: 'utf8', timeout: 120000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    console.log(result.stdout.trim())
  } finally {
    const removed = spawnSync('sudo', ['-n', 'docker', 'rm', '--force', name], { encoding: 'utf8' })
    assert.ok(removed.status === 0 || /No such container/i.test(removed.stderr), removed.stderr)
    const state = spawnSync('sudo', ['-n', 'docker', 'inspect', name], { encoding: 'utf8' })
    assert.ok(state.status !== 0 && /No such (object|container)/i.test(state.stderr), state.stderr)
  }
})
