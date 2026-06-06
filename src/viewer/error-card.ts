export function buildErrorCard(
  error: { message: string },
  onEdit: (() => void) | undefined,
): HTMLElement {
  const card = document.createElement('div')
  card.className = 'diagram-blocks-error'

  const title = document.createElement('strong')
  title.textContent = 'Diagram error'
  const msg = document.createElement('pre')
  msg.textContent = error.message
  card.append(title, msg)

  if (onEdit) {
    const btn = document.createElement('button')
    btn.dataset.action = 'edit'
    btn.textContent = '✏️ Edit block'
    btn.addEventListener('click', onEdit)
    card.append(btn)
  }
  return card
}
