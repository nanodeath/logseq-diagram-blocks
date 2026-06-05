import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Logseq loads the plugin from dist/ via file://, so paths must be relative
  base: './',
  resolve: {
    // Adapter code says `import React from 'react'` but gets the host's React.
    // viewer/ and core/ never import react — enforced by review, keeps them host-agnostic.
    alias: { react: resolve(__dirname, 'src/host/react.ts') },
  },
  build: { target: 'es2022' },
})
