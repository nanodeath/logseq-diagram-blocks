import '@logseq/libs'

async function main() {
  const host = logseq.Experiments.ensureHostScope()
  if (!host.mermaid) {
    await logseq.Experiments.loadScripts('./vendors/mermaid.min.js')
  }
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
}

logseq.ready(main).catch(console.error)
