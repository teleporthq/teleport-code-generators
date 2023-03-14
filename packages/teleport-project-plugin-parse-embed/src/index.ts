import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ProjectPluginStructure, ProjectPlugin, UIDLElementNode } from '@teleporthq/teleport-types'
// @ts-ignore
import { toHtml, fromHtml } from './utils.js'

const NODE_MAPPER: Record<string, typeof toHtml> = {
  'teleport-project-html': toHtml,
}

class ProjectPluginParseEmbed implements ProjectPlugin {
  traverseComponentUIDL(node: UIDLElementNode, id: string) {
    UIDLUtils.traverseElements(node, (element) => {
      if (element.elementType === 'html-node' && element.attrs?.html && NODE_MAPPER[id]) {
        const hastNodes = fromHtml((element.attrs.html.content as string).replace('\n', ''), {
          fragment: true,
          verbose: true,
        })
        const content = NODE_MAPPER[id](hastNodes)

        element.elementType = 'container'
        element.attrs = {}
        element.children = [
          {
            type: 'raw',
            content,
          },
        ]
      }
    })
  }

  async runBefore(structure: ProjectPluginStructure) {
    if (!NODE_MAPPER[structure.strategy.id]) {
      return structure
    }

    this.traverseComponentUIDL(structure.uidl.root.node, structure.strategy.id)

    Object.values(structure.uidl?.components || {}).forEach((componentUIDL) => {
      this.traverseComponentUIDL(componentUIDL.node, structure.strategy.id)
    })

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}

export const pluginParseEmbed = new ProjectPluginParseEmbed()
