import { describe, expect, it, vi } from 'vitest'
import { copyDiagram, makeBrowserStrategies } from './copy-png'

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

describe('makeBrowserStrategies', () => {
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
