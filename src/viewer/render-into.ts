import { themeBackground, type ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { buildErrorCard } from './error-card'
import { buildToolbar } from './toolbar'
import { browserStrategies, copyDiagram, makeBrowserStrategies, type CopyOutcome, type WindowGlobals } from './copy-png'
import { openOverlay } from './overlay'

export interface ViewerContext {
  renderer: DiagramRenderer
  themeStore: ThemeStore
  /** Returns the current scale multiplier at copy time so settings changes apply to the next copy. */
  getPngScale: () => number
  onEdit?: () => void
  /** Called after a copy attempt completes; used by the adapter to show a toast. */
  onCopyDone?: (outcome: CopyOutcome) => void
}

/** A red exclamation badge overlaid on a last-good diagram when a re-render fails. */
function buildErrorBadge(error: { message: string }, doc: Document): HTMLElement {
  const badge = doc.createElement('div')
  badge.className = 'diagram-blocks-error-badge'
  badge.textContent = '!'
  badge.title = error.message
  badge.setAttribute('aria-label', `Diagram error: ${error.message}`)
  return badge
}

/** A spinner overlaid on a last-good diagram while a slow re-render is in flight. */
function buildLoadingOverlay(doc: Document): HTMLElement {
  const overlay = doc.createElement('div')
  overlay.className = 'diagram-blocks-loading'
  overlay.setAttribute('aria-label', 'Rendering diagram…')
  return overlay
}

/** Render a diagram into `container`; returns a dispose function. */
export function renderInto(container: HTMLElement, code: string, ctx: ViewerContext): () => void {
  let disposed = false
  let generation = 0
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined

  // Derive realm objects from the mounted container so overlay and clipboard
  // operations target the host page, not the plugin's hidden sandbox iframe.
  const hostDoc = container.ownerDocument
  // defaultView is null only for detached / non-browsing-context documents;
  // fall back to module-scope browserStrategies (dev harness, unit tests).
  const copyStrategies =
    hostDoc.defaultView != null
      ? makeBrowserStrategies(hostDoc.defaultView as unknown as WindowGlobals)
      : browserStrategies

  /** Remove any transient spinner / error badge from the current figure. */
  function clearTransientOverlays(): void {
    const figure = container.querySelector('.diagram-blocks-figure')
    if (!figure) return
    figure.querySelectorAll('.diagram-blocks-loading, .diagram-blocks-error-badge').forEach((node) => node.remove())
  }

  async function draw(): Promise<void> {
    const gen = ++generation
    clearTimeout(spinnerTimer)
    clearTransientOverlays()

    // Keep the last-good diagram visible while rendering. If the render is slow
    // (>500ms), overlay a spinner on the existing figure. With no figure there's
    // nothing to overlay, so skip it (initial render shows nothing briefly).
    spinnerTimer = setTimeout(() => {
      const figure = container.querySelector('.diagram-blocks-figure')
      if (figure) figure.append(buildLoadingOverlay(hostDoc))
    }, 500)

    const result = await ctx.renderer.render(code, { theme: ctx.themeStore.theme })
    clearTimeout(spinnerTimer)
    if (disposed || gen !== generation) return // stale render lost the race
    clearTransientOverlays()

    if (!result.ok) {
      // Prefer keeping the last-good diagram and flagging the error with a badge.
      // Only fall back to the full error card when there's nothing to preserve.
      const figure = container.querySelector('.diagram-blocks-figure')
      if (figure) {
        figure.append(buildErrorBadge(result.error, hostDoc))
        return
      }
      container.replaceChildren()
      container.append(buildErrorCard(result.error, ctx.onEdit, hostDoc))
      return
    }

    const bg = themeBackground(ctx.themeStore.theme, ctx.themeStore.mode)

    const figure = hostDoc.createElement('div')
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
      onCopy: () => void copyDiagram(result.svg, ctx.getPngScale(), copyStrategies).then(ctx.onCopyDone),
      onEdit: ctx.onEdit,
      doc: hostDoc,
    })
    figure.append(toolbar)
    container.replaceChildren()
    container.append(figure)
  }

  const unsubscribe = ctx.themeStore.subscribe(() => void draw())
  void draw()

  return () => {
    disposed = true
    unsubscribe()
    clearTimeout(spinnerTimer)
    // Intentionally do NOT clear the container. While editing, React disposes the
    // old renderInto and mounts a new one on the same node for each keystroke; the
    // next renderInto inherits the last-good diagram and renders over it, so no
    // flash. On an actual unmount React removes the host node itself, so leaving
    // children here leaks nothing.
  }
}
