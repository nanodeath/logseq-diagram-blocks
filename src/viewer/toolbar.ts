export interface ToolbarActions {
  onFullscreen(): void
  onCopy(): void
  /** absent when the host can't give us a block uuid (per spike findings) */
  onEdit?: () => void
}

export function buildToolbar(actions: ToolbarActions): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'diagram-blocks-toolbar'

  bar.append(button('fullscreen', '⛶', 'Fullscreen', actions.onFullscreen))
  bar.append(button('copy', '⧉', 'Copy as PNG', actions.onCopy))
  if (actions.onEdit) bar.append(button('edit', '✏️', 'Edit block', actions.onEdit))
  return bar
}

function button(action: string, glyph: string, label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button')
  b.dataset.action = action
  b.textContent = glyph
  b.title = label
  b.setAttribute('aria-label', label)
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}
