/** Iconify JSON shape we rely on (subset of IconifyJSON). */
export interface IconPackData {
  prefix: string
  icons: Record<string, unknown>
}

/** Matches mermaid's registerIconPacks() lazy-loader form. */
export interface IconPack {
  name: string
  loader: () => Promise<IconPackData>
}

const solid = () => import('@iconify-json/fa6-solid').then((m) => m.icons)
const regular = () => import('@iconify-json/fa6-regular').then((m) => m.icons)
const brands = () => import('@iconify-json/fa6-brands').then((m) => m.icons)

/**
 * Icon packs backing mermaid's `fa:fa-name` label shorthand. mermaid looks up
 * `${prefix}:${name}` among registered packs and inlines the icon as SVG;
 * unregistered prefixes (fak/fal — FA Pro) and unknown names fall back to
 * mermaid's `<i class>` output, i.e. today's behavior. Loaders are lazy, so
 * the icon JSON is only fetched when a diagram actually uses icons.
 */
export const fontAwesomePacks: IconPack[] = [
  { name: 'fa', loader: solid },
  { name: 'fas', loader: solid },
  { name: 'far', loader: regular },
  { name: 'fab', loader: brands },
]
