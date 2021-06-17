import { Change, diffLines } from 'diff'

export const getPatchesBetweenFiles = (local: string, remote: string) => diffLines(local, remote)

/* TODO
- Improvements for empty patches, like just adding empty lines as a `added` patch.
- Add pointers for code-generated in local, so it's easy to identify and remove them.
- If there are no merge-conflicts, we can run the formatter directly. For better output. */

export const mergeFiles = (patches: Change[]) =>
  patches
    .reduce((acc: string[], patch) => {
      if (patch.added) {
        acc.push('<<<<<< Changes from Studio')
        acc.push(patch.value.replace('\n', ' '))
        acc.push('=======')
        return acc
      }

      if (patch.removed) {
        acc.push(patch.value.replace('\n', ''))
        return acc
      }

      acc.push(patch.value)
      return acc
    }, [])
    .reduce((acc: string, line: string) => {
      acc = acc.concat(line, '\n')
      return acc
    }, '')
