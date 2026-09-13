import { GeneratedFile, GeneratedFolder } from '@teleporthq/teleport-types'

/**
 * Safety net for the whole family of "Module not found" build breaks: a plugin
 * emits a relative import whose specifier points at a file the generator never
 * writes. The generated project still LOOKS fine — the defect only surfaces
 * when `next build` (or Vercel) compiles the page, which is far away from the
 * code that computed the path.
 *
 * The one that motivated this module: a page in `pages/resources/` importing
 * from the project's root `resources/` folder collapsed to `../fetch_items`
 * because the page-relative and root-relative folder paths were mixed in a
 * single `path.relative()` call (fixed at the source — see
 * `generatePageDependenciesPrefix` in ./generic). Nothing in the pipeline
 * noticed, so the check below runs over the finished file tree and reports
 * every relative specifier that resolves to no generated file.
 *
 * Report-only by design: a false positive (a string literal that merely looks
 * like an import) must never be able to fail a generation or, worse, rewrite
 * someone's code.
 */

/** One generated file, addressed by its PROJECT-ROOT-relative path. */
export interface ProjectFileEntry {
  /** e.g. `pages/resources/[id].js` — always '/'-separated, no leading slash. */
  path: string
  content: string
}

export interface UnresolvedLocalImport {
  /** Project-root-relative path of the file holding the import. */
  filePath: string
  /** The specifier exactly as it appears in the source. */
  specifier: string
}

/** File types whose contents are parsed for import specifiers. */
const SCANNED_EXTENSIONS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx']

/**
 * Extensions a bundler appends to an extensionless specifier. The empty string
 * comes first so a specifier that already carries its extension (`./style.css`)
 * matches as-is.
 */
const RESOLVED_EXTENSIONS = [
  '',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.md',
  '.svg',
]

/** Extensions tried for a specifier that points at a folder (`./utils` → `./utils/index.js`). */
const INDEX_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.json']

/**
 * Every shape a relative module specifier takes in generated code. Kept as
 * separate, deliberately narrow patterns rather than one clever regex: an
 * over-eager match here would only ever produce noise in a warning.
 */
const IMPORT_PATTERNS: RegExp[] = [
  // import x from './y' / export { x } from './y' (incl. multi-line import lists)
  /\bfrom\s*['"](\.[^'"\n]*)['"]/g,
  // import('./y')
  /\bimport\s*\(\s*['"](\.[^'"\n]*)['"]\s*\)/g,
  // require('./y')
  /\brequire\s*\(\s*['"](\.[^'"\n]*)['"]\s*\)/g,
  // import './y' (side-effect only)
  /\bimport\s+['"](\.[^'"\n]*)['"]/g,
]

const getFileName = (file: GeneratedFile): string =>
  file.fileType ? `${file.name}.${file.fileType}` : file.name

const getExtension = (filePath: string): string => {
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

/**
 * Resolve `specifier` against the folder holding `filePath`, purely on the
 * segment arrays. Node's `path` is deliberately not used: this code also runs
 * inside teleport-gui's packer Web Worker, where 'path' is swapped for Next's
 * compiled `path-browserify` (see `localRelativePath` in ./generic).
 *
 * Returns null when the specifier climbs above the project root — nothing above
 * it is ever generated, so such an import is unresolvable by definition.
 */
const resolveSpecifier = (filePath: string, specifier: string): string | null => {
  const segments = filePath.split('/').slice(0, -1)

  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (segments.length === 0) {
        return null
      }
      segments.pop()
      continue
    }
    segments.push(part)
  }

  return segments.join('/')
}

/** Drop a bundler suffix (`./icon.svg?inline`, `./font.woff#iefix`) before resolving. */
const stripSpecifierSuffix = (specifier: string): string => {
  const cutIndex = Math.min(
    ...['?', '#'].map((marker) => {
      const index = specifier.indexOf(marker)
      return index === -1 ? specifier.length : index
    })
  )
  return specifier.slice(0, cutIndex)
}

const extractSpecifiers = (content: string): string[] => {
  const specifiers = new Set<string>()

  IMPORT_PATTERNS.forEach((pattern) => {
    // Patterns are module-level (and therefore stateful through `lastIndex`) —
    // reset before each file so a previous scan can't skip the first match.
    pattern.lastIndex = 0
    let match = pattern.exec(content)
    while (match !== null) {
      specifiers.add(match[1])
      match = pattern.exec(content)
    }
  })

  return Array.from(specifiers)
}

/**
 * Flatten a generated project into project-root-relative file entries. The root
 * folder's own name is the project directory itself, so it is not part of any
 * path.
 */
export const collectProjectFiles = (folder: GeneratedFolder): ProjectFileEntry[] => {
  const entries: ProjectFileEntry[] = []

  const walk = (currentFolder: GeneratedFolder, prefix: string) => {
    currentFolder.files.forEach((file) => {
      entries.push({
        path: `${prefix}${getFileName(file)}`,
        content: file.contentEncoding === 'base64' ? '' : file.content || '',
      })
    })

    currentFolder.subFolders.forEach((subFolder) => {
      walk(subFolder, `${prefix}${subFolder.name}/`)
    })
  }

  walk(folder, '')

  return entries
}

/**
 * Every relative import in `files` that resolves to no file in `files`.
 * Deterministically ordered (file, then specifier) so callers can snapshot it.
 */
export const findUnresolvedLocalImports = (files: ProjectFileEntry[]): UnresolvedLocalImport[] => {
  const existingPaths = new Set(files.map((file) => file.path))
  const unresolved: UnresolvedLocalImport[] = []

  const resolvesToAFile = (target: string): boolean =>
    RESOLVED_EXTENSIONS.some((extension) => existingPaths.has(`${target}${extension}`)) ||
    INDEX_EXTENSIONS.some((extension) => existingPaths.has(`${target}/index${extension}`))

  files.forEach((file) => {
    if (SCANNED_EXTENSIONS.indexOf(getExtension(file.path)) === -1) {
      return
    }

    extractSpecifiers(file.content).forEach((specifier) => {
      const target = resolveSpecifier(file.path, stripSpecifierSuffix(specifier))

      if (target === null || !resolvesToAFile(target)) {
        unresolved.push({ filePath: file.path, specifier })
      }
    })
  })

  return unresolved.sort((first, second) =>
    first.filePath === second.filePath
      ? first.specifier.localeCompare(second.specifier)
      : first.filePath.localeCompare(second.filePath)
  )
}

/** `findUnresolvedLocalImports` over a generated project folder. */
export const findUnresolvedLocalImportsInProject = (
  folder: GeneratedFolder
): UnresolvedLocalImport[] => findUnresolvedLocalImports(collectProjectFiles(folder))

/** Human-readable report. Returns an empty string when there is nothing to report. */
export const formatUnresolvedLocalImports = (unresolved: UnresolvedLocalImport[]): string => {
  if (unresolved.length === 0) {
    return ''
  }

  const lines = unresolved.map((item) => `  ${item.filePath}  →  '${item.specifier}'`)

  return (
    `${unresolved.length} generated import${unresolved.length === 1 ? '' : 's'} ` +
    `resolve${unresolved.length === 1 ? 's' : ''} to no generated file — ` +
    `the build will fail with "Module not found":\n${lines.join('\n')}`
  )
}
