import { StringUtils } from '@teleporthq/teleport-shared'
import { ProjectPluginStructure, UIDLLocalResource } from '@teleporthq/teleport-types'
import { createNextComponentInlineFetchPlugin } from './utils'

class ProjectPluginInlineFetch {
  dependencies: Record<string, string> = {}
  extractedResources: Record<string, UIDLLocalResource> = {}

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

        /*
          TODO:
            For now, let's just handle for the local resources. And ocne the testing is good
            Let's apply the same for the external resources too.
        */
        if ('dependency' in rootNodeOfrootElementOfPage.content.resource) {
          return
        }

        const propKey = StringUtils.createStateOrPropStoringValue(
          rootNodeOfrootElementOfPage.content.renderPropIdentifier + 'Prop'
        )

        /*
          TODO:
          We should map this with resource Id, because what if the propKey is same but the resoruces are diff
        */
        this.extractedResources[propKey] = rootNodeOfrootElementOfPage.content.resource

        rootNodeOfrootElementOfPage.content.initialData = {
          type: 'dynamic',
          content: {
            referenceType: 'prop',
            id: propKey,
          },
        }
      })
    })

    const pluginNextInlineFetch = createNextComponentInlineFetchPlugin({
      files: structure.files,
      dependencies: this.dependencies,
      extractedResources: this.extractedResources,
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
