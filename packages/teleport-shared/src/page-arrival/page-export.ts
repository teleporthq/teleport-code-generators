import * as types from '@babel/types'
import { ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { generatePageToRootPrefix } from '../utils/generic'
import { PAGE_ARRIVAL_DIR, PAGE_ARRIVAL_FILE_NAME, PAGE_ARRIVAL_WRAPPER } from './constants'
import { generatePageArrivalRuntime } from './runtime'

/** The chunk the React base-component plugin emits `export default <Page>` into. */
const EXPORT_CHUNK_NAME = 'export'

const isPageArrivalWrapper = (expression: types.Node): boolean =>
  expression.type === 'CallExpression' &&
  expression.callee.type === 'Identifier' &&
  expression.callee.name === PAGE_ARRIVAL_WRAPPER

/**
 * Makes the page start fresh on every arrival — see `generatePageArrivalRuntime`
 * for why Next.js does not do it on its own.
 *
 * Rewrites `export default Page` into `export default remountOnPageArrival(Page)`,
 * imports the wrapper and emits it once per project. Several plugins may ask for
 * the same page, so a page that is already wrapped is left alone. Nothing is
 * changed when the page has no plain default export to wrap, or when the
 * generation has nowhere to emit the runtime — an import of a file that is never
 * written would break the build.
 */
export const remountPageOnArrival = (structure: ComponentStructure): void => {
  const { chunks, dependencies, options, uidl } = structure
  const exportChunk = chunks.find((chunk) => chunk.name === EXPORT_CHUNK_NAME)
  const exportDeclaration = exportChunk?.content as types.Node | undefined

  if (
    !options.extractedResources ||
    !exportDeclaration ||
    exportDeclaration.type !== 'ExportDefaultDeclaration' ||
    isPageArrivalWrapper(exportDeclaration.declaration) ||
    exportDeclaration.declaration.type !== 'Identifier'
  ) {
    return
  }

  exportDeclaration.declaration = types.callExpression(types.identifier(PAGE_ARRIVAL_WRAPPER), [
    exportDeclaration.declaration,
  ])

  const runtimePath = [...PAGE_ARRIVAL_DIR, PAGE_ARRIVAL_FILE_NAME].join('/')
  const rootPrefix = generatePageToRootPrefix({
    folderPath: uidl.outputOptions?.folderPath,
    pagesPath: options.pagesPath,
  })
  dependencies[PAGE_ARRIVAL_WRAPPER] = { type: 'local', path: `${rootPrefix}${runtimePath}` }

  options.extractedResources[runtimePath] = {
    fileName: PAGE_ARRIVAL_FILE_NAME,
    fileType: FileType.JS,
    path: [...PAGE_ARRIVAL_DIR],
    content: generatePageArrivalRuntime(),
  }
}
