import '@logseq/libs'
import type { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { ThemeStore } from './core/theme'
import type { LogseqMode, ThemeSetting } from './core/types'
import { makeBlockComponent } from './adapter/block-component'
import { provideStyles } from './adapter/styles'

const settingsSchema: SettingSchemaDesc[] = [
  {
    key: 'theme',
    type: 'enum',
    title: 'Diagram theme',
    description: "'auto' follows Logseq's light/dark mode",
    enumChoices: ['auto', 'default', 'dark', 'forest', 'neutral', 'base'],
    enumPicker: 'select',
    default: 'auto',
  },
  {
    key: 'pngScale',
    type: 'number',
    title: 'PNG export scale',
    description: 'Resolution multiplier for copy-as-PNG',
    default: 2,
  },
]

async function main() {
  const configs = await logseq.App.getUserConfigs()
  const themeStore = new ThemeStore(
    (logseq.settings?.theme as ThemeSetting) ?? 'auto',
    (configs.preferredThemeMode as LogseqMode) ?? 'light',
  )

  logseq.App.onThemeModeChanged(({ mode }) => themeStore.setMode(mode as LogseqMode))
  logseq.onSettingsChanged((settings) => {
    themeStore.setSetting((settings?.theme as ThemeSetting) ?? 'auto')
  })

  provideStyles()

  logseq.Experiments.registerFencedCodeRenderer('mermaid', {
    edit: false,
    render: makeBlockComponent(themeStore, () => Number(logseq.settings?.pngScale ?? 2)),
  })
}

logseq.useSettingsSchema(settingsSchema).ready(main).catch(console.error)
