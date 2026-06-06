import { describe, expect, it, vi } from 'vitest'
import { copyDiagram } from './copy-png'

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
})
