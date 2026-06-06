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
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })
  document.addEventListener('keydown', onKey)
  return close
}
