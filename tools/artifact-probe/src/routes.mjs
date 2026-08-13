import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const PAGE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']
const NON_ROUTE_FILES = new Set(['_app', '_document', '_error', 'middleware'])

/**
 * Routes come from the `pages/` tree rather than the build output, so the list
 * is known even when the build FAILED — a report saying "0 routes" because
 * nothing compiled is indistinguishable from a project with no pages.
 */
export const discoverRoutes = (projectDir) => {
  const pagesDir = join(projectDir, 'pages')
  if (!existsSync(pagesDir)) {
    return []
  }

  const routes = []

  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // API routes are endpoints, not pages.
        if (segments.length === 0 && entry.name === 'api') {
          continue
        }
        walk(join(dir, entry.name), [...segments, entry.name])
        continue
      }

      const extension = PAGE_EXTENSIONS.find((candidate) => entry.name.endsWith(candidate))
      if (!extension) {
        continue
      }
      const name = entry.name.slice(0, -extension.length)
      if (NON_ROUTE_FILES.has(name)) {
        continue
      }

      const routeSegments = name === 'index' ? segments : [...segments, name]
      routes.push({
        path: routeSegments.length ? `/${routeSegments.join('/')}` : '/',
        file: join('pages', ...segments, entry.name),
        dynamic: routeSegments.some(
          (segment) => segment.startsWith('[') || segment.startsWith('...')
        ),
      })
    }
  }

  walk(pagesDir, [])
  return routes.sort((left, right) => left.path.localeCompare(right.path))
}

const parseSize = (value) => {
  const match = value.match(/([\d.]+)\s*(B|kB|KB|MB)/)
  if (!match) {
    return null
  }
  const amount = parseFloat(match[1])
  if (match[2] === 'B') {
    return amount / 1024
  }
  if (match[2] === 'MB') {
    return amount * 1024
  }
  return amount
}

/**
 * `next build` prints a per-route table ending in "First Load JS" — the number
 * that decides how long a visitor stares at nothing. Parsed from stdout because
 * Next 12 writes no machine-readable equivalent.
 */
export const parseBuildOutput = (stdout) => {
  const routes = []
  let sharedKb = null

  for (const rawLine of stdout.split(/\r?\n/)) {
    // Strip the tree-drawing and status glyphs Next prefixes each row with.
    const line = rawLine.replace(/^[\s│├└┌─┬┴┼○λƒ●•+]*/, '').trim()
    if (!line) {
      continue
    }

    if (line.startsWith('First Load JS shared by all')) {
      sharedKb = parseSize(line)
      continue
    }

    const match = line.match(/^(\/\S*)\s+(?:[\d.]+\s*(?:B|kB|KB|MB))\s+([\d.]+\s*(?:B|kB|KB|MB))/)
    if (match) {
      const firstLoadKb = parseSize(match[2])
      if (firstLoadKb !== null) {
        routes.push({ path: match[1], firstLoadKb: Math.round(firstLoadKb * 10) / 10 })
      }
    }
  }

  return { routes, sharedKb }
}

/**
 * Dependencies declared in `package.json` that nothing in the generated source
 * imports. Each one is install time and lockfile surface a real user pays for,
 * and they appear when the generator adds a dep for a feature the UIDL stopped
 * using.
 */
export const findUnusedDependencies = (projectDir) => {
  const packageJsonPath = join(projectDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return []
  }

  let dependencies = []
  try {
    dependencies = Object.keys(JSON.parse(readFileSync(packageJsonPath, 'utf8')).dependencies ?? {})
  } catch {
    return []
  }

  const sources = []
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'public'])
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(join(dir, entry.name))
        }
        continue
      }
      if (PAGE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        try {
          sources.push(readFileSync(join(dir, entry.name), 'utf8'))
        } catch {
          /* an unreadable file is not evidence of anything */
        }
      }
    }
  }
  walk(projectDir)

  // The framework pulls these in itself; no generated file imports them by name,
  // and reporting them as dead weight is noise that trains you to ignore the list.
  const FRAMEWORK_IMPLIED = new Set(['next', 'react', 'react-dom'])

  const haystack = sources.join('\n')
  return dependencies.filter((dependency) => {
    if (FRAMEWORK_IMPLIED.has(dependency)) {
      return false
    }
    // Match `from 'dep'`, `from 'dep/sub'`, `require('dep')`.
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !new RegExp(`['"\`]${escaped}(/|['"\`])`).test(haystack)
  })
}
