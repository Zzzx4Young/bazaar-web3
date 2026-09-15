import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const backendDirectory = resolve(process.cwd(), '../backend')
const child = spawn(process.execPath, ['scripts/check-i5-browser.mjs'], {
  cwd: backendDirectory,
  env: process.env,
  stdio: 'inherit'
})

child.once('error', () => {
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
