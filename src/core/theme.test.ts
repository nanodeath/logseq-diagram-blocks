import { describe, expect, it, vi } from 'vitest'
import { ThemeStore, resolveTheme, themeBackground } from './theme'

describe('resolveTheme', () => {
  it('maps auto+light to default', () => {
    expect(resolveTheme('auto', 'light')).toBe('default')
  })
  it('maps auto+dark to dark', () => {
    expect(resolveTheme('auto', 'dark')).toBe('dark')
  })
  it('pins an explicit setting regardless of mode', () => {
    expect(resolveTheme('forest', 'dark')).toBe('forest')
  })
})

describe('themeBackground', () => {
  // Light-designed themes on light mode → transparent (undefined)
  it('returns undefined for default on light', () => {
    expect(themeBackground('default', 'light')).toBeUndefined()
  })
  it('returns undefined for forest on light', () => {
    expect(themeBackground('forest', 'light')).toBeUndefined()
  })
  it('returns undefined for neutral on light', () => {
    expect(themeBackground('neutral', 'light')).toBeUndefined()
  })
  it('returns undefined for base on light', () => {
    expect(themeBackground('base', 'light')).toBeUndefined()
  })
  // Dark-designed theme on dark mode → transparent (undefined)
  it('returns undefined for dark on dark', () => {
    expect(themeBackground('dark', 'dark')).toBeUndefined()
  })
  // Light-designed themes on dark mode → white backing
  it('returns #ffffff for default on dark', () => {
    expect(themeBackground('default', 'dark')).toBe('#ffffff')
  })
  it('returns #ffffff for forest on dark', () => {
    expect(themeBackground('forest', 'dark')).toBe('#ffffff')
  })
  it('returns #ffffff for neutral on dark', () => {
    expect(themeBackground('neutral', 'dark')).toBe('#ffffff')
  })
  it('returns #ffffff for base on dark', () => {
    expect(themeBackground('base', 'dark')).toBe('#ffffff')
  })
  // Dark-designed theme on light mode → dark backing
  it('returns #333333 for dark on light', () => {
    expect(themeBackground('dark', 'light')).toBe('#333333')
  })
})

describe('ThemeStore', () => {
  it('notifies subscribers when resolved theme changes', () => {
    const store = new ThemeStore('auto', 'light')
    const cb = vi.fn()
    store.subscribe(cb)
    store.setMode('dark')
    expect(cb).toHaveBeenCalledWith('dark')
  })

  it('does not notify when resolved theme is unchanged', () => {
    const store = new ThemeStore('forest', 'light')
    const cb = vi.fn()
    store.subscribe(cb)
    store.setMode('dark') // pinned forest — resolved theme unchanged
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribes', () => {
    const store = new ThemeStore('auto', 'light')
    const cb = vi.fn()
    const off = store.subscribe(cb)
    off()
    store.setMode('dark')
    expect(cb).not.toHaveBeenCalled()
  })

  it('notifies when setSetting changes the resolved theme', () => {
    const store = new ThemeStore('auto', 'light')
    const cb = vi.fn()
    store.subscribe(cb)
    store.setSetting('forest')
    expect(cb).toHaveBeenCalledWith('forest')
  })

  it('keeps notifying later subscribers when an earlier listener throws', () => {
    const store = new ThemeStore('auto', 'light')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.subscribe(() => {
      throw new Error('boom')
    })
    const cb = vi.fn()
    store.subscribe(cb)
    store.setMode('dark')
    expect(cb).toHaveBeenCalledWith('dark')
    errorSpy.mockRestore()
  })

  it('mode getter reflects the current mode', () => {
    const store = new ThemeStore('auto', 'light')
    expect(store.mode).toBe('light')
    store.setMode('dark')
    expect(store.mode).toBe('dark')
  })
})
