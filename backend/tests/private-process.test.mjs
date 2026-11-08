import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { processIdentity, processHasExited } from '../dist/delivery-files/process-identity.js'

test('private task process proof distinguishes a current owner from an unknown namespace', () => {
  const owner = processIdentity()
  assert.equal(processHasExited(owner), false)
  assert.equal(processHasExited({ ...owner, scope: 'unknown' }), false)
  assert.equal(processHasExited({ scope: null, pid: null, start: null }), false)
})
test('private task process proof confirms an owned subprocess has exited after SIGKILL', async () => {
  const module = new URL('../dist/delivery-files/process-identity.js', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {processIdentity} from ${JSON.stringify(module)};console.log(JSON.stringify(processIdentity()));setInterval(()=>{},1000)`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } }
  )
  const exit = new Promise((done) => child.once('exit', done))
  try {
    const owner = await new Promise((done, reject) => {
      let text = ''
      child.stdout.on('data', (chunk) => {
        text += String(chunk)
        if (text.includes('\n')) done(JSON.parse(text.split('\n')[0]))
      })
      child.once('error', reject)
    })
    assert.equal(processHasExited(owner), false)
    child.kill('SIGKILL')
    await exit
    assert.equal(processHasExited(owner), true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exit
    }
  }
})
