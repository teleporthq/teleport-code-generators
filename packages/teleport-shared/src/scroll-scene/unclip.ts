/**
 * Keep a pinned scene's stage pinnable: an ancestor with `overflow: hidden`
 * (either axis) turns position:sticky off, silently. Authors and the AI write
 * it for good reasons (a horizontal rail must clip its overhang — run
 * e7f332df wrote `section.rail-scene { overflow: hidden }` around the
 * homepage's story and the stage scrolled straight through). `overflow: clip`
 * keeps the clipping and, unlike hidden, does not make the element a scroll
 * container, so the stage sticks again. Ancestors that really scroll (auto /
 * scroll) are left alone: sticky then rightly binds to that container.
 *
 * Injected into the generated widget via toString — no imports, no template
 * literals (the generated project transpiles it).
 */
export function unclipStickyAncestors(
  track: Element,
  getStyle: (element: Element) => CSSStyleDeclaration
): string[] {
  const unclipped: string[] = []
  let element = track.parentElement
  while (element && element !== element.ownerDocument.documentElement) {
    const style = getStyle(element)
    const both = style.overflow === 'hidden'
    const axes: string[] = []
    if (both || style.overflowX === 'hidden') {
      axes.push('x')
    }
    if (both || style.overflowY === 'hidden') {
      axes.push('y')
    }
    if (axes.length > 0) {
      const host = element as HTMLElement
      for (let i = 0; i < axes.length; i++) {
        host.style.setProperty('overflow-' + axes[i], 'clip')
      }
      host.setAttribute('data-scene-unclipped', axes.join(''))
      unclipped.push(
        host.tagName.toLowerCase() +
          (host.className ? '.' + String(host.className).split(' ')[0] : '')
      )
    }
    element = element.parentElement
  }
  return unclipped
}
