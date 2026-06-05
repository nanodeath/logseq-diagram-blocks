import '@logseq/libs'

const log = (...args: unknown[]) => console.info('[diagram-blocks spike]', ...args)

/** loadScripts resolves regardless of script execution (it resolved even on a
 *  404 in testing) — poll for the global instead of trusting it. */
async function waitFor<T>(get: () => T | undefined, what: string, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = get()
    if (v !== undefined) return v
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function main() {
  log('main() started')
  const host = logseq.Experiments.ensureHostScope()
  if (!host.mermaid) {
    // Path is relative to the PLUGIN ROOT (package.json dir), not the entry
    // html dir — confirmed by 404 in dev. copy-vendors.mjs now writes
    // ./vendors/ at the repo root so dev matches the published-zip layout.
    log('loading mermaid into host scope')
    await logseq.Experiments.loadScripts('./vendors/mermaid.min.js')
    await waitFor(() => host.mermaid, 'host.mermaid')
  }
  log('mermaid ready in host scope')
  host.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })

  // React is typed as `unknown` in @logseq/libs — cast needed to call createElement/useRef/useEffect
  const React = logseq.Experiments.React as {
    createElement: (...args: unknown[]) => unknown
    useRef: <T>(init: T | null) => { current: T | null }
    useEffect: (fn: () => void, deps: unknown[]) => void
  }

  function SpikeBlock(props: Record<string, unknown>) {
    // SPIKE QUESTION 3: what props do we get? (need block uuid for the Edit button)
    console.info('fenced-renderer props:', Object.keys(props), props)
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
      const id = 'spike-' + Math.random().toString(36).slice(2)
      host.mermaid
        .render(id, String(props.content ?? ''))
        .then(({ svg }: { svg: string }) => {
          if (ref.current) ref.current.innerHTML = svg
        })
        .catch((e: unknown) => {
          if (ref.current) ref.current.textContent = 'render error: ' + String(e)
        })
    }, [props.content])
    return React.createElement('div', { ref })
  }

  logseq.Experiments.registerFencedCodeRenderer('mermaid', {
    edit: false,
    render: SpikeBlock as (props: { content: string }) => unknown,
  })
  log('fenced code renderer registered for mermaid')
}

logseq.ready(main).catch(console.error)
