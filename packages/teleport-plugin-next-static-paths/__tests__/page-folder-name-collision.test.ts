import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPathsPlugin } from '../src/index'

/**
 * Regression guard for the `pages/resources/[id].js` build break — the
 * getStaticPaths half of it:
 *
 *   Module not found: Can't resolve '../fetch_content_items_paths'
 *
 * See the sibling test in teleport-plugin-next-static-props for the full story.
 */

const RESOURCE_ID = 'fetch-content-item-paths'
const RESOURCE_NAME = 'fetch_content_items_paths'

const makeStructure = (params: {
  folderPath: string[]
  resourcesPath?: string[]
  pagesPath?: string[]
}): ComponentStructure => {
  const { folderPath, resourcesPath = ['resources'], pagesPath } = params
  return {
    uidl: {
      name: 'CustomResources',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        folderPath,
        fileName: '[id]',
        initialPathsData: {
          exposeAs: { name: 'id', valuePath: [], itemValuePath: ['id'] },
          resource: { id: RESOURCE_ID, params: {} },
        },
      },
    },
    chunks: [{ name: 'jsx-component' }],
    dependencies: {},
    options: {
      ...(pagesPath && { pagesPath }),
      resources: {
        items: { [RESOURCE_ID]: { id: RESOURCE_ID, name: RESOURCE_NAME } },
        path: resourcesPath,
      },
    },
  } as unknown as ComponentStructure
}

describe('teleport-plugin-next-static-paths: resource import path', () => {
  const plugin = createStaticPathsPlugin()

  it('reaches the project resources folder from a page whose folder is named "resources"', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['resources'] }))

    expect(structure.dependencies.fetchContentItemsPathsResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('keeps working for a page in a non-colliding subfolder', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['blog'] }))

    expect(structure.dependencies.fetchContentItemsPathsResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('honours a pages root that is not the project root child', async () => {
    const structure = await plugin(
      makeStructure({ folderPath: ['resources'], pagesPath: ['src', 'pages'] })
    )

    expect(structure.dependencies.fetchContentItemsPathsResource.path).toBe(
      `../../../resources/${RESOURCE_NAME}`
    )
  })
})
