import generator from '@babel/generator'
import * as types from '@babel/types'
import { ChunkType, ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { PageArrival } from '../../src'

const makeStructure = (
  params: {
    folderPath?: string[]
    exportContent?: types.Node | null
    withExtractedResources?: boolean
  } = {}
): ComponentStructure => {
  const {
    folderPath = [],
    exportContent = types.exportDefaultDeclaration(types.identifier('Customers')),
    withExtractedResources = true,
  } = params
  return {
    uidl: {
      name: 'Customers',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: { folderPath },
    },
    chunks: exportContent
      ? [
          {
            name: 'export',
            type: ChunkType.AST,
            fileType: FileType.JS,
            content: exportContent,
            linkAfter: ['jsx-component'],
          },
        ]
      : [],
    dependencies: {},
    options: {
      pagesPath: ['pages'],
      ...(withExtractedResources ? { extractedResources: {} } : {}),
    },
  } as unknown as ComponentStructure
}

const exportCode = (structure: ComponentStructure): string =>
  generator(structure.chunks.find((chunk) => chunk.name === 'export')?.content as types.Node).code

describe('PageArrival.remountPageOnArrival', () => {
  it('wraps the default export, imports the wrapper and emits it once', () => {
    const structure = makeStructure()

    PageArrival.remountPageOnArrival(structure)

    expect(exportCode(structure)).toBe('export default remountOnPageArrival(Customers);')
    expect(structure.dependencies.remountOnPageArrival).toEqual({
      type: 'local',
      path: '../utils/page-arrival',
    })
    expect(structure.options.extractedResources?.['utils/page-arrival']).toEqual({
      fileName: 'page-arrival',
      fileType: FileType.JS,
      path: ['utils'],
      content: PageArrival.generatePageArrivalRuntime(),
    })
  })

  it('reaches the wrapper from a page in a subfolder', () => {
    const structure = makeStructure({ folderPath: ['profile'] })

    PageArrival.remountPageOnArrival(structure)

    expect(structure.dependencies.remountOnPageArrival).toEqual({
      type: 'local',
      path: '../../utils/page-arrival',
    })
  })

  it('wraps a page only once when several plugins ask for it', () => {
    const structure = makeStructure()

    PageArrival.remountPageOnArrival(structure)
    PageArrival.remountPageOnArrival(structure)

    expect(exportCode(structure)).toBe('export default remountOnPageArrival(Customers);')
  })

  it('changes nothing when the runtime cannot be emitted', () => {
    const structure = makeStructure({ withExtractedResources: false })

    PageArrival.remountPageOnArrival(structure)

    expect(exportCode(structure)).toBe('export default Customers;')
    expect(structure.dependencies).toEqual({})
  })

  it('changes nothing when there is no plain default export to wrap', () => {
    const withoutExport = makeStructure({ exportContent: null })
    PageArrival.remountPageOnArrival(withoutExport)
    expect(withoutExport.dependencies).toEqual({})
    expect(withoutExport.options.extractedResources).toEqual({})

    const wrappedElsewhere = makeStructure({
      exportContent: types.exportDefaultDeclaration(
        types.callExpression(types.identifier('withLayout'), [types.identifier('Customers')])
      ),
    })
    PageArrival.remountPageOnArrival(wrappedElsewhere)
    expect(exportCode(wrappedElsewhere)).toBe('export default withLayout(Customers);')
    expect(wrappedElsewhere.dependencies).toEqual({})
  })
})
