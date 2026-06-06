import { describe, expect, it } from 'vitest'
import { fontAwesomePacks } from './icon-packs'

describe('fontAwesomePacks', () => {
  it('covers the prefixes mermaid recognizes in fa shorthand', () => {
    // mermaid's replaceIconSubstring matches /(fa[bklrs]?):fa-(...)/ and looks up
    // `${prefix}:${name}` in registered packs. fak (kit) and fal (light) are
    // FA-Pro-only, so they intentionally stay unregistered and fall back.
    expect(fontAwesomePacks.map((p) => p.name).sort()).toEqual(['fa', 'fab', 'far', 'fas'])
  })

  it('fa and fas resolve to FA6 solid icons (ban, camera-retro)', async () => {
    for (const name of ['fa', 'fas']) {
      const pack = fontAwesomePacks.find((p) => p.name === name)!
      const icons = await pack.loader()
      expect(icons.prefix).toBe('fa6-solid')
      expect(icons.icons).toHaveProperty('ban')
      expect(icons.icons).toHaveProperty('camera-retro')
    }
  })

  it('far resolves to FA6 regular icons', async () => {
    const pack = fontAwesomePacks.find((p) => p.name === 'far')!
    const icons = await pack.loader()
    expect(icons.prefix).toBe('fa6-regular')
    expect(icons.icons).toHaveProperty('bell')
  })

  it('fab resolves to FA6 brand icons (github, twitter)', async () => {
    const pack = fontAwesomePacks.find((p) => p.name === 'fab')!
    const icons = await pack.loader()
    expect(icons.prefix).toBe('fa6-brands')
    expect(icons.icons).toHaveProperty('github')
    expect(icons.icons).toHaveProperty('twitter')
  })
})
