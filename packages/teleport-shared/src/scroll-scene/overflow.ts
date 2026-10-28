/**
 * How far an element reaches past the far edge of its scene's stage — the
 * right edge for x, the bottom for y — in layout pixels at rest. It is the
 * distance an "overflow" lane travels at 100: a sideways row of cards whose x
 * lane runs 0 → -100 slides exactly until its last card meets the stage edge,
 * whatever the number of cards or the width of the screen. A fixed px or %
 * distance only ever fits one of those (production run 167d643c, 2026-10-25:
 * the assistant could not land a product row on its last card with a lane and
 * hand-wrote a scroll script the editor could neither show nor edit).
 *
 * Layout offsets (offsetLeft / offsetTop up the offsetParent chain) ignore
 * transforms, so the lane's own translate, a chapter's entrance drift and the
 * editor's canvas zoom never feed back into the distance. Without a stage
 * around it (a lone preview) the element's parent is the box it overflows.
 *
 * Shipped as text inside the generated scene engine (scripts/function-sources.js):
 * no imports, no template literals. The editor's lane contract mirrors it.
 */
export function laneOverflowDistance(element: HTMLElement, axis: string): number {
  const horizontal = axis === 'x'
  const box = (element.closest('[data-scene-stage]') as HTMLElement | null) || element.parentElement
  if (!box || box === element) {
    return 0
  }
  const layoutStart = (node: HTMLElement | null): number => {
    let offset = 0
    while (node) {
      offset += horizontal ? node.offsetLeft : node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }
    return offset
  }
  const reach = layoutStart(element) + (horizontal ? element.offsetWidth : element.offsetHeight)
  const edge =
    layoutStart(box) +
    (horizontal ? box.clientLeft + box.clientWidth : box.clientTop + box.clientHeight)
  return Math.max(0, reach - edge)
}
