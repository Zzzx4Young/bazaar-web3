import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import type { FileCheckReport, PrivateFileChecker } from './upload.service.js'

export interface CheckerRuntime {
  image: string
  memoryBytes: number
  cpus: number
  pids: number
  tmpBytes: number
  wallSeconds: number
  sudo?: boolean
}
export class DockerFileChecker implements PrivateFileChecker {
  constructor(private readonly config: CheckerRuntime) {
    if (
      !/^[a-z0-9][a-z0-9./:_@-]{0,240}$/.test(config.image) ||
      !Number.isSafeInteger(config.memoryBytes) ||
      config.memoryBytes < 128_000_000 ||
      config.memoryBytes > 4_000_000_000 ||
      !Number.isFinite(config.cpus) ||
      config.cpus <= 0 ||
      config.cpus > 1 ||
      !Number.isInteger(config.pids) ||
      config.pids < 8 ||
      config.pids > 32 ||
      !Number.isSafeInteger(config.tmpBytes) ||
      config.tmpBytes < 1_000_000 ||
      config.tmpBytes > 64_000_000 ||
      !Number.isInteger(config.wallSeconds) ||
      config.wallSeconds < 1 ||
      config.wallSeconds > 120
    )
      throw new Error('Explicit valid checker resource budget is required')
  }
  private name(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid check task identity')
    return 'bazaar-private-check-' + id
  }
  private command(args: string[], seconds = 10) {
    const run = ['--signal=KILL', '--kill-after=2', String(seconds) + 's', 'docker', ...args]
    return {
      program: this.config.sudo ? 'sudo' : 'timeout',
      args: this.config.sudo ? ['-n', 'timeout', ...run] : run
    }
  }
  private async docker(args: string[]) {
    const c = this.command(args)
    return await new Promise<{ code: number; output: string }>((resolve) => {
      const child = spawn(c.program, c.args, {
        env: { PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = '',
        closed = false
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (b) => {
          output += String(b)
          if (output.length > 65_536) child.kill('SIGKILL')
        })
      child.on('error', () => {
        if (!closed) {
          closed = true
          clearTimeout(timer)
          resolve({ code: -1, output: 'Docker unavailable' })
        }
      })
      child.on('close', (code) => {
        if (!closed) {
          closed = true
          clearTimeout(timer)
          resolve({ code: code ?? -1, output })
        }
      })
    })
  }
  async terminate(id: string) {
    const name = this.name(id),
      removed = await this.docker(['rm', '--force', name])
    if (removed.code !== 0 && !/No such container/i.test(removed.output)) return false
    const inspect = await this.docker(['inspect', name])
    return inspect.code !== 0 && /No such (object|container)/i.test(inspect.output)
  }
  async check(
    path: string,
    contentType: string,
    id: string = randomUUID(),
    options?: { wallMs: number; signal: AbortSignal }
  ): Promise<FileCheckReport> {
    const file = await realpath(path),
      info = await stat(file)
    if (
      !info.isFile() ||
      info.size > 500_000_000 ||
      file.includes(',') ||
      !['application/zip', 'application/pdf', 'image/png', 'image/jpeg'].includes(contentType)
    )
      throw new Error('Invalid private checker input')
    if (options?.signal.aborted)
      return { status: 'timeout', reason: 'CHECK_TIMEOUT', processStopped: true }
    const name = this.name(id),
      c = this.config,
      wallMs = Math.max(1, Math.min(c.wallSeconds * 1000, options?.wallMs ?? c.wallSeconds * 1000))
    const cmd = this.command(
      [
        'run',
        '--name',
        name,
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        String(c.pids),
        '--memory',
        String(c.memoryBytes),
        '--memory-swap',
        String(c.memoryBytes),
        '--cpus',
        String(c.cpus),
        '--user',
        '65532:65532',
        '--tmpfs',
        `/tmp:rw,noexec,nosuid,size=${c.tmpBytes}`,
        '--mount',
        `type=bind,source=${file},target=/input/object,readonly`,
        c.image,
        '/input/object',
        contentType
      ],
      Math.ceil(wallMs / 1000) + 15
    )
    let output = '',
      expired = false,
      overflow = false
    let timeoutStop: Promise<boolean> | null = null
    let timeoutInspection: { code: number; output: string } | null = null
    const child = spawn(cmd.program, cmd.args, {
      detached: true,
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stop = () => {
      if (expired) return
      expired = true
      timeoutStop = (async () => {
        timeoutInspection = await this.docker(['inspect', name])
        return this.terminate(id)
      })()
    }
    const timeout = setTimeout(stop, wallMs)
    options?.signal.addEventListener('abort', stop, { once: true })
    const exit = await new Promise<number>((resolve) => {
      child.stdout.on('data', (b) => {
        output += String(b)
        if (output.length > 65536) {
          overflow = true
          child.kill('SIGKILL')
        }
      })
      // Do not reflect container stderr or attacker-controlled file content into API errors.
      child.stderr.on('data', () => {})
      child.once('error', () => resolve(-1))
      child.once('close', (code) => resolve(code ?? -1))
    })
    clearTimeout(timeout)
    options?.signal.removeEventListener('abort', stop)
    if (timeoutStop) await timeoutStop
    const state = timeoutInspection ?? (await this.docker(['inspect', name]))
    let resource: Record<string, string | number | boolean> = {}
    try {
      const row = JSON.parse(state.output)[0] as {
        HostConfig: {
          Memory: number
          MemorySwap: number
          NanoCpus: number
          PidsLimit: number
          NetworkMode: string
          ReadonlyRootfs: boolean
          Privileged: boolean
        }
        State: { Running: boolean; OOMKilled: boolean }
      }
      resource = {
        memoryBytes: row.HostConfig.Memory,
        swapBytes: row.HostConfig.MemorySwap,
        nanoCpus: row.HostConfig.NanoCpus,
        pids: row.HostConfig.PidsLimit,
        network: row.HostConfig.NetworkMode,
        readOnly: row.HostConfig.ReadonlyRootfs,
        privileged: row.HostConfig.Privileged,
        oomKilled: row.State.OOMKilled
      }
    } catch {
      /* An unavailable runtime cannot produce a clean result. */
    }
    const stopped = timeoutStop ? await timeoutStop : await this.terminate(id)
    if (!stopped) throw new Error('Private checker termination not confirmed')
    const limitsValid =
      resource.memoryBytes === c.memoryBytes &&
      resource.swapBytes === c.memoryBytes &&
      resource.nanoCpus === Math.round(c.cpus * 1e9) &&
      resource.pids === c.pids &&
      resource.network === 'none' &&
      resource.readOnly === true &&
      resource.privileged === false
    if (expired)
      return { status: 'timeout', reason: 'CHECK_TIMEOUT', processStopped: true, resource }
    if (exit !== 0 || overflow || !limitsValid || resource.oomKilled)
      return { status: 'rejected', reason: 'CHECKER_FAILED', processStopped: true, resource }
    let report: FileCheckReport
    try {
      report = JSON.parse(output) as FileCheckReport
    } catch {
      return { status: 'rejected', reason: 'CHECK_INCOMPLETE', processStopped: true, resource }
    }
    if (!['clean', 'rejected'].includes(report.status) || !/^[A-Z0-9_]{1,80}$/.test(report.reason))
      return { status: 'rejected', reason: 'CHECK_INCOMPLETE', processStopped: true, resource }
    return { ...report, processStopped: true, resource }
  }
}
