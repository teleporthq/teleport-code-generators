import * as fs from 'fs'
import * as path from 'path'

/*
  What a generated project installs and loads is decided by the version
  strings and CDN links written in the generator sources. A floating one
  ("latest", "*", a git branch, a CDN link with no version) means two exports
  of the same project can run different code, and nobody chose the change.
*/

const PACKAGES_DIR = path.join(__dirname, '../..')
const COMMIT_SHA = /^[0-9a-f]{40}$/

interface SourceLine {
  location: string
  text: string
}

const listSourceFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) {
    return []
  }

  return fs.readdirSync(dir, { withFileTypes: true }).reduce((files: string[], entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? files : files.concat(listSourceFiles(entryPath))
    }
    return /\.(ts|tsx)$/.test(entry.name) ? files.concat(entryPath) : files
  }, [])
}

const generatorSourceLines: SourceLine[] = fs
  .readdirSync(PACKAGES_DIR)
  .filter((packageName) => packageName !== 'teleport-test')
  .reduce(
    (files: string[], packageName) =>
      files.concat(listSourceFiles(path.join(PACKAGES_DIR, packageName, 'src'))),
    []
  )
  .reduce((lines: SourceLine[], file) => {
    const relativePath = path.relative(PACKAGES_DIR, file)
    return lines.concat(
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((text, index) => ({ location: `${relativePath}:${index + 1}`, text }))
    )
  }, [])

const linesMatching = (isOffending: (text: string) => boolean) =>
  generatorSourceLines
    .filter((line) => isOffending(line.text))
    .map((line) => `${line.location}  ${line.text.trim()}`)

const FLOATING_VERSION_PATTERNS = [
  /\bversion:\s*['"`](latest|next|\*)['"`]/,
  /['"`]\s*:\s*['"`]latest['"`]/,
  /[dD]ependencies(\.[\w$]+|\[[^\]]+\])\s*=\s*['"`](latest|\*)['"`]/,
]

const GIT_SPECIFIER = /['"`]((?:github:|git\+|git:\/\/)[^'"`]*)['"`]/

const UNPKG_OR_JSDELIVR_NPM =
  /https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\/((?:@[\w.-]+\/)?[\w.-]+)(@[^/'"`\s]+)?/g
const JSDELIVR_GITHUB = /https:\/\/cdn\.jsdelivr\.net\/gh\/[\w.-]+\/[\w.-]+(?:@([^/'"`\s]+))?/g
const GITHUB_BRANCH_FILE =
  /https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/(?:blob|raw)|raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+)\/(?:main|master|HEAD|development)\//

const hasUnversionedCdnLink = (text: string) => {
  const npmLinks = Array.from(text.matchAll(UNPKG_OR_JSDELIVR_NPM))
  const githubLinks = Array.from(text.matchAll(JSDELIVR_GITHUB))

  return (
    npmLinks.some((link) => !/^@\d/.test(link[2] || '')) ||
    githubLinks.some((link) => !COMMIT_SHA.test(link[1] || '')) ||
    GITHUB_BRANCH_FILE.test(text)
  )
}

describe('versions and CDN links written into generated projects', () => {
  it('reads the generator sources', () => {
    expect(generatorSourceLines.length).toBeGreaterThan(1000)
  })

  it('never asks for a floating package version', () => {
    expect(
      linesMatching((text) => FLOATING_VERSION_PATTERNS.some((pattern) => pattern.test(text)))
    ).toEqual([])
  })

  it('pins every git dependency to a commit', () => {
    expect(
      linesMatching((text) => {
        const specifier = text.match(GIT_SPECIFIER)
        return Boolean(specifier) && !COMMIT_SHA.test(specifier[1].split('#')[1] || '')
      })
    ).toEqual([])
  })

  it('names a version in every CDN link', () => {
    expect(linesMatching(hasUnversionedCdnLink)).toEqual([])
  })

  it('recognises the floating forms it guards against', () => {
    const floating = [
      `version: 'latest',`,
      `"react": "latest"`,
      `dependencies.react = '*'`,
      `structure.dependencies['some-package'] = 'latest'`,
    ]
    floating.forEach((text) =>
      expect(FLOATING_VERSION_PATTERNS.some((pattern) => pattern.test(text))).toBe(true)
    )

    expect(hasUnversionedCdnLink(`'https://unpkg.com/dangerous-html/dist/lib.umd.js'`)).toBe(true)
    expect(hasUnversionedCdnLink(`'https://unpkg.com/@scope/name/dist/lib.js'`)).toBe(true)
    expect(hasUnversionedCdnLink(`'https://cdn.jsdelivr.net/gh/owner/repo@main/lib.js'`)).toBe(true)
    expect(hasUnversionedCdnLink(`'https://github.com/owner/repo/blob/main/lib.js'`)).toBe(true)
    expect(hasUnversionedCdnLink(`'https://unpkg.com/@scope/name@1.2.3/dist/lib.js'`)).toBe(false)
    expect(hasUnversionedCdnLink(`'https://github.com/owner/repo/blob/v1.2.3/lib.js'`)).toBe(false)
  })
})
