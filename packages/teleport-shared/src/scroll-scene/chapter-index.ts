/**
 * Which chapter is ON STAGE at a scene progress: the chapter whose moment is
 * the latest one the visitor has passed (a later chapter wins a tie), -1 before
 * any moment is reached. Moments are read in document order but need not be
 * monotone — an author's "Snap here" can put an early chapter's moment late.
 * The published TqScrollScene announces every change of this index as a
 * `tq-chapter-reached` DOM event on the chapter element — the hook the
 * "A Chapter Is Reached" workflow trigger listens for.
 *
 * Plain JS inside: this function's SOURCE is injected into the generated
 * runtime via toString(), so no TypeScript-only runtime constructs and no
 * template literals.
 */
export function activeChapterIndex(moments: number[], progress: number): number {
  let active = -1
  let best = -Infinity
  for (let index = 0; index < moments.length; index++) {
    const moment = moments[index]
    if (moment <= progress + 0.000001 && moment >= best) {
      best = moment
      active = index
    }
  }
  return active
}
