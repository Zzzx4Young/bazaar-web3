import { readdirSync } from 'node:fs'

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url)

export function expectedMigrationNames() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
