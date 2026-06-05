import { defineConfig } from 'vitest/config'

export default defineConfig({
  // NOTE: does not inherit vite.config.ts aliases — adapter files (src/adapter, src/host)
  // must not be imported by unit tests; switch to mergeConfig if that ever changes.
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], passWithNoTests: true },
})
