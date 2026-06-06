import viewerCss from '../viewer/viewer.css?raw'

export function provideStyles(): void {
  // Viewer DOM lives in the host page, so styles must be provided there too.
  logseq.provideStyle(viewerCss)
}
