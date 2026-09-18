/**
 * The "scrolled past a point" contract of a published Scroll Scene: the four
 * plain points in scroll order, which of them a move from one progress to
 * another passes DOWNWARD, and the rank of a point for late listeners. The
 * scene announces every passed point as a `tq-scene-point-passed` DOM event
 * on its track (the element carrying the scene's id) and stamps the furthest
 * point passed so far as `data-scene-point`.
 *
 * Plain JS inside: these functions' SOURCE is injected into the generated
 * runtime via toString(), so no TypeScript-only runtime constructs, no
 * template literals and no reference to anything outside the function. The
 * list mirrors SCROLL_POINT_PROGRESS in teleport-plugin-next-workflows
 * (pinned by a test).
 */
export function scenePointList(): Array<{ key: string; at: number }> {
  return [
    { key: 'quarter', at: 0.25 },
    { key: 'half', at: 0.5 },
    { key: 'three-quarters', at: 0.75 },
    { key: 'end', at: 1 },
  ]
}

/** Points passed going DOWN from one progress to another, in scroll order; none when going up. */
export function passedScenePoints(from: number, to: number): string[] {
  const passed = []
  const points = scenePointList()
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    if (point.at > from + 0.000001 && point.at <= to + 0.000001) {
      passed.push(point.key)
    }
  }
  return passed
}

/** 1-based rank of a point in scroll order, 0 for anything else. */
export function scenePointRank(key: string): number {
  const points = scenePointList()
  for (let index = 0; index < points.length; index++) {
    if (points[index].key === key) {
      return index + 1
    }
  }
  return 0
}
