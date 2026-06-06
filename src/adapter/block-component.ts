import React from 'react'
import { MermaidRenderer } from '../core/mermaid/renderer'
import type { ThemeStore } from '../core/theme'
import { hostMermaidLoader } from '../host/mermaid-loader'

const renderer = new MermaidRenderer(hostMermaidLoader)

export interface FencedCodeProps {
  /** Fenced block body — the only prop Logseq passes (spike finding #3). */
  content?: string
}

/**
 * Walk up the host DOM from a mounted element to find the nearest ancestor
 * carrying a `blockid` attribute. Relies on undocumented Logseq DOM structure
 * (observed in 0.10.15); may break on future Logseq versions.
 */
function getBlockUuid(el: HTMLElement): string | undefined {
  const ancestor = el.closest('[blockid]')
  return ancestor?.getAttribute('blockid') ?? undefined
}

export function makeBlockComponent(themeStore: ThemeStore, getPngScale: () => number) {
  return function DiagramBlock(props: FencedCodeProps) {
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      const el = ref.current
      const code = props.content ?? ''
      if (!el || !code.trim()) return

      // Recover block uuid from host DOM (undocumented Logseq attribute).
      // If absent, onEdit stays undefined and the toolbar hides the Edit button.
      const uuid = getBlockUuid(el)

      let dispose: (() => void) | undefined
      // Lazy chunk: viewer (+ its imports) loads on first diagram encountered.
      void import('../viewer/render-into').then(({ renderInto }) => {
        dispose = renderInto(el, code, {
          renderer,
          themeStore,
          pngScale: getPngScale(),
          onEdit: uuid ? () => void logseq.Editor.editBlock(uuid) : undefined,
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
      return () => dispose?.()
    }, [props.content])

    return React.createElement('div', { ref, className: 'diagram-blocks-root' })
  }
}
