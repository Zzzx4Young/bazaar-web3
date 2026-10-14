import { resolvePublishedListings, toItem, type BackendListing } from './backend-api'
import { favoritesConcurrentBatches, favoritesMaxIds } from './favorites-policy'
import type { Item } from '@/types'

type Resolution = {
  controller: AbortController
  promise: Promise<Item[]>
  subscribers: number
}
const inFlight = new Map<string, Resolution>()

async function resolve(ids: string[], controller: AbortController): Promise<Item[]> {
  const batches = Array.from({ length: Math.ceil(ids.length / favoritesMaxIds) }, (_, index) =>
    ids.slice(index * favoritesMaxIds, (index + 1) * favoritesMaxIds)
  )
  const pages: BackendListing[][] = []
  let next = 0
  async function worker() {
    while (next < batches.length && !controller.signal.aborted) {
      const index = next++
      const batch = batches[index]
      if (!batch) break
      const page = await resolvePublishedListings(batch, controller.signal)
      pages[index] = page.items
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(favoritesConcurrentBatches, batches.length) }, worker)
    )
    if (controller.signal.aborted) throw new Error('ABORTED')
    return pages.flatMap((page) => page.map(toItem))
  } catch (error) {
    controller.abort()
    throw error
  }
}

// Share only unfinished public reads; a new mount after completion reads fresh data.
export function subscribeResolvedFavorites(ids: string[]) {
  const key = ids.join(',')
  let job = inFlight.get(key)
  if (!job) {
    const controller = new AbortController()
    const created: Resolution = { controller, subscribers: 0, promise: resolve(ids, controller) }
    created.promise = created.promise.finally(() => {
      if (inFlight.get(key) === created) inFlight.delete(key)
    })
    inFlight.set(key, created)
    job = created
  }
  job.subscribers++
  const current = job
  let released = false
  return {
    promise: current.promise,
    release() {
      if (released) return
      released = true
      if (--current.subscribers === 0) {
        if (inFlight.get(key) === current) inFlight.delete(key)
        current.controller.abort()
      }
    }
  }
}
