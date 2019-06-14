import * as t from '@babel/types'
import { ParsedASTNode } from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'
import {
  camelCaseToDashCase,
  dashCaseToCamelCase,
} from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  addJSXTagStyles,
  addDynamicAttributeOnTag,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import {
  traverseElements,
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  transformDynamicStyles,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { createCSSClass } from '@teleporthq/teleport-shared/lib/builders/jss-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/lib/utils/jss-utils'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

interface ReactCSSModulesConfig {
  componentChunkName: string
  styleObjectImportName: string
  fileId: string
  styleChunkName: string
  camelCaseClassNames: boolean
}

const defaultConfigProps = {
  componentChunkName: 'react-component',
  styleChunkName: 'css-modules',
  styleObjectImportName: 'styles',
  fileId: FILE_TYPE.CSS,
  camelCaseClassNames: true,
}

export const createPlugin: ComponentPluginFactory<ReactCSSModulesConfig> = (config = {}) => {
  const {
    componentChunkName,
    styleObjectImportName,
    styleChunkName,
    fileId,
    camelCaseClassNames,
  } = {
    ...defaultConfigProps,
    ...config,
  }

  const reactCSSModulesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { name, meta } = uidl

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]

    if (!componentChunk) {
      throw new Error(
        `React component chunk with name ${componentChunkName} was reuired and not found.`
      )
    }

    const cssClasses: string[] = []
    const astNodesLookup = componentChunk.meta.nodesLookup || {}

    traverseElements(uidl.node, (element) => {
      const { style, key } = element
      if (style) {
        const root = astNodesLookup[key]
        const className = camelCaseToDashCase(key)
        const classNameInJS = dashCaseToCamelCase(className)
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) => {
            const expression =
              styleValue.content.referenceType === 'state'
                ? t.identifier(styleValue.content.id)
                : t.memberExpression(t.identifier('props'), t.identifier(styleValue.content.id))
            return new ParsedASTNode(expression)
          })

          addJSXTagStyles(root, inlineStyles)
        }

        cssClasses.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

        const classReferenceIdentifier = camelCaseClassNames
          ? `styles.${classNameInJS}`
          : `styles['${className}']`

        addDynamicAttributeOnTag(root, 'className', classReferenceIdentifier)
      }
    })

    /**
     * If no classes were added, we don't need to import anything or to alter any
     * code
     */
    if (!cssClasses.length) {
      return structure
    }

    /**
     * Setup an import statement for the styles
     * The name of the file is either in the meta of the component generator
     * or we fallback to the name of the component
     */
    const cssFileName = (meta && meta.fileName) || camelCaseToDashCase(name)
    dependencies[styleObjectImportName] = {
      type: 'local',
      path: `./${cssFileName}.css`,
    }

    structure.chunks.push({
      name: styleChunkName,
      type: 'string',
      content: cssClasses.join('\n'),
      meta: {
        fileId,
      },
      linkAfter: [],
    })

    return structure
  }

  return reactCSSModulesPlugin
}

export default createPlugin()
