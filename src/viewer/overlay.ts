/** Pan/zoom state: scale factor plus translate offsets in pixels. */
export interface PanZoomState {
  scale: number
  tx: number
  ty: number
}

/**
 * Compute a fit-to-viewport initial transform for a diagram.
 *
 * Scale = Math.min(viewW*0.9/naturalW, viewH*0.9/naturalH, 2) so the diagram
 * occupies at most 90% of the viewport in each dimension and is never upscaled
 * beyond 2×. tx/ty center the scaled content.
 */
export function computeFit(
  naturalW: number,
  naturalH: number,
  viewW: number,
  viewH: number,
): PanZoomState {
  const scale = Math.min((viewW * 0.9) / naturalW, (viewH * 0.9) / naturalH, 2)
  const tx = (viewW - naturalW * scale) / 2
  const ty = (viewH - naturalH * scale) / 2
  return { scale, tx, ty }
}

/**
 * Zoom toward a cursor point (cx, cy) in viewport coordinates.
 *
 * The content point under the cursor remains fixed after the zoom.
 * Result scale is clamped to [minScale, maxScale].
 */
export function zoomAt(
  state: PanZoomState,
  cx: number,
  cy: number,
  factor: number,
  minScale = 0.1,
  maxScale = 10,
): PanZoomState {
  const newScale = Math.min(Math.max(state.scale * factor, minScale), maxScale)
  const ratio = newScale / state.scale
  const tx = cx - (cx - state.tx) * ratio
  const ty = cy - (cy - state.ty) * ratio
  return { scale: newScale, tx, ty }
}

/** Apply a PanZoomState to a DOM element via CSS transform. */
function applyTransform(el: HTMLElement, state: PanZoomState): void {
  el.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
}

/**
 * Opens a fullscreen overlay containing the SVG with pointer-capture pan/zoom.
 * Returns a close function.
 *
 * Pass `doc` to target the host page's document rather than the module-scope
 * iframe document (the Logseq plugin sandbox lives in a hidden iframe).
 *
 * All pointer/wheel listeners are attached to elements within `doc`, so they
 * work correctly regardless of which realm the module was loaded in.
 */
export function openOverlay(svgText: string, doc: Document = document, background?: string): () => void {
  // ── Backdrop ──────────────────────────────────────────────────────────────
  const backdrop = doc.createElement('div')
  backdrop.className = 'diagram-blocks-overlay'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.style.cursor = 'grab'

  // ── Stage (moveable container for the SVG) ────────────────────────────────
  const stage = doc.createElement('div')
  stage.className = 'diagram-blocks-overlay-stage'
  stage.innerHTML = svgText

  // ── Natural size detection ────────────────────────────────────────────────
  // Priority: viewBox.baseVal (nonzero) → width/height attributes → 800×600
  const svg = stage.querySelector('svg')
  let naturalW = 800
  let naturalH = 600

  if (svg) {
    // viewBox.baseVal may be undefined in jsdom and in some real SVGs
    const vb = svg.viewBox?.baseVal
    if (vb && vb.width > 0 && vb.height > 0) {
      naturalW = vb.width
      naturalH = vb.height
    } else {
      const attrW = parseFloat(svg.getAttribute('width') ?? '')
      const attrH = parseFloat(svg.getAttribute('height') ?? '')
      if (!isNaN(attrW) && attrW > 0) naturalW = attrW
      if (!isNaN(attrH) && attrH > 0) naturalH = attrH
    }

    // Set svg to its natural pixel size so it renders at 1:1 inside the stage.
    svg.setAttribute('width', String(naturalW))
    svg.setAttribute('height', String(naturalH))
    svg.style.maxWidth = 'none'

    if (background) {
      svg.style.background = background
      svg.style.borderRadius = '6px'
      svg.style.padding = '8px'
    }
  }

  // ── Viewport size ─────────────────────────────────────────────────────────
  const win = doc.defaultView
  const viewW = win?.innerWidth ?? doc.documentElement?.clientWidth ?? 800
  const viewH = win?.innerHeight ?? doc.documentElement?.clientHeight ?? 600

  // ── Initial transform ─────────────────────────────────────────────────────
  let state = computeFit(naturalW, naturalH, viewW, viewH)
  applyTransform(stage, state)

  // ── Close button ──────────────────────────────────────────────────────────
  const closeBtn = doc.createElement('button')
  closeBtn.className = 'diagram-blocks-overlay-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  backdrop.append(stage, closeBtn)
  doc.body.append(backdrop)
  closeBtn.focus()

  // ── Close logic ───────────────────────────────────────────────────────────
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    backdrop.remove()
    doc.removeEventListener('keydown', onKey)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  closeBtn.addEventListener('click', close)
  doc.addEventListener('keydown', onKey)

  // ── Pan (pointer capture on backdrop) ────────────────────────────────────
  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panStartTx = 0
  let panStartTy = 0
  // Track pointer-down position for click-to-close distance guard
  let downX = 0
  let downY = 0

  backdrop.addEventListener('pointerdown', (e: PointerEvent) => {
    // Don't pan when clicking the close button
    if (e.target === closeBtn) return

    // Suppress native drag behaviors (text selection across SVG labels)
    e.preventDefault()

    downX = e.clientX
    downY = e.clientY
    isPanning = true
    panStartX = e.clientX
    panStartY = e.clientY
    panStartTx = state.tx
    panStartTy = state.ty

    backdrop.style.cursor = 'grabbing'

    // Pointer capture keeps pointermove/pointerup firing on this element even
    // when the pointer leaves. Guard for jsdom which lacks setPointerCapture.
    if (typeof backdrop.setPointerCapture === 'function') {
      try {
        backdrop.setPointerCapture(e.pointerId)
      } catch {
        // setPointerCapture may throw in non-interactive environments; safe to ignore
      }
    }
  })

  backdrop.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isPanning) return
    state = {
      scale: state.scale,
      tx: panStartTx + (e.clientX - panStartX),
      ty: panStartTy + (e.clientY - panStartY),
    }
    applyTransform(stage, state)
  })

  const stopPan = () => {
    isPanning = false
    backdrop.style.cursor = 'grab'
  }
  backdrop.addEventListener('pointerup', stopPan)
  backdrop.addEventListener('pointercancel', stopPan)

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  backdrop.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.002)
      state = zoomAt(state, e.clientX, e.clientY, factor)
      applyTransform(stage, state)
    },
    { passive: false },
  )

  // ── Click-to-close (backdrop only, not diagram) ───────────────────────────
  backdrop.addEventListener('click', (e: MouseEvent) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 5
    // Only close when clicking backdrop empty space, not the diagram/stage
    if (!moved && e.target === backdrop) close()
  })

  return close
}
