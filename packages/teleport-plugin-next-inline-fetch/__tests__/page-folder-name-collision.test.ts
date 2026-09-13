import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextPagesInlineFetchPlugin } from '../src/index'

/**
 * Same coordinate-system defect as the static-props/static-paths guards: a
 * cms-list whose resource is static enough to be hoisted into getStaticProps
 * imports the resource file straight into the page, so a page folder named
 * after the project's `resources/` folder produced an import that resolved
 * inside `pages/`.
 */

const RESOURCE_ID = 'fetch-content-items'
const RESOURCE_NAME = 'fetch_content_items'
const NODE_KEY = 'content-items-list'

const makeStructure = (params: {
  folderPath: string[]
  resourcesPath?: string[]
  pagesPath?: string[]
}): ComponentStructure => {
  const { folderPath, resourcesPath = ['resources'], pagesPath } = params

  const jsxNode = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('DataProvider'), [], false),
    types.jsxClosingElement(types.jsxIdentifier('DataProvider')),
    [],
    false
  )

  return {
    uidl: {
      name: 'CustomResources',
      node: {
        type: 'cms-list',
        content: {
          key: NODE_KEY,
          renderPropIdentifier: 'contentItems',
          valuePath: [],
          resource: { id: RESOURCE_ID, params: {} },
          nodes: { success: { type: 'element', content: { elementType: 'container' } } },
        },
      },
      outputOptions: { folderPath, fileName: '[id]' },
    },
    chunks: [
      {
        name: 'jsx-component',
        meta: { nodesLookup: { [NODE_KEY]: jsxNode } },
      },
    ],
    dependencies: {},
    options: {
      ...(pagesPath && { pagesPath }),
      extractedResources: {},
      resources: {
        items: { [RESOURCE_ID]: { id: RESOURCE_ID, name: RESOURCE_NAME, params: {} } },
        path: resourcesPath,
      },
    },
  } as unknown as ComponentStructure
}

describe('teleport-plugin-next-inline-fetch: hoisted resource import path', () => {
  const plugin = createNextPagesInlineFetchPlugin()

  it('reaches the project resources folder from a page whose folder is named "resources"', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['resources'] }))

    expect(structure.dependencies.fetchContentItemsResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('keeps working for a page in a non-colliding subfolder', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['blog'] }))

    expect(structure.dependencies.fetchContentItemsResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('honours a pages root that is not the project root child', async () => {
    const structure = await plugin(
      makeStructure({ folderPath: ['resources'], pagesPath: ['src', 'pages'] })
    )

    expect(structure.dependencies.fetchContentItemsResource.path).toBe(
      `../../../resources/${RESOURCE_NAME}`
    )
  })
})
