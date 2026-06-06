import { MermaidRenderer, type MermaidApi } from '../src/core/mermaid/renderer'
import { ThemeStore } from '../src/core/theme'
import { renderInto } from '../src/viewer/render-into'
import { fixtures } from './fixtures'

// Harness loads mermaid as a normal ESM dep — no Logseq host involved.
const loader = async (): Promise<MermaidApi> => (await import('mermaid')).default as unknown as MermaidApi

const renderer = new MermaidRenderer(loader)
const store = new ThemeStore('auto', 'light')

document.getElementById('theme-toggle')!.addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark')
  store.setMode(dark ? 'dark' : 'light')
})

const gallery = document.getElementById('gallery')!
for (const [name, code] of Object.entries(fixtures)) {
  const section = document.createElement('section')
  section.className = 'fixture'
  const h = document.createElement('h3')
  h.textContent = name
  const target = document.createElement('div')
  section.append(h, target)
  gallery.append(section)
  renderInto(target, code, { renderer, themeStore: store, getPngScale: () => 2 })
}
