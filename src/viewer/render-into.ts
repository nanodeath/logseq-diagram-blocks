import { themeBackground, type ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { buildErrorCard } from './error-card'
import { buildToolbar } from './toolbar'
import { browserStrategies, copyDiagram, makeBrowserStrategies, type CopyOutcome, type WindowGlobals } from './copy-png'
import { openOverlay } from './overlay'

export interface ViewerContext {
  renderer: DiagramRenderer
  themeStore: ThemeStore
  pngScale: number
  onEdit?: () => void
  /** Called after a copy attempt completes; used by the adapter to show a toast. */
  onCopyDone?: (outcome: CopyOutcome) => void
}

/** Render a diagram into `container`; returns a dispose function. */
export function renderInto(container: HTMLElement, code: string, ctx: ViewerContext): () => void {
  let disposed = false
  let generation = 0

  // Derive realm objects from the mounted container so overlay and clipboard
  // operations target the host page, not the plugin's hidden sandbox iframe.
  const hostDoc = container.ownerDocument
  // defaultView is null only for detached / non-browsing-context documents;
  // fall back to module-scope browserStrategies (dev harness, unit tests).
  const copyStrategies =
    hostDoc.defaultView != null
      ? makeBrowserStrategies(hostDoc.defaultView as unknown as WindowGlobals)
      : browserStrategies

  async function draw(): Promise<void> {
    const gen = ++generation
    const result = await ctx.renderer.render(code, { theme: ctx.themeStore.theme })
    if (disposed || gen !== generation) return // stale render lost the race
    container.replaceChildren()

    if (!result.ok) {
      container.append(buildErrorCard(result.error, ctx.onEdit))
      return
    }

    const bg = themeBackground(ctx.themeStore.theme, ctx.themeStore.mode)

    const figure = document.createElement('div')
    figure.className = 'diagram-blocks-figure'
    figure.innerHTML = result.svg
    const svgEl = figure.querySelector<HTMLElement>('svg')
    if (svgEl) {
      if (bg) {
        svgEl.style.background = bg
        svgEl.style.borderRadius = '6px'
        svgEl.style.padding = '8px'
      } else {
        svgEl.style.background = ''
        svgEl.style.borderRadius = ''
        svgEl.style.padding = ''
      }
    }
    const toolbar = buildToolbar({
      onFullscreen: () => openOverlay(result.svg, hostDoc, bg),
      onCopy: () => void copyDiagram(result.svg, ctx.pngScale, copyStrategies).then(ctx.onCopyDone),
      onEdit: ctx.onEdit,
    })
    figure.append(toolbar)
    container.append(figure)
  }

  const unsubscribe = ctx.themeStore.subscribe(() => void draw())
  void draw()

  return () => {
    disposed = true
    unsubscribe()
    container.replaceChildren()
  }
}
