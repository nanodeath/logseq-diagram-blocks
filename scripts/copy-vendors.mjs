import { copyFile, mkdir } from 'node:fs/promises'

// loadScripts resolves paths against the PLUGIN ROOT (package.json dir).
// Published zips have vendors/ at the zip root; in dev the plugin root is the
// repo root, so vendor to BOTH locations to keep one './vendors/...' path.
for (const dir of ['dist/vendors', 'vendors']) {
  await mkdir(dir, { recursive: true })
  await copyFile('node_modules/mermaid/dist/mermaid.min.js', `${dir}/mermaid.min.js`)
}
console.log('vendored mermaid (dist/vendors + ./vendors)')
