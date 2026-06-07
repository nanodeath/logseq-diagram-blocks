import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeStore } from '../core/theme'
import type { DiagramRenderer, RenderResult } from '../core/types'
import { renderInto } from './render-into'
import * as overlayModule from './overlay'

const okRenderer: DiagramRenderer = {
  languages: ['mermaid'],
  render: vi.fn(async (_code, opts) => ({ ok: true as const, svg: `<svg data-theme="${opts.theme}"></svg>` })),
}

function tick() {
  return new Promise((r) => setTimeout(r, 0))
}

/** Returns a renderer whose render() calls can be resolved manually. */
function deferredRenderer() {
  const resolvers: Array<(value: RenderResult) => void> = []
  const renderer: DiagramRenderer = {
    languages: ['mermaid'],
    render: vi.fn(
      (_code, opts) =>
        new Promise<RenderResult>((resolve) => {
          resolvers.push((v) => resolve(v ?? { ok: true as const, svg: `<svg data-theme="${opts.theme}"></svg>` }))
        }),
    ),
  }
  return {
    renderer,
    /** Resolve the nth pending render call (0-indexed). */
    resolve(index: number, value?: RenderResult) {
      const svg = `<svg data-theme="resolved-${index}"></svg>`
      resolvers[index]?.(value ?? { ok: true as const, svg })
    },
  }
}

