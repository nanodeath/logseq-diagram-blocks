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

  it('keeps default html labels (svg-text labels overflow their nodes)', async () => {
    const api = fakeMermaid()
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'default' })
    expect(api.initialize).not.toHaveBeenCalledWith(
      expect.objectContaining({ htmlLabels: false }),
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

  it('retries the loader if the first load fails', async () => {
    let attempt = 0
    const loader = vi.fn(async () => {
      if (++attempt === 1) throw new Error('not ready')
      return fakeMermaid()
    })
    const renderer = new MermaidRenderer(loader)
    const first = await renderer.render('graph TD; A-->B', { theme: 'default' })
    expect(first.ok).toBe(false)
    const second = await renderer.render('graph TD; A-->B', { theme: 'default' })
    expect(second.ok).toBe(true)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('registers Font Awesome icon packs exactly once across renders', async () => {
    const api = fakeMermaid({ registerIconPacks: vi.fn() })
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'default' })
    await r.render('graph TD; B-->C', { theme: 'default' })
    expect(api.registerIconPacks).toHaveBeenCalledTimes(1)
    const packs = (api.registerIconPacks as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(packs.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['fa', 'fas', 'far', 'fab']),
    )
  })

  it('still renders when the mermaid api lacks registerIconPacks', async () => {
    const api = fakeMermaid() // no registerIconPacks — e.g. an older vendored bundle
    const r = new MermaidRenderer(async () => api)
    const result = await r.render('graph TD; A-->B', { theme: 'default' })
    expect(result.ok).toBe(true)
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
