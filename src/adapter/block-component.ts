import React from 'react'
import { MermaidRenderer } from '../core/mermaid/renderer'
import type { ThemeStore } from '../core/theme'
import { hostMermaidLoader } from '../host/mermaid-loader'

const renderer = new MermaidRenderer(hostMermaidLoader)

export interface FencedCodeProps {
  /** Fenced block body — the only prop Logseq passes (spike finding #3). */
  content?: string
}

export function makeBlockComponent(themeStore: ThemeStore, getPngScale: () => number) {
  return function DiagramBlock(props: FencedCodeProps) {
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      const el = ref.current
      const code = props.content ?? ''
      if (!el || !code.trim()) return

      let cancelled = false
      let dispose: (() => void) | undefined
      // Lazy chunk: viewer (+ its imports) loads on first diagram encountered.
      void import('../viewer/render-into').then(({ renderInto }) => {
        if (cancelled) return
        dispose = renderInto(el, code, {
          renderer,
          themeStore,
          getPngScale,
          // No onEdit: Logseq's native fenced-code controls already cover
          // editing, so the viewer's Edit buttons stay hidden.
          onCopyDone: (outcome) => {
            const msg =
              outcome === 'png'
                ? 'Diagram copied as PNG'
                : outcome === 'svg'
                  ? 'SVG text copied to clipboard'
                  : 'Copy failed'
            void logseq.UI.showMsg(msg, outcome === 'failed' ? 'error' : 'success')
          },
        })
      })
      return () => {
        cancelled = true
        dispose?.()
      }
    }, [props.content])

    // diagram-blocks-root: debugging / host hook — no visual rules; just a stable selector.
    return React.createElement('div', { ref, className: 'diagram-blocks-root' })
  }
}
