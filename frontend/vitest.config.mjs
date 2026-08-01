import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist', 'tests/e2e'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/stores/**'],
      exclude: ['src/lib/utils.ts', 'src/lib/mock-data.ts']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src')
    }
  }
})