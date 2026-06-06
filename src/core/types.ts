export type DiagramTheme = 'default' | 'dark' | 'forest' | 'neutral' | 'base'
export type ThemeSetting = 'auto' | DiagramTheme
export type LogseqMode = 'light' | 'dark'

export interface RenderOptions {
  theme: DiagramTheme
}

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: { message: string } }

export interface DiagramRenderer {
  /** fenced code block languages this renderer handles, e.g. ['mermaid'] */
  readonly languages: readonly string[]
  render(code: string, opts: RenderOptions): Promise<RenderResult>
}
