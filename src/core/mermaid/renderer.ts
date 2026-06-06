import type { DiagramRenderer, RenderOptions, RenderResult } from '../types'
import { fontAwesomePacks, type IconPack } from './icon-packs'

/** Minimal surface of the mermaid global we rely on. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
  /** Optional: absent in pre-11.1 bundles; icon support degrades gracefully. */
  registerIconPacks?(packs: IconPack[]): void
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
      this.apiPromise ??= this.load()
        .then((api) => {
          // Once per loaded api: back `fa:fa-name` label shorthand with inline
          // SVG from the bundled FA6 packs (issue #1). Optional-chained so an
          // older mermaid bundle without registerIconPacks still renders.
          api.registerIconPacks?.(fontAwesomePacks)
          return api
        })
        .catch((e) => {
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
