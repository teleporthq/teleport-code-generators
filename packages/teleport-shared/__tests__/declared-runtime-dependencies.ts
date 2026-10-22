import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import * as ts from 'typescript'

/**
 * A published package that loads another @teleporthq package without declaring
 * it gets whichever copy the consuming app happens to hoist. teleport-gui hoisted
 * teleport-shared 0.43.75, so teleport-plugin-next-static-props 0.44.1 found no
 * TableAccess.pageDataReadsNoRowOf (added in 0.44.1) and every Next publish of a
 * store failed with "pageDataReadsNoRowOf is not a function".
 *
 * Private packages are skipped: they are never published, so their imports
 * always resolve inside this workspace.
 */

const PACKAGES_DIR = resolve(__dirname, '../..')
const SCOPE = '@teleporthq/'
const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const DECLARATION_OR_TEST = /\.d\.[cm]?ts$|\.(test|spec)\.[cm]?[jt]sx?$/

interface PackageManifest {
  name: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const onlyTypes = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
  elements.length > 0 && elements.every((element) => element.isTypeOnly)

const isTypeOnlyImport = ({ importClause }: ts.ImportDeclaration) =>
  !!importClause &&
  (importClause.isTypeOnly ||
    (!importClause.name &&
      !!importClause.namedBindings &&
      ts.isNamedImports(importClause.namedBindings) &&
      onlyTypes(importClause.namedBindings.elements)))

const isTypeOnlyExport = ({ isTypeOnly, exportClause }: ts.ExportDeclaration) =>
  isTypeOnly ||
  (!!exportClause && ts.isNamedExports(exportClause) && onlyTypes(exportClause.elements))

const moduleName = (expression: ts.Expression | undefined) =>
  expression && ts.isStringLiteralLike(expression) ? expression.text : undefined

const runtimeModuleOf = (node: ts.Node) => {
  if (ts.isImportDeclaration(node)) {
    return isTypeOnlyImport(node) ? undefined : moduleName(node.moduleSpecifier)
  }
  if (ts.isExportDeclaration(node)) {
    return isTypeOnlyExport(node) ? undefined : moduleName(node.moduleSpecifier)
  }
  if (ts.isCallExpression(node)) {
    const loadsModule =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require')
    return loadsModule ? moduleName(node.arguments[0]) : undefined
  }
  return undefined
}

const runtimeTeleportImports = (fileName: string, text: string) => {
  const packages: string[] = []
  const visit = (node: ts.Node) => {
    const loaded = runtimeModuleOf(node)
    if (loaded && loaded.startsWith(SCOPE)) {
      packages.push(loaded.split('/').slice(0, 2).join('/'))
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest))
  return packages
}

const runtimeSourcesIn = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== '__tests__') {
      files.push(...runtimeSourcesIn(entryPath))
    } else if (
      entry.isFile() &&
      SOURCE_FILE.test(entry.name) &&
      !DECLARATION_OR_TEST.test(entry.name)
    ) {
      files.push(entryPath)
    }
  }
  return files
}

const publishedPackages = () =>
  readdirSync(PACKAGES_DIR)
    .sort()
    .map((name) => join(PACKAGES_DIR, name))
    .filter((dir) => existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src')))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest,
    }))
    .filter(({ manifest }) => !manifest.private)

describe('@teleporthq runtime dependencies', () => {
  it('include every import except import type / export type', () => {
    const source = `
      import type { A } from '@teleporthq/import-type'
      import { type B } from '@teleporthq/inline-type'
      export type { C } from '@teleporthq/export-type'
      let d: typeof import('@teleporthq/type-query')
      const e = \`import { f } from '@teleporthq/inside-a-string'\`
      import { g } from '@teleporthq/named/dist/cjs/g'
      import '@teleporthq/side-effect'
      export * from '@teleporthq/re-export'
      const h = () => import('@teleporthq/dynamic')
      const i = require('@teleporthq/required')
    `

    expect(runtimeTeleportImports('sample.ts', source)).toEqual([
      '@teleporthq/named',
      '@teleporthq/side-effect',
      '@teleporthq/re-export',
      '@teleporthq/dynamic',
      '@teleporthq/required',
    ])
  })

  it('are declared by every published package that loads them', () => {
    const undeclared: string[] = []
    let checkedImports = 0

    for (const { dir, manifest } of publishedPackages()) {
      const declared = { ...manifest.dependencies, ...manifest.peerDependencies }
      const filesByMissingPackage: Record<string, string[]> = {}

      for (const file of runtimeSourcesIn(join(dir, 'src'))) {
        const text = readFileSync(file, 'utf8')
        if (!text.includes(SCOPE)) {
          continue
        }
        for (const loaded of runtimeTeleportImports(file, text)) {
          checkedImports++
          if (loaded === manifest.name || loaded in declared) {
            continue
          }
          const files = (filesByMissingPackage[loaded] = filesByMissingPackage[loaded] || [])
          const shownPath = relative(dir, file)
          if (files.indexOf(shownPath) === -1) {
            files.push(shownPath)
          }
        }
      }

      for (const missing of Object.keys(filesByMissingPackage).sort()) {
        undeclared.push(
          `${manifest.name} loads ${missing} (${filesByMissingPackage[missing].sort().join(', ')})`
        )
      }
    }

    expect(checkedImports).toBeGreaterThan(0)
    expect(undeclared).toEqual([])
  })
})
