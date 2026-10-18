import assert from 'node:assert/strict'
import test from 'node:test'
import { OrphanService } from '../dist/media/orphan.service.js'

test('untracked old objects are removed; current DB references and young objects survive', async () => {
  const deleted = []
  const old = new Date('2026-01-01T00:00:00Z')
  const fresh = new Date('2026-01-02T12:00:00Z')
  const pages = {
    'assets/': [
      { key: 'assets/referenced', lastModified: old },
      { key: 'assets/orphan', lastModified: old },
      { key: 'assets/fresh', lastModified: fresh }
    ],
    'staging/': [
      { key: 'staging/abandoned', lastModified: old },
      { key: 'staging/pending', lastModified: old }
    ],
    'archive/': [
      { key: 'archive/orphan', lastModified: old },
      { key: 'archive/referenced', lastModified: old }
    ]
  }
  const store = {
    listHot: async (prefix) => ({ objects: pages[prefix], nextToken: undefined }),
    listCold: async (prefix) => ({ objects: pages[prefix], nextToken: undefined }),
    deleteHot: async (key) => { deleted.push(`hot:${key}`) },
    deleteCold: async (key) => { deleted.push(`cold:${key}`) }
  }
  const db = { mediaAsset: {
    findMany: async ({ select }) => {
      const field = Object.keys(select).find((key) => select[key])
      return ({
        hotKey: [{ hotKey: 'assets/referenced' }],
        uploadKey: [{ uploadKey: 'staging/pending' }],
        coldKey: [{ coldKey: 'archive/referenced' }]
      })[field]
    },
    findUnique: async ({ where }) =>
      where.hotKey === 'assets/referenced' ? { hotKey: 'assets/referenced' }
        : where.uploadKey === 'staging/pending' ? { uploadKey: 'staging/pending', status: 'pending' }
          : where.coldKey === 'archive/referenced' ? { coldKey: 'archive/referenced' } : null
  } }
  const cleanup = new OrphanService(db, store)
  const result = await cleanup.reconcileUntracked(new Date('2026-01-03T00:00:00Z'))
  assert.deepEqual(result, { observed: 3, deleted: 3, failed: 0 })
  assert.deepEqual(deleted.sort(), [
    'cold:archive/orphan', 'hot:assets/orphan', 'hot:staging/abandoned'
  ])
})
