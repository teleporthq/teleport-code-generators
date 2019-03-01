import { ComponentPlugin, ComponentPluginFactory } from '../../../shared/types'
import { applyCSSModulesAndGetDeclarations } from './utils'

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
  fileId: 'component-styles',
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

  const reactCSSModules: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { name, meta } = uidl

    const componentChunk = chunks.filter((chunk) => chunk.name === componentChunkName)[0]

    if (!componentChunk) {
      throw new Error(
        `React component chunk with name ${componentChunkName} was reuired and not found.`
      )
    }

    const generatedCSSModuleClasses = applyCSSModulesAndGetDeclarations(uidl.content, {
      nodesLookup: componentChunk.meta.nodesLookup,
      camelCaseClassNames,
    })
    /**
     * If no classes were added, we don't need to import anything or to alter any
     * code
     */
    if (!generatedCSSModuleClasses.length) {
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
      content: generatedCSSModuleClasses.join('\n'),
      meta: {
        fileId,
      },
    })

    return structure
  }

  return reactCSSModules
}

export default createPlugin()
