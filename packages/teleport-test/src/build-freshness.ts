import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Is the compiled generator newer than its source?
 *
 * Generation does not run the TypeScript in `packages/*\/src`. It runs whatever
 * is in each package's `dist/`, built by `yarn build` (or kept current by the
 * `yarn dev` watcher). When the watcher is not running, editing a generator and
 * regenerating produces output from the LAST BUILD — silently, with no warning
 * anywhere.
 *
 * That turns the whole fix-and-verify loop into a liar: a fix appears not to
 * work, a bug appears not to be fixed, and a generated project gets debugged
 * against source it was not built from. It cost a full investigation once
 * already — a project failed `next build` on a NEXTAUTH_URL crash whose fix had
 * been in `src` for nine days and in no `dist` at all.
 *
 * So this is checked and reported, never assumed.
 */

export interface StalePackage {
  name: string
  sourceModified: string
  builtModified: string | null
}

const newestMtime = (dir: string, extensions: string[]): number => {
  let newest = 0
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }
      if (extensions.some((extension) => entry.name.endsWith(extension))) {
        const { mtimeMs } = statSync(entryPath)
        if (mtimeMs > newest) {
          newest = mtimeMs
        }
      }
    }
  }
  if (existsSync(dir)) {
    walk(dir)
  }
  return newest
}

/**
 * Every workspace package whose `src/` is newer than its build output — i.e.
 * every package whose behaviour in a generated project is NOT what the checked
 * out code says it is.
 */
export const findStalePackages = (packagesRoot: string): StalePackage[] => {
  if (!existsSync(packagesRoot)) {
    return []
  }

  const stale: StalePackage[] = []

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    // The runner itself is executed from source through ts-node, so its build
    // output is irrelevant — reporting it would be permanent noise.
    if (entry.name === 'teleport-test') {
      continue
    }
    const packageDir = join(packagesRoot, entry.name)
    const srcDir = join(packageDir, 'src')
    const packageJsonPath = join(packageDir, 'package.json')
    if (!existsSync(srcDir) || !existsSync(packageJsonPath)) {
      continue
    }

    let mainField = 'dist/cjs/index.js'
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { main?: string }
      mainField = parsed.main ?? mainField
    } catch {
      continue
    }

    const sourceMs = newestMtime(srcDir, ['.ts', '.tsx'])
    if (sourceMs === 0) {
      continue
    }

    // Compare against the newest file in the build output, not the entry point.
    // `tsc` only rewrites files whose contents changed, so editing one widget
    // leaves `index.js` untouched and its mtime old — comparing against it
    // reports a freshly built package as stale, and a check that cries wolf
    // gets ignored exactly when it matters.
    const buildDir = join(packageDir, dirname(mainField))
    const builtMs = newestMtime(buildDir, ['.js'])

    if (builtMs === 0) {
      stale.push({
        name: entry.name,
        sourceModified: new Date(sourceMs).toISOString(),
        builtModified: null,
      })
      continue
    }

    if (sourceMs > builtMs) {
      stale.push({
        name: entry.name,
        sourceModified: new Date(sourceMs).toISOString(),
        builtModified: new Date(builtMs).toISOString(),
      })
    }
  }

  return stale
}

export const describeStaleness = (stale: StalePackage[]): string =>
  [
    `${stale.length} generator package(s) have source newer than their build, so generation will NOT reflect them:`,
    ...stale.map(
      (entry) =>
        `  ${entry.name} — src ${entry.sourceModified}, built ${
          entry.builtModified ?? 'NEVER (no build output)'
        }`
    ),
    'Run `yarn build` at the repo root (or keep `yarn dev` running) before trusting this output.',
  ].join('\n')
