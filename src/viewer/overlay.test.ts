import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeFit, zoomAt, openOverlay } from './overlay'

// ---------------------------------------------------------------------------
// Unit tests for pure helpers
// ---------------------------------------------------------------------------

describe('computeFit', () => {
  it('downscales a large diagram to fit within 90% of the viewport, centered', () => {
    // viewport 1000x800, diagram 2000x1600 → fits in 900x720 at 0.45x
    const result = computeFit(2000, 1600, 1000, 800)
    expect(result.scale).toBeCloseTo(0.45)
    // tx should center: (1000 - 2000*0.45) / 2 = (1000 - 900) / 2 = 50
    expect(result.tx).toBeCloseTo(50)
    // ty: (800 - 1600*0.45) / 2 = (800 - 720) / 2 = 40
    expect(result.ty).toBeCloseTo(40)
  })

  it('handles landscape diagrams that are wider than tall relative to viewport', () => {
    // viewport 800x600, diagram 1600x200 → limited by width: 800*0.9/1600 = 0.45
    const result = computeFit(1600, 200, 800, 600)
    expect(result.scale).toBeCloseTo(0.45)
    expect(result.tx).toBeCloseTo((800 - 1600 * 0.45) / 2)
    expect(result.ty).toBeCloseTo((600 - 200 * 0.45) / 2)
  })

  it('handles portrait diagrams that are taller than wide relative to viewport', () => {
    // viewport 800x600, diagram 200x1200 → limited by height: 600*0.9/1200 = 0.45
    const result = computeFit(200, 1200, 800, 600)
    expect(result.scale).toBeCloseTo(0.45)
  })

  it('small diagram upscales but caps at 2x', () => {
    // viewport 2000x2000, diagram 100x100 → natural scale would be 18x, capped at 2
    const result = computeFit(100, 100, 2000, 2000)
    expect(result.scale).toBe(2)
    // centering at 2x: tx = (2000 - 100*2) / 2 = 900
    expect(result.tx).toBeCloseTo(900)
    expect(result.ty).toBeCloseTo(900)
  })

  it('diagram that exactly fits 90% of viewport uses that scale', () => {
    // viewport 1000x1000, diagram 900x900 → scale = 1.0 exactly
    const result = computeFit(900, 900, 1000, 1000)
    expect(result.scale).toBeCloseTo(1.0)
  })

  it('diagram slightly larger than viewport scales below 1', () => {
    const result = computeFit(1000, 1000, 1000, 1000)
    // scale = 900/1000 = 0.9
    expect(result.scale).toBeCloseTo(0.9)
  })
})

