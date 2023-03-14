import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ProjectPluginStructure,
  ProjectPlugin,
  FileType,
  UIDLElement,
} from '@teleporthq/teleport-types'
import path from 'path'

class ProjectPluginExternalEmbed implements ProjectPlugin {
  remapEmbed(element: UIDLElement, structure: ProjectPluginStructure) {
    if (element.elementType === 'html-node' && 'html' in element?.attrs) {
      const content = element?.attrs?.html?.content as string
      const fileName = (Math.random() + 1).toString(36).substring(7)
      structure.files.set(fileName, {
        path: structure.strategy.static.path,
        files: [{ name: fileName, content, fileType: FileType.HTML }],
      })
      element.attrs = {}
      element.attrs.file = {
        type: 'static',
        content: `./${path.join(structure.strategy.static.prefix, `${fileName}.${FileType.HTML}`)}`,
      }
    }
  }

  async runBefore(structure: ProjectPluginStructure) {
    UIDLUtils.traverseElements(structure.uidl.root.node, (element) =>
      this.remapEmbed(element, structure)
    )

    Object.values(structure.uidl?.components || {}).forEach((componentUIDL) => {
      UIDLUtils.traverseElements(componentUIDL.node, (element) =>
        this.remapEmbed(element, structure)
      )
    })

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}

export const pluginExternalEmbed = new ProjectPluginExternalEmbed()
