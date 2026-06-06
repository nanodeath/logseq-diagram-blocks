import { beforeEach, describe, expect, it, vi } from 'vitest'

// panzoom tries to measure DOM elements which jsdom doesn't support on foreign-doc nodes;
// mock it so overlay tests focus on realm routing, not panzoom internals.
vi.mock('panzoom', () => ({
  default: vi.fn(() => ({ dispose: vi.fn() })),
}))

import { openOverlay } from './overlay'

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
})
