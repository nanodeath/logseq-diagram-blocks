import { describe, expect, it, vi } from 'vitest'
import { ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { renderInto } from './render-into'

const okRenderer: DiagramRenderer = {
  languages: ['mermaid'],
  render: vi.fn(async (_code, opts) => ({ ok: true as const, svg: `<svg data-theme="${opts.theme}"></svg>` })),
}

function tick() {
  return new Promise((r) => setTimeout(r, 0))
}

describe('renderInto', () => {
  it('renders svg and toolbar into the container', async () => {
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('auto', 'dark'),
      pngScale: 2,
    })
    await tick()
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('.diagram-blocks-toolbar')).not.toBeNull()
  })

  it('re-renders when the theme changes', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, pngScale: 2 })
    await tick()
    store.setMode('dark')
    await tick()
    expect(el.querySelector('svg')!.getAttribute('data-theme')).toBe('dark')
  })

  it('shows error card on failure and stops listening after dispose', async () => {
    const failing: DiagramRenderer = {
      languages: ['mermaid'],
      render: async () => ({ ok: false, error: { message: 'bad syntax' } }),
    }
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    const dispose = renderInto(el, 'x', { renderer: failing, themeStore: store, pngScale: 2 })
    await tick()
    expect(el.querySelector('.diagram-blocks-error')!.textContent).toContain('bad syntax')
    dispose()
    store.setMode('dark') // must not throw or touch the removed node
  })
})
