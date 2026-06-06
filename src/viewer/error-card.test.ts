import { describe, expect, it, vi } from 'vitest'
import { buildErrorCard } from './error-card'

describe('buildErrorCard', () => {
  it('shows the message and wires the edit button', () => {
    const onEdit = vi.fn()
    const el = buildErrorCard({ message: 'Parse error on line 2' }, onEdit)
    expect(el.textContent).toContain('Parse error on line 2')
    el.querySelector<HTMLButtonElement>('button[data-action="edit"]')!.click()
    expect(onEdit).toHaveBeenCalled()
  })

  it('omits the edit button when no handler provided', () => {
    const el = buildErrorCard({ message: 'boom' }, undefined)
    expect(el.querySelector('button[data-action="edit"]')).toBeNull()
  })

  it('does not inject the message as HTML', () => {
    const el = buildErrorCard({ message: '<img src=x onerror=alert(1)>' }, undefined)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
