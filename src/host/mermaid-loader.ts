import type { MermaidApi, MermaidLoader } from '../core/mermaid/renderer'

/** loadScripts resolves regardless of script execution (resolves even on 404 —
 *  confirmed in spike testing). Poll for the global instead of trusting it. */
async function waitFor<T>(get: () => T | undefined, what: string, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = get()
    if (v !== undefined) return v
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

export const hostMermaidLoader: MermaidLoader = async (): Promise<MermaidApi> => {
  const host = logseq.Experiments.ensureHostScope()
  if (!host.mermaid) {
    // Path is relative to the PLUGIN ROOT (package.json dir), not dist/ —
    // confirmed by ERR_FILE_NOT_FOUND in spike when file only existed at dist/vendors/.
    await logseq.Experiments.loadScripts('./vendors/mermaid.min.js')
    // loadScripts resolves even on 404 — poll for actual host.mermaid presence.
    await waitFor(() => host.mermaid as MermaidApi | undefined, 'host.mermaid')
  }
  if (!host.mermaid) throw new Error('mermaid failed to load into host scope')
  return host.mermaid as MermaidApi
}
