export function buildErrorCard(
  error: { message: string },
  onEdit: (() => void) | undefined,
  doc: Document = document,
): HTMLElement {
  const card = doc.createElement('div')
  card.className = 'diagram-blocks-error'

  const title = doc.createElement('strong')
  title.textContent = 'Diagram error'
  const msg = doc.createElement('pre')
  msg.textContent = error.message
  card.append(title, msg)

  if (onEdit) {
    const btn = doc.createElement('button')
    btn.dataset.action = 'edit'
    btn.textContent = '✏️ Edit block'
    btn.addEventListener('click', onEdit)
    card.append(btn)
  }
  return card
}
