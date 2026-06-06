export type CopyOutcome = 'png' | 'svg' | 'failed'

export interface CopyStrategies {
  toPng(svgText: string, scale: number): Promise<Blob>
  writePng(blob: Blob): Promise<void>
  writeText(text: string): Promise<void>
}

/** Structural type covering the globals makeBrowserStrategies needs from a window. */
export interface WindowGlobals {
  document: Document
  navigator: Navigator
  ClipboardItem: typeof ClipboardItem
  Image: typeof Image
  URL: typeof URL
}

/** Factory: build real browser strategies bound to a specific window realm.
 *  Pass the host page's window so clipboard/canvas calls run in the right realm,
 *  not in the plugin's hidden sandbox iframe.
 */
export function makeBrowserStrategies(win: WindowGlobals): CopyStrategies {
  return {
    async toPng(svgText, scale) {
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
      const url = win.URL.createObjectURL(svgBlob)
      try {
        const img = await loadImage(url, win.Image)
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          throw new Error('SVG has no intrinsic dimensions')
        }
        const canvas = win.document.createElement('canvas')
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
        win.URL.revokeObjectURL(url)
      }
    },
    async writePng(blob) {
      await win.navigator.clipboard.write([new win.ClipboardItem({ 'image/png': blob })])
    },
    async writeText(text) {
      await win.navigator.clipboard.writeText(text)
    },
  }
}

/** Snapshot module-scope globals at first call.
 *  Deferred so jsdom test environments (which lack ClipboardItem) can import
 *  this module without a ReferenceError at module-evaluation time.
 */
function moduleWindowGlobals(): WindowGlobals {
  return {
    document,
    navigator,
    // ClipboardItem is absent in jsdom; cast through unknown so tsc is happy.
    ClipboardItem: (globalThis as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem,
    Image,
    URL,
  }
}

/** Default strategies bound to the module-scope window; kept for backward
 *  compat with the dev harness (single-realm, no iframe separation).
 */
export const browserStrategies: CopyStrategies = {
  toPng: (...args) => makeBrowserStrategies(moduleWindowGlobals()).toPng(...args),
  writePng: (...args) => makeBrowserStrategies(moduleWindowGlobals()).writePng(...args),
  writeText: (...args) => makeBrowserStrategies(moduleWindowGlobals()).writeText(...args),
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
  } catch (e) {
    console.warn('[diagram-blocks] png copy path failed:', e)
    try {
      await s.writeText(svgText)
      return 'svg'
    } catch (e2) {
      console.warn('[diagram-blocks] svg text copy failed:', e2)
      return 'failed'
    }
  }
}

function loadImage(url: string, ImageCtor: typeof Image): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new ImageCtor()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = url
  })
}
