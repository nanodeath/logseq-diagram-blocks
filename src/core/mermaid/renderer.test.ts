import { describe, expect, it, vi } from 'vitest'
import { MermaidRenderer, type MermaidApi } from './renderer'

function fakeMermaid(overrides: Partial<MermaidApi> = {}): MermaidApi {
  return {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg>ok</svg>' })),
    ...overrides,
  }
}

describe('MermaidRenderer', () => {
  it('handles the mermaid language', () => {
    const r = new MermaidRenderer(async () => fakeMermaid())
    expect(r.languages).toContain('mermaid')
  })

  it('returns ok result with svg', async () => {
    const r = new MermaidRenderer(async () => fakeMermaid())
    const result = await r.render('graph TD; A-->B', { theme: 'dark' })
    expect(result).toEqual({ ok: true, svg: '<svg>ok</svg>' })
  })

  it('initializes mermaid with the requested theme and strict security', async () => {
    const api = fakeMermaid()
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'forest' })
    expect(api.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'forest', securityLevel: 'strict', startOnLoad: false }),
    )
  })

  it('returns typed error instead of throwing on parse failure', async () => {
    const api = fakeMermaid({
      render: vi.fn(async () => {
        throw new Error('Parse error on line 2')
      }),
    })
    const r = new MermaidRenderer(async () => api)
    const result = await r.render('not mermaid', { theme: 'default' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('Parse error on line 2')
  })

  it('loads the mermaid api only once across renders', async () => {
    const loader = vi.fn(async () => fakeMermaid())
    const r = new MermaidRenderer(loader)
    await r.render('graph TD; A-->B', { theme: 'default' })
    await r.render('graph TD; B-->C', { theme: 'default' })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('generates unique element ids per render', async () => {
    const api = fakeMermaid()
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'default' })
    await r.render('graph TD; A-->B', { theme: 'default' })
    const calls = (api.render as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]![0]).not.toBe(calls[1]![0])
  })
})
