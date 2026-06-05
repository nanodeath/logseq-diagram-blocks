import { copyFile, mkdir } from 'node:fs/promises'

await mkdir('dist/vendors', { recursive: true })
await copyFile('node_modules/mermaid/dist/mermaid.min.js', 'dist/vendors/mermaid.min.js')
console.log('vendored mermaid')
