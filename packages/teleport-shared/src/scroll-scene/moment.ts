/**
 * The progress where a chapter is fully ON STAGE — every lane has arrived
 * and none has started leaving — the centre of that settled span, in the
 * lanes' own (absolute) progress space. The gentle snap and anchor
 * navigation aim here instead of the window's midpoint, which catches the
 * last beat still rising (a half-visible line, a half-arrived card).
 * Null when nothing settles (a chapter made only of through-motion, e.g. a
 * crossing line — its best moment is the window's middle, the caller's
 * fallback).
 *
 * MIRRORED VERBATIM from teleport-gui's chapter-window.ts (the editor draws
 * the same moment on the timeline). Plain JS inside: this function's SOURCE
 * is injected into the generated TqScrollScene runtime via toString(), so no
 * TypeScript-only runtime constructs and no template literals.
 */
export interface MomentLane {
  at: number[]
  values: number[]
}

export function settledMomentForLanes(lanes: MomentLane[]): number | null {
  let arrive = -Infinity
  let leave = Infinity
  let lastStop = -Infinity
  let found = false
  for (const lane of lanes) {
    if (lane.at.length < 3) {
      continue
    }
    let settledAt: number | null = null
    for (let index = 1; index < lane.values.length - 1; index++) {
      if (lane.values[index] === lane.values[index + 1] && lane.values[index] !== lane.values[0]) {
        settledAt = index
        break
      }
    }
    if (settledAt === null && lane.values[0] === lane.values[1]) {
      settledAt = 0
    }
    if (settledAt === null) {
      continue
    }
    found = true
    arrive = Math.max(arrive, lane.at[settledAt])
    lastStop = Math.max(lastStop, lane.at[lane.at.length - 1])
    const settledValue = lane.values[settledAt]
    for (let index = settledAt + 1; index < lane.values.length; index++) {
      if (lane.values[index] !== settledValue) {
        leave = Math.min(leave, lane.at[index - 1])
        break
      }
    }
  }
  if (!found) {
    return null
  }
  if (leave === Infinity) {
    leave = lastStop
  }
  if (leave < arrive) {
    return null
  }
  return Math.round(((arrive + leave) / 2) * 10000) / 10000
}
