import { StringUtils } from '@teleporthq/teleport-shared'
import {
  ProjectPluginStructure,
  UIDLExternalResource,
  UIDLLocalResource,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { createNextComponentInlineFetchPlugin } from './utils'

type Modify<T, R> = Omit<T, keyof R> & R

export type FilteredResource =
  | Modify<
      UIDLLocalResource,
      {
        params: Record<string, UIDLStaticValue>
        itemValuePath?: string[]
        valuePath?: string[]
      }
    >
  | Modify<
      UIDLExternalResource,
      {
        params: Record<string, UIDLStaticValue>
        itemValuePath?: string[]
        valuePath?: string[]
      }
    >

class ProjectPluginInlineFetch {
  dependencies: Record<string, string> = {}
  extractedResources: Record<string, FilteredResource> = {}

  nextBeforeModifier = (structure: ProjectPluginStructure) => {
    /*
      Extracting the API fetch calls of root `cms-list` or `cms-item` with static parameters
      into getStaticProps
    */
    const rootNode = structure.uidl.root.node.content
    if (rootNode.elementType !== 'Router') {
      throw new Error(`Root node is missing from the `)
    }
    const pages = rootNode.children

    pages.forEach((page) => {
      /*
        Root is always a contiditional for pages
      */
      if (page.type !== 'conditional') {
        return
      }

      /*
        Children can exist only inside a root element node
      */
      if (page.content.node.type !== 'element') {
        return
      }

      page.content.node.content.children?.forEach((rootNodeOfrootElementOfPage) => {
        const isRootNodeOfPageIsCMSEntity =
          rootNodeOfrootElementOfPage.type === 'cms-list' ||
          rootNodeOfrootElementOfPage.type === 'cms-item'

        /*
          If a node already has a initialData on it. We don't need to do anything
        */

        if (!isRootNodeOfPageIsCMSEntity || 'initialData' in rootNodeOfrootElementOfPage.content) {
          return
        }

        /*
          Move the resources that contain only static values,
          Should we fine-tune the expression check here ?
          And move the expressions which don't have prop or state references ?

          Because, an expression like this can still work inside getStaticProps
          - skip: (context.params.page - 1) * 4
          We only can't access prop and state values
        */
        const isResrouceContainsAnyDynamicValues = Object.values(
          rootNodeOfrootElementOfPage.content.resource?.params || {}
        ).some((param) => param.type === 'expr' || param.type === 'dynamic')

        if (isResrouceContainsAnyDynamicValues) {
          return
        }

        const propKey = StringUtils.createStateOrPropStoringValue(
          rootNodeOfrootElementOfPage.content.renderPropIdentifier + 'Prop'
        )

        this.extractedResources[propKey] = {
          ...(rootNodeOfrootElementOfPage.type === 'cms-item' && {
            itemValuePath: rootNodeOfrootElementOfPage.content?.itemValuePath,
          }),
          ...(rootNodeOfrootElementOfPage.type === 'cms-list' && {
            valuePath: rootNodeOfrootElementOfPage.content?.valuePath,
          }),
          ...(rootNodeOfrootElementOfPage.content.resource as FilteredResource),
        }

        rootNodeOfrootElementOfPage.content.initialData = {
          type: 'dynamic',
          content: {
            referenceType: 'prop',
            id: propKey,
          },
        }

        /*
          As the resource is extracted now, we don't need to pass it to the jsx node.
          Because it is passed to `getStaticProps`

          we need this
          <DataProvider
            key={props?.pagination?.page}
          />

          we don't need this
          <DataProvider
            initialData={some_prop}
            key={props?.pagination?.page}
            params={{
              projectId: '3bd8eb33-2aaa-4620-87bf-d7ccd04d0245',
              query:
                'query MyQuery($first: Int, $after: String){allAuthor(first: $first, after: $after){pageInfo{endCursor,hasNextPage,hasPreviousPage}edges{node{_meta{createdAt updatedAt id}name image{__typename _meta{createdAt updatedAt id}description height id keywords originType originalName src title width}}}}}',
              page: 1,
              perPage: 100,
            }}
          />

          Because we need props when we are loading and not when we are rendering now.
          As the no call is not going to happen at runtime.
        */
        delete rootNodeOfrootElementOfPage.content.resource.params
      })
    })

    const pluginNextInlineFetch = createNextComponentInlineFetchPlugin({
      files: structure.files,
      dependencies: this.dependencies,
      extractedResources: this.extractedResources,
      paths: {
        resources: structure.strategy.resources.path,
        pages: structure.strategy.pages.path,
      },
    })

    structure.strategy.pages.plugins.push(pluginNextInlineFetch)
    structure.strategy.components.plugins.push(pluginNextInlineFetch)

    return structure
  }

  nextAfterModifier = (structure: ProjectPluginStructure) => {
    const { dependencies } = structure
    Object.entries(this.dependencies).forEach(([packageName, version]) => {
      if (!dependencies[packageName]) {
        dependencies[packageName] = version
      }
    })
    return structure
  }
}

const projectPluginInlineFetch = new ProjectPluginInlineFetch()
export default projectPluginInlineFetch
