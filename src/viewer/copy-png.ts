export type CopyOutcome = 'png' | 'svg' | 'failed'

/** mermaid emits `width="100%"`, no height, and a viewBox. Loaded as an
 *  <img>, that resolves to the default ~300×150 intrinsic size and the PNG
 *  raster comes out cropped/letterboxed (issue #2). Pin explicit width/height
 *  from the viewBox so the raster matches the diagram. DOMParser builds a
 *  detached document — no layout, no realm sensitivity.
 */
export function withExplicitDimensions(svgText: string): string {
  const root = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement
  if (root.tagName !== 'svg') return svgText // parse failure → let the image loader report it
  const viewBox = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if (!viewBox || viewBox.length !== 4 || viewBox.some(Number.isNaN)) return svgText
  const [, , width, height] = viewBox
  for (const [attr, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    const current = root.getAttribute(attr)
    if (!current || current.includes('%')) root.setAttribute(attr, String(value))
  }
  return new XMLSerializer().serializeToString(root)
}

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
      // data: URL, NOT a blob: URL — Chromium taints the canvas when an SVG
      // image containing <foreignObject> (mermaid htmlLabels output) is drawn
      // from a blob: URL, killing toBlob with a SecurityError. The identical
      // SVG from a data: URL rasterizes cleanly (probed both in issue #2).
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(withExplicitDimensions(svgText))
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
