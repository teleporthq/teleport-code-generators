import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ProjectPluginStructure,
  ProjectPlugin,
  UIDLExternalDependency,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { toHtml, fromHtml } from './utils.js'
// @ts-ignore
import toJSX from 'hast-util-to-jsx-inline-script'

const NODE_MAPPER: Record<string, typeof toHtml> = {
  'teleport-project-html': toHtml,
  'teleport-project-react': toJSX,
  'teleport-project-next': toJSX,
}

const JS_EXECUTION_DEPENDENCIES: Record<string, Record<string, UIDLExternalDependency>> = {
  'teleport-project-react': {
    Script: {
      type: 'package',
      path: 'dangerous-html',
      version: '0.1.13',
      meta: {
        importAlias: 'dangerous-html/react',
      },
    },
  },
  'teleport-project-next': {
    Script: {
      type: 'library',
      path: 'next',
      version: '0.0.0',
      meta: {
        importAlias: 'next/script',
      },
    },
  },
  'teleport-project-html': {
    DangerousHTML: {
      type: 'package',
      path: 'dangerous-html',
      version: '0.1.13',
      meta: {
        importJustPath: true,
        importAlias: 'https://unpkg.com/dangerous-html@0.1.13/dist/default/lib.umd.js',
      },
    },
  },
}

class ProjectPluginParseEmbed implements ProjectPlugin {
  traverseComponentUIDL(node: UIDLElementNode, id: string): boolean {
    let shouldAddJSDependency = false

    UIDLUtils.traverseElements(node, (element) => {
      if (element.elementType === 'html-node' && element.attrs?.html && NODE_MAPPER[id]) {
        const hastNodes = fromHtml(element.attrs.html.content as string, {
          fragment: true,
        })
        const content = NODE_MAPPER[id](hastNodes)

        element.elementType = 'container'
        element.attrs = {}
        element.style = { display: { type: 'static', content: 'contents' } }
        element.children = [
          {
            type: 'inject',
            content,
          },
        ]

        if (content.includes('<Script')) {
          shouldAddJSDependency = true
        }
      }
    })

    return shouldAddJSDependency
  }

  async runBefore(structure: ProjectPluginStructure) {
    if (!NODE_MAPPER[structure.strategy.id] && !JS_EXECUTION_DEPENDENCIES[structure.strategy.id]) {
      return structure
    }

    const isNodeProcessed = this.traverseComponentUIDL(
      structure.uidl.root.node,
      structure.strategy.id
    )

    if (isNodeProcessed) {
      structure.uidl.root.importDefinitions = {
        ...(structure.uidl.root?.importDefinitions || {}),
        ...JS_EXECUTION_DEPENDENCIES[structure.strategy.id],
      }
    }

    Object.values(structure.uidl?.components || {}).forEach((componentUIDL) => {
      const isJSNodeProcessed = this.traverseComponentUIDL(
        componentUIDL.node,
        structure.strategy.id
      )

      if (isJSNodeProcessed) {
        structure.uidl.root.importDefinitions = {
          ...(structure.uidl.root?.importDefinitions || {}),
          ...JS_EXECUTION_DEPENDENCIES[structure.strategy.id],
        }
      }
    })

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    if (!NODE_MAPPER[structure.strategy.id]) {
      return
    }

    /* tslint:disable no-string-literal */
    delete structure.dependencies['Script']

    if (structure.strategy.id === 'teleport-project-react') {
      structure.dependencies['dangerous-html'] = '^0.1.13'
    }

    return structure
  }
}

export const pluginParseEmbed = new ProjectPluginParseEmbed()
