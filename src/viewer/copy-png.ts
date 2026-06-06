export type CopyOutcome = 'png' | 'svg' | 'failed'

export interface CopyStrategies {
  toPng(svgText: string, scale: number): Promise<Blob>
  writePng(blob: Blob): Promise<void>
  writeText(text: string): Promise<void>
}

export async function copyDiagram(
  svgText: string,
  scale: number,
  s: CopyStrategies = browserStrategies,
): Promise<CopyOutcome> {
  try {
    const blob = await s.toPng(svgText, scale)
    await s.writePng(blob)
    return 'png'
  } catch {
    try {
      await s.writeText(svgText)
      return 'svg'
    } catch {
      return 'failed'
    }
  }
}

/** Real browser implementations; exercised via the dev harness, not unit tests. */
export const browserStrategies: CopyStrategies = {
  async toPng(svgText, scale) {
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    try {
      const img = await loadImage(url)
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        throw new Error('SVG has no intrinsic dimensions')
      }
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth * scale
      canvas.height = img.naturalHeight * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  },
  async writePng(blob) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  },
  async writeText(text) {
    await navigator.clipboard.writeText(text)
  },
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = url
  })
}
