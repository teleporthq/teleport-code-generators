import * as t from '@babel/types'
import { ParsedASTNode } from '../../shared/utils/ast-js-utils'
import { cammelCaseToDashCase, stringToCamelCase } from '../../shared/utils/string-utils'
import { addJSXTagStyles, addDynamicAttributeOnTag } from '../../shared/utils/ast-jsx-utils'
import {
  traverseNodes,
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  transformDynamicStyles,
} from '../../shared/utils/uidl-utils'
import { createCSSClass } from '../../shared/utils/jss-utils'

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
  fileId: 'cssmodule',
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

    traverseNodes(uidl.content, (node) => {
      const { style, key } = node
      if (style) {
        const root = astNodesLookup[key]
        const className = cammelCaseToDashCase(key)
        const classNameInJS = stringToCamelCase(className)
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const inlineStyles = transformDynamicStyles(
            rootStyles,
            (styleValue) =>
              new ParsedASTNode(
                t.arrowFunctionExpression(
                  [t.identifier('props')],
                  t.memberExpression(t.identifier('props'), t.identifier(styleValue.content.id))
                )
              )
          )

          addJSXTagStyles(root, inlineStyles)
        }

        cssClasses.push(createCSSClass(className, staticStyles))

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
    const cssFileName = (meta && meta.fileName) || name
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
