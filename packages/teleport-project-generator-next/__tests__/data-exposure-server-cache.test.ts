import { parse } from '@babel/parser'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import {
  DATA_SOURCE_ID,
  OWNED_TABLE,
  bootReadRoute,
  folderAt,
  generateDataExposureProject,
} from './_helpers/data-exposure-fixture'

/**
 * The server data cache on, on every list of the store/blog project, row-owned
 * details page included (N1). A row-owned table is never cached, so its module
 * carries no cache wiring; its exports must then name only what it declares,
 * or the ES module fails to load and `next build` fails for the whole site.
 */

const routeOf = (table: string): string => generateSafeFileName('teleport', table, DATA_SOURCE_ID)

/** Every name an export statement points at that the module never declares. */
const undeclaredExports = (source: string): string[] => {
  // `errorRecovery: false` (the default) already throws on an undeclared named
  // export; `export default <name>` is only a load-time error, checked below.
  const program = parse(source, { sourceType: 'module' }).program
  const declared = new Set<string>()
  program.body.forEach((statement: any) => {
    const node =
      statement.type.startsWith('Export') && statement.declaration
        ? statement.declaration
        : statement
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      declared.add(node.id.name)
    }
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach((declaration: any) => {
        if (declaration.id.type === 'Identifier') {
          declared.add(declaration.id.name)
        }
      })
    }
    if (node.type === 'ImportDeclaration') {
      node.specifiers.forEach((specifier: any) => declared.add(specifier.local.name))
    }
  })
  const missing: string[] = []
  program.body.forEach((statement: any) => {
    if (
      statement.type === 'ExportDefaultDeclaration' &&
      statement.declaration.type === 'Identifier' &&
      !declared.has(statement.declaration.name)
    ) {
      missing.push(statement.declaration.name)
    }
  })
  return missing
}

const jsFilesIn = (folder: GeneratedFolder | undefined): Array<{ name: string; content: string }> =>
  (folder?.files || []).filter((file) => file.fileType === 'js' || /\.js$/.test(file.name))

describe('data exposure with the server data cache on (N1)', () => {
  let project: GeneratedFolder

  beforeAll(async () => {
    project = await generateDataExposureProject({ serverCache: true })
  }, 120000)

  it('every read module and read route declares every name it exports', () => {
    const modules = [
      ...jsFilesIn(folderAt(project, ['utils', 'data-sources'])),
      ...jsFilesIn(folderAt(project, ['pages', 'api'])),
    ]
    const owned = modules.filter((file) => file.name.startsWith(routeOf(OWNED_TABLE)))
    expect(owned.length).toBeGreaterThan(0)
    // The cache is on somewhere, so a broken branch would show.
    expect(modules.some((file) => /cachedHandler/.test(file.content))).toBe(true)

    const broken = modules
      .map((file) => {
        try {
          const missing = undeclaredExports(file.content)
          return missing.length ? `${file.name}: ${missing.join(', ')}` : null
        } catch (error) {
          return `${file.name}: ${(error as Error).message}`
        }
      })
      .filter(Boolean)
    expect(broken).toEqual([])
  })

  it("the row-owned table's module carries no cache and answers each session its own rows", async () => {
    const owned = jsFilesIn(folderAt(project, ['utils', 'data-sources'])).find((file) =>
      file.name.startsWith(routeOf(OWNED_TABLE))
    )
    const apiRoute = jsFilesIn(folderAt(project, ['pages', 'api'])).find(
      (file) => file.name === routeOf(OWNED_TABLE)
    )
    const text = (owned || apiRoute).content
    expect(text).not.toMatch(/cachedHandler|tqWithCache/)

    const route = bootReadRoute(project, routeOf(OWNED_TABLE))
    expect((await route({})).status).toBe(401)
    const mine = await route({ session: { role: 'user', id: 'u-1' } })
    expect(mine.status).toBe(200)
    const read = mine.queries.findIndex(
      (sql) => /FROM job_applications/.test(sql) && !/COUNT/.test(sql)
    )
    expect(mine.queries[read]).toMatch(/user_id = \$1/)
    expect(mine.params[read][0]).toBe('u-1')
  })
})