describe('renderInto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders svg and toolbar into the container', async () => {
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('auto', 'dark'),
      getPngScale: () => 2,
    })
    await tick()
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('.diagram-blocks-toolbar')).not.toBeNull()
  })

  it('re-renders when the theme changes', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, getPngScale: () => 2 })
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
    const dispose = renderInto(el, 'x', { renderer: failing, themeStore: store, getPngScale: () => 2 })
    await tick()
    expect(el.querySelector('.diagram-blocks-error')!.textContent).toContain('bad syntax')
    dispose()
    store.setMode('dark') // must not throw or touch the removed node
  })

  it('stale render does not clobber a newer completed render', async () => {
    const { renderer, resolve } = deferredRenderer()
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    renderInto(el, 'graph TD; A-->B', { renderer, themeStore: store, getPngScale: () => 2 })
    // render #0 is in flight; trigger a second render via theme change
    store.setMode('dark')
    // render #1 is now also in flight; resolve the SECOND render first
    resolve(1, { ok: true, svg: '<svg data-theme="second"></svg>' })
    await tick()
    // then resolve the FIRST (stale) render
    resolve(0, { ok: true, svg: '<svg data-theme="first-stale"></svg>' })
    await tick()
    // DOM must reflect the second render, not the stale first
    expect(el.querySelector('svg')!.getAttribute('data-theme')).toBe('second')
  })

  it('render resolving after dispose does not touch the DOM', async () => {
    const { renderer, resolve } = deferredRenderer()
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    const dispose = renderInto(el, 'graph TD; A-->B', { renderer, themeStore: store, getPngScale: () => 2 })
    // dispose before any render completes
    dispose()
    // now resolve the pending render
    resolve(0, { ok: true, svg: '<svg data-theme="late"></svg>' })
    await tick()
    // The render never completed before dispose, so the container was naturally
    // empty; the disposed-flag guard prevents the late render from populating it.
    expect(el.querySelector('svg')).toBeNull()
  })

  it('does not clear the container on dispose', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    const dispose = renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, getPngScale: () => 2 })
    await tick()
    expect(el.querySelector('svg')).not.toBeNull()
    dispose()
    // Last-good diagram stays in the DOM so the next renderInto can render over it (no flash).
    expect(el.querySelector('svg')).not.toBeNull()
  })

  it('shows error badge over last-good diagram on subsequent error', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    // First renderInto succeeds and leaves a good diagram in the DOM.
    const dispose = renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, getPngScale: () => 2 })
    await tick()
    expect(el.querySelector('svg')).not.toBeNull()
    dispose()

    // Second renderInto (simulating an edit) uses a failing renderer.
    const failing: DiagramRenderer = {
      languages: ['mermaid'],
      render: async () => ({ ok: false, error: { message: 'bad syntax' } }),
    }
    renderInto(el, 'oops', { renderer: failing, themeStore: store, getPngScale: () => 2 })
    await tick()
    // Last-good SVG stays visible, flagged with a badge; no full error card.
    expect(el.querySelector('svg')).not.toBeNull()
    const badge = el.querySelector('.diagram-blocks-error-badge')
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('title')).toBe('bad syntax')
    expect(el.querySelector('.diagram-blocks-error')).toBeNull()
  })

  it('shows loading spinner on existing diagram after 500 ms', async () => {
    vi.useFakeTimers()
    try {
      const el = document.createElement('div')
      const store = new ThemeStore('auto', 'light')
      // First renderInto completes, leaving a good diagram.
      const dispose = renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, getPngScale: () => 2 })
      await vi.runAllTimersAsync()
      expect(el.querySelector('svg')).not.toBeNull()
      dispose()

      // Second renderInto starts but its render does not resolve.
      const { renderer, resolve } = deferredRenderer()
      renderInto(el, 'graph TD; A-->B', { renderer, themeStore: store, getPngScale: () => 2 })
      await Promise.resolve() // let draw() reach the await before timers fire

      await vi.advanceTimersByTimeAsync(499)
      expect(el.querySelector('.diagram-blocks-loading')).toBeNull()
      await vi.advanceTimersByTimeAsync(2)
      expect(el.querySelector('.diagram-blocks-loading')).not.toBeNull()

      // Resolving the render clears the spinner.
      resolve(0, { ok: true, svg: '<svg data-theme="done"></svg>' })
      await vi.runAllTimersAsync()
      expect(el.querySelector('.diagram-blocks-loading')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sets opaque white background on svg when pinned light-designed theme contradicts dark mode', async () => {
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('forest', 'dark'),
      getPngScale: () => 2,
    })
    await tick()
    const svg = el.querySelector<HTMLElement>('svg')
    // jsdom normalizes hex to rgb — accept either form
    expect(svg?.style.background).toMatch(/^(#ffffff|rgb\(255,\s*255,\s*255\))$/)
    expect(svg?.style.borderRadius).toBe('6px')
    expect(svg?.style.padding).toBe('8px')
  })

  it('leaves background transparent when auto-resolved theme matches mode', async () => {
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('auto', 'light'),
      getPngScale: () => 2,
    })
    await tick()
    const svg = el.querySelector<HTMLElement>('svg')
    // background should not be set to an opaque color
    expect(svg?.style.background).toBeFalsy()
  })

  it('clears background when re-rendering switches from mismatched to matched theme', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('forest', 'dark') // mismatch → white bg
    renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, getPngScale: () => 2 })
    await tick()
    // jsdom normalizes hex to rgb — accept either form
    expect(el.querySelector<HTMLElement>('svg')?.style.background).toMatch(/^(#ffffff|rgb\(255,\s*255,\s*255\))$/)

    // Switch to auto + dark → resolves to 'dark' which matches dark mode
    store.setSetting('auto')
    // setMode would also work, but setSetting changes the resolved theme
    store.setMode('dark') // stays dark; after setSetting('auto') resolved = 'dark'
    await tick()
    const svg = el.querySelector<HTMLElement>('svg')
    // After clearing, background should be empty string (no inline style)
    expect(svg?.style.background).toBe('')
  })

  it('passes background to openOverlay when theme contradicts mode', async () => {
    const openOverlaySpy = vi.spyOn(overlayModule, 'openOverlay')
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('forest', 'dark'),
      getPngScale: () => 2,
    })
    await tick()

    // Click the fullscreen button to trigger openOverlay
    const fullscreenBtn = el.querySelector<HTMLButtonElement>('[title="Fullscreen"]')
    fullscreenBtn?.click()

    expect(openOverlaySpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      '#ffffff',
    )
    openOverlaySpy.mockRestore()
  })
})
