import type { DiagramTheme, LogseqMode, ThemeSetting } from './types'

export function resolveTheme(setting: ThemeSetting, mode: LogseqMode): DiagramTheme {
  if (setting !== 'auto') return setting
  return mode === 'dark' ? 'dark' : 'default'
}

/**
 * Returns an opaque background color when the theme's design background
 * contradicts the Logseq page mode, so that labels remain readable on the SVG.
 *
 * - Returns `undefined` (keep transparent) when theme and mode match:
 *   light-designed themes ('default' | 'forest' | 'neutral' | 'base') on 'light',
 *   and 'dark' on 'dark'.
 * - Returns `'#ffffff'` for light-designed themes on mode 'dark'.
 * - Returns `'#333333'` for theme 'dark' on mode 'light'.
 */
export function themeBackground(theme: DiagramTheme, mode: LogseqMode): string | undefined {
  const isLightDesigned = theme !== 'dark'
  if (isLightDesigned) {
    return mode === 'dark' ? '#ffffff' : undefined
  }
  // theme === 'dark'
  return mode === 'light' ? '#333333' : undefined
}

type Listener = (theme: DiagramTheme) => void

export class ThemeStore {
  private listeners = new Set<Listener>()

  constructor(
    private setting: ThemeSetting,
    private _mode: LogseqMode,
  ) {}

  get theme(): DiagramTheme {
    return resolveTheme(this.setting, this._mode)
  }

  get mode(): LogseqMode {
    return this._mode
  }

  setMode(mode: LogseqMode): void {
    this.update(this.setting, mode)
  }

  setSetting(setting: ThemeSetting): void {
    this.update(setting, this._mode)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private update(setting: ThemeSetting, mode: LogseqMode): void {
    const before = this.theme
    this.setting = setting
    this._mode = mode
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
