import { describe, expect, it, vi } from 'vitest'
import { ThemeStore, resolveTheme } from './theme'

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
})
