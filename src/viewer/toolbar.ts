export interface ToolbarActions {
  onFullscreen(): void
  onCopy(): void
  /**
   * Product decision (commit 4ef5f61): Logseq's native fenced-code controls
   * cover editing, so the Edit button stays hidden in the adapter. The hook is
   * kept as a generic viewer API for the dev harness and future adapters.
   */
  onEdit?: () => void
  /** Document to use for element creation; defaults to the global document. */
  doc?: Document
}

export function buildToolbar(actions: ToolbarActions): HTMLElement {
  const doc = actions.doc ?? document
  const bar = doc.createElement('div')
  bar.className = 'diagram-blocks-toolbar'

  bar.append(button('fullscreen', '⛶', 'Fullscreen', actions.onFullscreen, doc))
  bar.append(button('copy', '⧉', 'Copy as PNG', actions.onCopy, doc))
  if (actions.onEdit) bar.append(button('edit', '✏️', 'Edit block', actions.onEdit, doc))
  return bar
}

function button(action: string, glyph: string, label: string, onClick: () => void, doc: Document): HTMLElement {
  const b = doc.createElement('button')
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
