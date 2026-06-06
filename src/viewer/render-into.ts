import type { ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { buildErrorCard } from './error-card'
import { buildToolbar } from './toolbar'
import { copyDiagram } from './copy-png'
import { openOverlay } from './overlay'

export interface ViewerContext {
  renderer: DiagramRenderer
  themeStore: ThemeStore
  pngScale: number
  onEdit?: () => void
}

/** Render a diagram into `container`; returns a dispose function. */
export function renderInto(container: HTMLElement, code: string, ctx: ViewerContext): () => void {
  let disposed = false
  let generation = 0

  async function draw(): Promise<void> {
    const gen = ++generation
    const result = await ctx.renderer.render(code, { theme: ctx.themeStore.theme })
    if (disposed || gen !== generation) return // stale render lost the race
    container.replaceChildren()

    if (!result.ok) {
      container.append(buildErrorCard(result.error, ctx.onEdit))
      return
    }

    const figure = document.createElement('div')
    figure.className = 'diagram-blocks-figure'
    figure.innerHTML = result.svg
    const toolbar = buildToolbar({
      onFullscreen: () => openOverlay(result.svg),
      onCopy: () => void copyDiagram(result.svg, ctx.pngScale),
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
