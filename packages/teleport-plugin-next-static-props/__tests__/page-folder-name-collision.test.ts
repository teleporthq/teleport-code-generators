import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

/**
 * Regression guard for the `pages/resources/[id].js` build break:
 *
 *   Module not found: Can't resolve '../fetch_content_items_detail'
 *
 * `outputOptions.folderPath` is relative to the PAGES ROOT while
 * `resources.path` is relative to the PROJECT ROOT, so resolving one against
 * the other cancelled the `resources` segment they only appeared to share and
 * the import pointed inside `pages/`. Every page whose folder is named after a
 * project-root folder hits it — and only those, which is why it went unnoticed.
 */

const RESOURCE_ID = 'fetch-content-item'
const RESOURCE_NAME = 'fetch_content_items_detail'

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
        initialPropsData: {
          exposeAs: { name: 'contentItem', valuePath: [] },
          resource: { id: RESOURCE_ID, params: {} },
        },
      },
    },
    chunks: [],
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

describe('teleport-plugin-next-static-props: resource import path', () => {
  const plugin = createStaticPropsPlugin()

  it('reaches the project resources folder from a page whose folder is named "resources"', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['resources'] }))

    expect(structure.dependencies.fetchContentItemsDetailResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('keeps working for a page in a non-colliding subfolder', async () => {
    const structure = await plugin(makeStructure({ folderPath: ['blog'] }))

    expect(structure.dependencies.fetchContentItemsDetailResource.path).toBe(
      `../../resources/${RESOURCE_NAME}`
    )
  })

  it('keeps working for a page at the pages root', async () => {
    const structure = await plugin(makeStructure({ folderPath: [] }))

    expect(structure.dependencies.fetchContentItemsDetailResource.path).toBe(
      `../resources/${RESOURCE_NAME}`
    )
  })

  it('does not collapse a multi-segment resources folder either', async () => {
    const structure = await plugin(
      makeStructure({ folderPath: ['utils'], resourcesPath: ['utils', 'data-sources'] })
    )

    expect(structure.dependencies.fetchContentItemsDetailResource.path).toBe(
      `../../utils/data-sources/${RESOURCE_NAME}`
    )
  })

  it('honours a pages root that is not the project root child', async () => {
    const structure = await plugin(
      makeStructure({ folderPath: ['resources'], pagesPath: ['src', 'pages'] })
    )

    expect(structure.dependencies.fetchContentItemsDetailResource.path).toBe(
      `../../../resources/${RESOURCE_NAME}`
    )
  })
})
