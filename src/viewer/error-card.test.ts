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
})
