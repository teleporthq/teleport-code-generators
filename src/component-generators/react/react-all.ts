import { AssemblyLine, Builder, Resolver } from '../pipeline'

import { createPlugin as reactComponent } from '../plugins/react/react-base-component'
import { createPlugin as reactStyledJSX } from '../plugins/react/react-styled-jsx'
import { createPlugin as reactJSS } from '../plugins/react/react-jss'
import { createPlugin as reactInlineStyles } from '../plugins/react/react-inline-styles'
import { createPlugin as reactPropTypes } from '../plugins/react/react-proptypes'
import { createPlugin as importStatements } from '../plugins/common/import-statements'
import { createPlugin as reactCSSModules } from '../plugins/react/react-css-modules'

import htmlMapping from '../../uidl-definitions/elements-mapping/html-mapping.json'
import reactMapping from './react-mapping.json'
import { ComponentPlugin, ReactComponentStylingFlavors } from '../types'
import { ComponentUIDL, ElementsMapping } from '../../uidl-definitions/types'

const configuredReactJSX = reactComponent({
  componentChunkName: 'react-component',
  importChunkName: 'import-libs',
  exportChunkName: 'export',
})

const configuredReactStyledJSX = reactStyledJSX({
  componentChunkName: 'react-component',
})

const configuredReactJSS = reactJSS({
  componentChunkName: 'react-component',
  importChunkName: 'import-libs',
  exportChunkName: 'export',
})

const configuredReactInlineStyles = reactInlineStyles({
  componentChunkName: 'react-component',
})

const configuredPropTypes = reactPropTypes({
  componentChunkName: 'react-component',
})

const configureImportStatements = importStatements({
  importLibsChunkName: 'import-libs',
})

const configuredReactCSSModules = reactCSSModules({
  componentChunkName: 'react-component',
})

const stylePlugins: Record<string, ComponentPlugin> = {
  [ReactComponentStylingFlavors.InlineStyles]: configuredReactInlineStyles,
  [ReactComponentStylingFlavors.StyledJSX]: configuredReactStyledJSX,
  [ReactComponentStylingFlavors.JSS]: configuredReactJSS,
  [ReactComponentStylingFlavors.CSSModules]: configuredReactCSSModules,
}

/**
 * Runs a component pipeline and generates all the necessary parts (ex: js, css) as well as the list of dependencies
 * @param uidl input component uidl
 * @param variation decides the style plugin which would be applied (InlineStyles, StyledJSX, JSS, CSSModules)
 * @param customMapping custom elements mapping which is added on top of the standard mapping
 */
const generateComponent = async (
  uidl: ComponentUIDL,
  variation: string = 'InlineStyles',
  customMapping: ElementsMapping = {}
) => {
  const stylePlugin = stylePlugins[variation]
  const resolver = new Resolver({
    ...htmlMapping,
    ...reactMapping,
    ...customMapping,
  })
  const assemblyLine = new AssemblyLine([
    configuredReactJSX,
    stylePlugin,
    configuredPropTypes,
    configureImportStatements,
  ])
  const chunksLinker = new Builder()

  const resolvedUidl = resolver.resolveUIDL(uidl)
  const result = await assemblyLine.run(resolvedUidl)
  const chunksByFileId = assemblyLine.groupChunksByFileId(result.chunks)

  const code = chunksLinker.link(chunksByFileId.default)
  const css = chunksLinker.link(chunksByFileId['component-styles'])

  return {
    code,
    css,
    dependencies: result.dependencies,
  }
}

export default generateComponent
