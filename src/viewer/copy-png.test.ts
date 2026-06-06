import { describe, expect, it, vi } from 'vitest'
import { copyDiagram, makeBrowserStrategies, withExplicitDimensions } from './copy-png'

const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

describe('copyDiagram', () => {
  it('reports png on success', async () => {
    const toPng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    const writePng = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    const result = await copyDiagram(svgText, 2, { toPng, writePng, writeText })
    expect(result).toBe('png')
    expect(toPng).toHaveBeenCalledWith(svgText, 2)
    expect(writePng).toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to svg text when png conversion fails (foreignObject taint)', async () => {
    const toPng = vi.fn(async () => {
      throw new DOMException('tainted', 'SecurityError')
    })
    const writeText = vi.fn(async () => {})
    const result = await copyDiagram(svgText, 2, { toPng, writePng: vi.fn(), writeText })
    expect(result).toBe('svg')
    expect(writeText).toHaveBeenCalledWith(svgText)
  })

  it('reports failure when both paths fail', async () => {
    const fail = async () => {
      throw new Error('nope')
    }
    const result = await copyDiagram(svgText, 2, { toPng: fail, writePng: fail, writeText: fail })
    expect(result).toBe('failed')
  })

  it('falls back to svg text when png clipboard write fails (e.g. no ClipboardItem)', async () => {
    const toPng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    const writePng = vi.fn(async () => {
      throw new Error('ClipboardItem is not defined')
    })
    const writeText = vi.fn(async () => {})
    const result = await copyDiagram(svgText, 2, { toPng, writePng, writeText })
    expect(result).toBe('svg')
    expect(writeText).toHaveBeenCalledWith(svgText)
  })
})

describe('withExplicitDimensions', () => {
  // mermaid emits width="100%" + viewBox and no height; as an <img> that
  // resolves to the default ~300×150 intrinsic size and the raster is cropped
  // or letterboxed (issue #2). Pinning explicit dims from the viewBox fixes it.
  it('pins width/height from the viewBox when width is a percentage', () => {
    const out = withExplicitDimensions(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 239.5 355.9"><g/></svg>',
    )
    const root = new DOMParser().parseFromString(out, 'image/svg+xml').documentElement
    expect(root.getAttribute('width')).toBe('239.5')
    expect(root.getAttribute('height')).toBe('355.9')
  })

  it('respects viewBox min-x/min-y offsets only for size, not origin', () => {
    const out = withExplicitDimensions(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="-50 -10 450 259"><g/></svg>',
    )
    const root = new DOMParser().parseFromString(out, 'image/svg+xml').documentElement
    expect(root.getAttribute('width')).toBe('450')
    expect(root.getAttribute('height')).toBe('259')
  })

  it('leaves explicit absolute dimensions alone', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 240 160"><g/></svg>'
    const root = new DOMParser()
      .parseFromString(withExplicitDimensions(svg), 'image/svg+xml')
      .documentElement
    expect(root.getAttribute('width')).toBe('120')
    expect(root.getAttribute('height')).toBe('80')
  })

  it('returns input unchanged when there is no viewBox to derive from', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%"><g/></svg>'
    expect(withExplicitDimensions(svg)).toBe(svg)
  })

  it('returns input unchanged when the svg does not parse', () => {
    expect(withExplicitDimensions('not xml <')).toBe('not xml <')
  })
})

describe('makeBrowserStrategies', () => {
  it('toPng loads the svg from a data: URL, never a blob: URL', async () => {
    // Chromium taints the canvas when an SVG image containing <foreignObject>
    // (mermaid htmlLabels output) was loaded from a blob: URL; the same SVG
    // from a data: URL rasterizes cleanly. Probed empirically in issue #2.
    const srcs: string[] = []
    class FakeImage {
      naturalWidth = 10
      naturalHeight = 10
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(v: string) {
        srcs.push(v)
        queueMicrotask(() => this.onload?.())
      }
    }
    const pngBlob = new Blob(['png'], { type: 'image/png' })
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ scale: vi.fn(), drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(pngBlob),
    }
    const createObjectURL = vi.fn(() => 'blob:fake')
    const fakeWin = {
      document: { createElement: () => fakeCanvas } as unknown as Document,
      navigator: {} as unknown as Navigator,
      ClipboardItem: function () {} as unknown as typeof ClipboardItem,
      Image: FakeImage as unknown as typeof Image,
      URL: { createObjectURL, revokeObjectURL: vi.fn() } as unknown as typeof URL,
    }
    const result = await makeBrowserStrategies(fakeWin).toPng('<svg>x</svg>', 2)
    expect(result).toBe(pngBlob)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(srcs).toHaveLength(1)
    expect(srcs[0]).toMatch(/^data:image\/svg\+xml/)

    // and the encoded svg has its viewBox dims pinned as width/height
    srcs.length = 0
    await makeBrowserStrategies(fakeWin).toPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 10"><g/></svg>',
      2,
    )
    const decoded = decodeURIComponent(srcs[0]!.replace('data:image/svg+xml;charset=utf-8,', ''))
    expect(decoded).toContain('width="20"')
    expect(decoded).toContain('height="10"')
  })

  it('writeText uses the supplied window navigator, not the global', async () => {
    const writeText = vi.fn(async () => {})
    // ClipboardItem is absent in jsdom; provide a stand-in that won't be called by writeText
    const FakeClipboardItem = function (data: Record<string, Blob>) {
      return { data }
    } as unknown as typeof ClipboardItem
    const fakeWin = {
      document,
      navigator: { clipboard: { writeText, write: vi.fn() } } as unknown as Navigator,
      ClipboardItem: FakeClipboardItem,
      Image,
      URL,
    }
    const strategies = makeBrowserStrategies(fakeWin)
    await strategies.writeText('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('writePng uses the supplied window ClipboardItem and navigator.clipboard.write', async () => {
    const write = vi.fn(async () => {})
    // Use a real function (constructable) so `new win.ClipboardItem(...)` works
    const instances: Array<{ data: Record<string, Blob> }> = []
    const FakeClipboardItem = function (this: { data: Record<string, Blob> }, data: Record<string, Blob>) {
      this.data = data
      instances.push(this)
    } as unknown as typeof ClipboardItem
    const fakeWin = {
      document,
      navigator: { clipboard: { writeText: vi.fn(), write } } as unknown as Navigator,
      ClipboardItem: FakeClipboardItem,
      Image,
      URL,
    }
    const strategies = makeBrowserStrategies(fakeWin)
    const blob = new Blob(['png'], { type: 'image/png' })
    await strategies.writePng(blob)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.data).toEqual({ 'image/png': blob })
    expect(write).toHaveBeenCalledTimes(1)
  })
})
