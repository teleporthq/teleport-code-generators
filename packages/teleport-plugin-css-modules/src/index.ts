import {
  camelCaseToDashCase,
  dashCaseToCamelCase,
} from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import {
  addDynamicAttributeToJSXTag,
  addAttributeToJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import {
  traverseElements,
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  transformDynamicStyles,
  getStyleFileName,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  createCSSClass,
  createDynamicStyleExpression,
} from '@teleporthq/teleport-shared/dist/cjs/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/dist/cjs/utils/jss-utils'

import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface CSSModulesConfig {
  componentChunkName?: string
  styleObjectImportName?: string
  styleChunkName?: string
  camelCaseClassNames?: boolean
  moduleExtension?: boolean
  classAttributeName?: string
}

const defaultConfigProps = {
  componentChunkName: 'jsx-component',
  styleChunkName: 'css-modules',
  styleObjectImportName: 'styles',
  camelCaseClassNames: false,
  moduleExtension: false,
  classAttributeName: 'className',
}

export const createPlugin: ComponentPluginFactory<CSSModulesConfig> = (config = {}) => {
  const {
    componentChunkName,
    styleObjectImportName,
    styleChunkName,
    camelCaseClassNames,
    moduleExtension,
    classAttributeName,
  } = {
    ...defaultConfigProps,
    ...config,
  }

  const cssModulesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]

    if (!componentChunk) {
      throw new Error(
        `JSX based component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    const cssClasses: string[] = []
    const astNodesLookup = componentChunk.meta.nodesLookup || {}
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop

    traverseElements(uidl.node, (element) => {
      const { style, key } = element
      if (style) {
        const root = astNodesLookup[key]
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)

        if (Object.keys(staticStyles).length > 0) {
          const className = camelCaseToDashCase(key)
          const jsFriendlyClassName = dashCaseToCamelCase(className)

          cssClasses.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

          // When the className is equal to the jsFriendlyClassName, it can be safely addressed with `styles.<className>`
          const classNameIsJSFriendly = className === jsFriendlyClassName
          const classReferenceIdentifier =
            camelCaseClassNames || classNameIsJSFriendly
              ? `styles.${jsFriendlyClassName}`
              : `styles['${className}']`

          addDynamicAttributeToJSXTag(root, classAttributeName, classReferenceIdentifier)
        }

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) =>
            createDynamicStyleExpression(styleValue, propsPrefix)
          )

          // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
          if (Object.keys(inlineStyles).length > 0) {
            addAttributeToJSXTag(root, 'style', inlineStyles)
          }
        }
      }
    })

    /**
     * If no classes were added, we don't need to import anything or to alter any code
     */
    if (!cssClasses.length) {
      return structure
    }

    /**
     * Setup an import statement for the styles
     * The name of the file is either in the meta of the component generator
     * or we fallback to the name of the component
     */
    let cssFileName = getStyleFileName(uidl)

    /**
     * In case the moduleExtension flag is passed, the file name should be in the form [fileName].module.css
     */
    if (moduleExtension) {
      cssFileName = `${cssFileName}.module`
      uidl.outputOptions = uidl.outputOptions || {}
      uidl.outputOptions.styleFileName = cssFileName
    }

    dependencies[styleObjectImportName] = {
      type: 'local',
      path: `./${cssFileName}.${FILE_TYPE.CSS}`,
    }

    structure.chunks.push({
      name: styleChunkName,
      type: CHUNK_TYPE.STRING,
      fileType: FILE_TYPE.CSS,
      content: cssClasses.join('\n'),
      linkAfter: [],
    })

    return structure
  }

  return cssModulesPlugin
}

export default createPlugin()
