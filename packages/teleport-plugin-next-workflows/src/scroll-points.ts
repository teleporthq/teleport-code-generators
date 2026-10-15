/**
 * The plain choices of the "scrolled past a point" triggers and the progress
 * (0..1) each stands for. The published Scroll Scene runtime carries the same
 * list (scenePointList in teleport-project-generator-next, pinned by a test);
 * the page trigger reads it here directly.
 */
export const SCROLL_POINT_PROGRESS: Readonly<Record<string, number>> = {
  quarter: 0.25,
  half: 0.5,
  'three-quarters': 0.75,
  end: 1,
}

export const DEFAULT_SCROLL_POINT = 'half'

export const resolveScrollPoint = (value: unknown): { key: string; at: number; rank: number } => {
  const keys = Object.keys(SCROLL_POINT_PROGRESS)
  const key =
    typeof value === 'string' && value in SCROLL_POINT_PROGRESS ? value : DEFAULT_SCROLL_POINT
  return { key, at: SCROLL_POINT_PROGRESS[key], rank: keys.indexOf(key) + 1 }
}
