// Aliased as 'react' in vite.config.ts. ONLY adapter code may import react.
// The fenced-code renderer component must be built with the HOST page's React.
// logseq.Experiments.React is typed as `unknown` — cast to a minimal surface.
interface ReactLike {
  useRef<T>(init: T | null): { current: T | null }
  useEffect(fn: () => void | (() => void), deps: unknown[]): void
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown
}

const React = logseq.Experiments.React as ReactLike
export default React
