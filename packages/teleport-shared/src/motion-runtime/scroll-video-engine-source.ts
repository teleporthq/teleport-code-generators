/**
 * The scroll-video maths as SOURCE TEXT: the clip window and the progress a
 * rectangle has made through the viewport. Shared word for word by the Next
 * export (TqScrollVideo) and the HTML export's vanilla controller; mirrors the
 * canvas renderer's scroll-video-runtime.
 */
export const scrollVideoEngineSource =
  (): string => `const clamp01 = (value) => Math.min(1, Math.max(0, value))

const MIN_WINDOW_SPAN = 1

const normalizeWindow = (startRaw, endRaw) => {
  const parse = (value, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback
  }
  const start = parse(startRaw, 0)
  const end = parse(endRaw, 100)
  if (end - start >= MIN_WINDOW_SPAN) {
    return { start, end }
  }
  return start <= 100 - MIN_WINDOW_SPAN
    ? { start, end: start + MIN_WINDOW_SPAN }
    : { start: 100 - MIN_WINDOW_SPAN, end: 100 }
}

// Mirrors the canvas renderer's scrollProgressForOffset for the two modes a
// scrub video needs: 'contained' (a pinned scene's stage holds while its track
// scrolls under it) and 'pass' (a plain trip through the viewport).
const progressForRect = (rect, viewportHeight, offset) => {
  const vh = viewportHeight || 1
  let raw
  if (offset === 'contained') {
    const travel = rect.height - vh
    raw = travel > 0 ? -rect.top / travel : (vh - rect.top) / (vh + rect.height)
  } else {
    raw = (vh - rect.top) / (vh + rect.height)
  }
  return clamp01(raw)
}`
