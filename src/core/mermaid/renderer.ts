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
      // NOTE: htmlLabels stays at its default (true). Disabling it dodges
      // host-CSS label restyling but mermaid then mis-measures SVG <text>
      // labels (text overflows nodes); the viewer.css foreignObject backstop
      // handles the restyling instead.
      api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: opts.theme })
      const { svg } = await api.render(`diagram-blocks-${++this.seq}`, code)
      return { ok: true, svg }
    } catch (e) {
      return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}
