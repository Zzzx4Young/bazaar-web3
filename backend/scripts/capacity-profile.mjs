// Optional diagnostic preload for owned capacity API processes only.
// CPU profiles record stack frames, never request bodies or environment values.
import { Session } from 'node:inspector'
import { writeFile } from 'node:fs/promises'

// Start only after the parent has verified HTTP readiness. Instrumenting initial
// query-compiler WASM startup is unrelated to the load interval under diagnosis.
process.once('message', () => {
  void (async () => {
    const session = new Session()
    const command = (method) =>
      new Promise((resolve, reject) => {
        session.post(method, (error, result) => (error ? reject(error) : resolve(result)))
      })
    try {
      session.connect()
      await command('Profiler.enable')
      await command('Profiler.start')
      const timer = setTimeout(() => {
        void (async () => {
          try {
            const { profile } = await command('Profiler.stop')
            await writeFile(
              `.tmp/capacity-api-${process.pid}.cpuprofile`,
              JSON.stringify(profile),
              { mode: 0o600 }
            )
          } catch {
            console.error('Capacity CPU profile unavailable')
          } finally {
            session.disconnect()
          }
        })()
      }, 40000)
      timer.unref()
    } catch {
      session.disconnect()
      console.error('Capacity CPU profiler could not start')
    }
  })()
})
