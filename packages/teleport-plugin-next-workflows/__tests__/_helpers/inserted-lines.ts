/**
 * How `after` differs from `before`, line by line, when it may only ADD:
 * `kept` is false when a line of `before` was removed or changed (it is not a
 * subsequence of `after`), and `inserted` holds the lines `after` added.
 */
export const insertedLines = (
  before: string,
  after: string
): { kept: boolean; inserted: string[] } => {
  const original = before.split('\n')
  const changed = after.split('\n')
  const inserted: string[] = []
  let next = 0
  for (const line of changed) {
    if (next < original.length && line === original[next]) {
      next++
    } else {
      inserted.push(line)
    }
  }
  return { kept: next === original.length, inserted }
}
