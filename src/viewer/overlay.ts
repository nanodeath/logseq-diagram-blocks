import panzoom from 'panzoom'

/** Opens a fullscreen overlay containing the svg; returns a close function. */
export function openOverlay(svgText: string): () => void {
  const backdrop = document.createElement('div')
  backdrop.className = 'diagram-blocks-overlay'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')

  const stage = document.createElement('div')
  stage.className = 'diagram-blocks-overlay-stage'
  stage.innerHTML = svgText
  const svg = stage.querySelector('svg')
  if (svg) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.maxWidth = 'none'
  }

  const closeBtn = document.createElement('button')
  closeBtn.className = 'diagram-blocks-overlay-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  backdrop.append(stage, closeBtn)
  document.body.append(backdrop)
  closeBtn.focus()

  const pz = panzoom(stage, { maxZoom: 10, minZoom: 0.1 })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    pz.dispose()
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
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
  document.addEventListener('keydown', onKey)
  return close
}
