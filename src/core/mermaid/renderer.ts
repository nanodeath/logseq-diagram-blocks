import type { DiagramRenderer, RenderOptions, RenderResult } from '../types'

/** Minimal surface of the mermaid global we rely on. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
}

export type MermaidLoader = () => Promise<MermaidApi>

export class MermaidRenderer implements DiagramRenderer {
  readonly languages = ['mermaid'] as const
  private apiPromise: Promise<MermaidApi> | undefined
  private seq = 0

  constructor(private load: MermaidLoader) {}

  // bindFunctions omitted; widen if click handlers are ever needed
  async render(code: string, opts: RenderOptions): Promise<RenderResult> {
    try {
      this.apiPromise ??= this.load().catch((e) => {
        this.apiPromise = undefined
        throw e
      })
      const api = await this.apiPromise
      // mermaid's initialize is global state in the host page; setting it per
      // render keeps theme switches correct without a separate config channel.
      // htmlLabels: false renders labels as SVG <text> instead of
      // <foreignObject> HTML — immune to host-page CSS (Logseq's `p { color }`
      // rules override inherited label colors) and never taints the canvas
      // during copy-PNG.
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: opts.theme,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      })
      const { svg } = await api.render(`diagram-blocks-${++this.seq}`, code)
      return { ok: true, svg }
    } catch (e) {
      return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}
