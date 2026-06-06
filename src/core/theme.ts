import type { DiagramTheme, LogseqMode, ThemeSetting } from './types'

export function resolveTheme(setting: ThemeSetting, mode: LogseqMode): DiagramTheme {
  if (setting !== 'auto') return setting
  return mode === 'dark' ? 'dark' : 'default'
}

type Listener = (theme: DiagramTheme) => void

export class ThemeStore {
  private listeners = new Set<Listener>()

  constructor(
    private setting: ThemeSetting,
    private mode: LogseqMode,
  ) {}

  get theme(): DiagramTheme {
    return resolveTheme(this.setting, this.mode)
  }

  setMode(mode: LogseqMode): void {
    this.update(this.setting, mode)
  }

  setSetting(setting: ThemeSetting): void {
    this.update(setting, this.mode)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private update(setting: ThemeSetting, mode: LogseqMode): void {
    const before = this.theme
    this.setting = setting
    this.mode = mode
    const after = this.theme
    if (after !== before) {
      for (const fn of [...this.listeners]) {
        try {
          fn(after)
        } catch (e) {
          console.error('[diagram-blocks] ThemeStore listener threw', e)
        }
      }
    }
  }
}
