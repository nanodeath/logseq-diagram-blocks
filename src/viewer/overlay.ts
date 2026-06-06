import panzoom from 'panzoom'

/** Opens a fullscreen overlay containing the svg; returns a close function.
 *  Pass `doc` to target the host page's document rather than the module-scope
 *  iframe document (the Logseq plugin sandbox lives in a hidden iframe).
 */
export function openOverlay(svgText: string, doc: Document = document): () => void {
  const backdrop = doc.createElement('div')
  backdrop.className = 'diagram-blocks-overlay'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')

  const stage = doc.createElement('div')
  stage.className = 'diagram-blocks-overlay-stage'
  stage.innerHTML = svgText
  const svg = stage.querySelector('svg')
  if (svg) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.maxWidth = 'none'
  }

  const closeBtn = doc.createElement('button')
  closeBtn.className = 'diagram-blocks-overlay-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  backdrop.append(stage, closeBtn)
  doc.body.append(backdrop)
  closeBtn.focus()

  const pz = panzoom(stage, { maxZoom: 10, minZoom: 0.1 })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    pz.dispose()
    backdrop.remove()
    doc.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  closeBtn.addEventListener('click', close)
  // The stage fills the backdrop, so a bare target===backdrop check never fires;
  // close on a true click (not a pan release) on empty space (stage/backdrop).
  let downX = 0
  let downY = 0
  backdrop.addEventListener('pointerdown', (e) => {
    downX = e.clientX
    downY = e.clientY
  })
  backdrop.addEventListener('click', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 5
    if (!moved && (e.target === backdrop || e.target === stage)) close()
  })
  doc.addEventListener('keydown', onKey)
  return close
}