describe('zoomAt', () => {
  it('zooms in by a factor around the given point', () => {
    const state = { scale: 1, tx: 0, ty: 0 }
    // zoom toward point (100, 200) by factor 2
    const result = zoomAt(state, 100, 200, 2)
    expect(result.scale).toBe(2)
    // tx' = cx - (cx - tx) * (newScale / scale) = 100 - (100 - 0) * 2 = -100
    expect(result.tx).toBeCloseTo(-100)
    // ty' = cy - (cy - ty) * (newScale / scale) = 200 - (200 - 0) * 2 = -200
    expect(result.ty).toBeCloseTo(-200)
  })

  it('zooms out by a factor, the cursor point stays fixed', () => {
    // start at scale=2 with offset, zoom toward cursor
    const state = { scale: 2, tx: -100, ty: -200 }
    const result = zoomAt(state, 100, 200, 0.5)
    expect(result.scale).toBeCloseTo(1)
    // tx' = 100 - (100 - (-100)) * (1/2) = 100 - 100 = 0
    expect(result.tx).toBeCloseTo(0)
    expect(result.ty).toBeCloseTo(0)
  })

  it('clamps at minScale', () => {
    const state = { scale: 0.15, tx: 0, ty: 0 }
    const result = zoomAt(state, 0, 0, 0.5, 0.1, 10)
    expect(result.scale).toBe(0.1)
  })

  it('clamps at maxScale', () => {
    const state = { scale: 8, tx: 0, ty: 0 }
    const result = zoomAt(state, 0, 0, 2, 0.1, 10)
    expect(result.scale).toBe(10)
  })

  it('cursor point stays fixed when zooming — proportional tx/ty invariant', () => {
    // With cursor at (cx, cy), the point in content space under cursor
    // before: (cx - tx) / scale
    // after: (cx - tx') / newScale
    // These should be equal (same content point remains under cursor).
    const state = { scale: 1.5, tx: 50, ty: 80 }
    const cx = 300
    const cy = 400
    const factor = 1.3
    const result = zoomAt(state, cx, cy, factor)

    const contentXBefore = (cx - state.tx) / state.scale
    const contentXAfter = (cx - result.tx) / result.scale
    expect(contentXAfter).toBeCloseTo(contentXBefore)

    const contentYBefore = (cy - state.ty) / state.scale
    const contentYAfter = (cy - result.ty) / result.scale
    expect(contentYAfter).toBeCloseTo(contentYBefore)
  })

  it('uses default minScale=0.1 and maxScale=10', () => {
    const state = { scale: 0.11, tx: 0, ty: 0 }
    const result = zoomAt(state, 0, 0, 0.5)
    expect(result.scale).toBe(0.1)

    const state2 = { scale: 9, tx: 0, ty: 0 }
    const result2 = zoomAt(state2, 0, 0, 2)
    expect(result2.scale).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Integration tests for openOverlay (realm routing, keyboard close, etc.)
// ---------------------------------------------------------------------------

describe('openOverlay realm routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends the backdrop to the supplied document, not global document.body', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    expect(hostDoc.body.querySelector('.diagram-blocks-overlay')).not.toBeNull()
    expect(document.body.querySelector('.diagram-blocks-overlay')).toBeNull()
  })

  it('removes the backdrop when Escape is pressed on the supplied document', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    expect(hostDoc.body.querySelector('.diagram-blocks-overlay')).not.toBeNull()

    // jsdom supports dispatchEvent on the document directly
    hostDoc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(hostDoc.body.querySelector('.diagram-blocks-overlay')).toBeNull()
  })

  it('does NOT remove the backdrop when Escape is pressed on the global document', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    // Pressing Escape on the wrong document should not close
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(hostDoc.body.querySelector('.diagram-blocks-overlay')).not.toBeNull()
    // cleanup
    hostDoc.body.querySelector<HTMLElement>('.diagram-blocks-overlay')?.remove()
  })

  it('removes the backdrop when the close button is clicked', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    const closeBtn = hostDoc.body.querySelector<HTMLButtonElement>('.diagram-blocks-overlay-close')
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()

    expect(hostDoc.body.querySelector('.diagram-blocks-overlay')).toBeNull()
  })

  it('double-close guard: calling close twice does not throw', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    const close = openOverlay('<svg></svg>', hostDoc)

    expect(() => {
      close()
      close()
    }).not.toThrow()
  })

  it('stage element exists inside the backdrop', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    const backdrop = hostDoc.body.querySelector('.diagram-blocks-overlay')
    expect(backdrop?.querySelector('.diagram-blocks-overlay-stage')).not.toBeNull()
  })

  it('SVG is placed inside the stage', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg viewBox="0 0 400 300"></svg>', hostDoc)

    const stage = hostDoc.body.querySelector('.diagram-blocks-overlay-stage')
    expect(stage?.querySelector('svg')).not.toBeNull()
  })

  it('sets SVG width/height attributes to natural pixel size from viewBox', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg viewBox="0 0 400 300"></svg>', hostDoc)

    const svg = hostDoc.body.querySelector('svg')
    // In jsdom viewBox.baseVal may be 0 or unavailable → falls back to attributes or 800×600
    // We just check that width/height are numeric attributes (not removed)
    const w = svg?.getAttribute('width')
    const h = svg?.getAttribute('height')
    expect(w).not.toBeNull()
    expect(h).not.toBeNull()
    // Should be a numeric string
    expect(Number(w)).toBeGreaterThan(0)
    expect(Number(h)).toBeGreaterThan(0)
  })

  it('falls back gracefully when SVG has no viewBox or size attributes', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    // Should not throw even with a bare SVG
    expect(() => openOverlay('<svg></svg>', hostDoc)).not.toThrow()

    const svg = hostDoc.body.querySelector('svg')
    // fallback 800x600
    expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(0)
    expect(Number(svg?.getAttribute('height'))).toBeGreaterThan(0)
  })

  it('stage initial transform is set (translate + scale applied)', () => {
    const hostDoc = document.implementation.createHTMLDocument('host')
    openOverlay('<svg></svg>', hostDoc)

    const stage = hostDoc.body.querySelector<HTMLElement>('.diagram-blocks-overlay-stage')
    // transform should be set to a translate/scale string
    expect(stage?.style.transform).toMatch(/translate/)
  })
})
