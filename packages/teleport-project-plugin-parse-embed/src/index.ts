import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ProjectPluginStructure,
  ProjectPlugin,
  UIDLExternalDependency,
  UIDLElementNode,
} from '@teleporthq/teleport-types'

type SUPPORTED_PROJECT_TYPES =
  | 'teleport-project-html'
  | 'teleport-project-react'
  | 'teleport-project-next'

const NODE_MAPPER: Record<SUPPORTED_PROJECT_TYPES, Promise<(content: unknown) => string>> = {
  'teleport-project-html': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-react': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
  'teleport-project-next': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
}

const JS_EXECUTION_DEPENDENCIES: Record<
  SUPPORTED_PROJECT_TYPES,
  Record<string, UIDLExternalDependency>
> = {
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
        importAlias: 'https://unpkg.com/dangerous-html/dist/default/lib.umd.js',
      },
    },
  },
}

export class ProjectPluginParseEmbed implements ProjectPlugin {
  async traverseComponentUIDL(
    node: UIDLElementNode,
    id: SUPPORTED_PROJECT_TYPES
  ): Promise<boolean> {
    const fromHtml = (await import('hast-util-from-html')).fromHtml
    const hastToJsxOrHtml = await NODE_MAPPER[id]

    return new Promise((resolve, reject) => {
      try {
        let shouldAddJSDependency = false
        UIDLUtils.traverseElements(node, async (element) => {
          if (element.elementType === 'html-node' && element.attrs?.html && NODE_MAPPER[id]) {
            const hastNodes = fromHtml(element.attrs.html.content as string, {
              fragment: true,
            })
            const content = hastToJsxOrHtml(hastNodes)

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
        resolve(shouldAddJSDependency)
      } catch (error) {
        reject(error)
      }
    })
  }

  async runBefore(structure: ProjectPluginStructure) {
    const projectType = structure.strategy.id as SUPPORTED_PROJECT_TYPES
    if (!NODE_MAPPER[projectType]) {
      return structure
    }

    const shouldAddJSDependency = await this.traverseComponentUIDL(
      structure.uidl.root.node,
      projectType
    )

    if (shouldAddJSDependency) {
      structure.uidl.root.importDefinitions = {
        ...(structure.uidl.root?.importDefinitions || {}),
        ...JS_EXECUTION_DEPENDENCIES[projectType],
      }
    }

    const components = Object.keys(structure.uidl?.components || {})
    for (let i = 0; i < components.length; i++) {
      const isJSNodeProcessed = await this.traverseComponentUIDL(
        structure.uidl.components[components[i]].node,
        projectType
      )

      if (isJSNodeProcessed) {
        structure.uidl.components[components[i]].importDefinitions = {
          ...(structure.uidl.components[components[i]]?.importDefinitions || {}),
          ...JS_EXECUTION_DEPENDENCIES[projectType],
        }
      }
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    if (!NODE_MAPPER[structure.strategy.id as SUPPORTED_PROJECT_TYPES]) {
      return structure
    }

    /* tslint:disable no-string-literal */
    delete structure.dependencies['Script']

    if (structure.strategy.id === 'teleport-project-react') {
      structure.dependencies['dangerous-html'] = '^0.1.13'
    }

    return structure
  }
}
