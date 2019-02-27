import { StateDefinition } from '../../uidl-definitions/types'
import { ASSETS_IDENTIFIER } from '../constants'

/**
 * A couple of different cases which need to be handled
 * In case of next/nuxt generators, the file names represent the urls of the pages
 * Also the root path needs to be represented by the index file
 */
export const extractPageMetadata = (
  routerDefinitions: StateDefinition,
  stateName: string,
  options: { usePathAsFileName?: boolean; convertDefaultToIndex?: boolean } = {
    usePathAsFileName: false,
    convertDefaultToIndex: false,
  }
): { fileName: string; componentName: string; path: string } => {
  const defaultPage = routerDefinitions.defaultValue
  const pageDefinitions = routerDefinitions.values || []
  const pageDefinition = pageDefinitions.find((stateDef) => stateDef.value === stateName)

  // If not meta object is defined, the stateName is used
  if (!pageDefinition || !pageDefinition.meta) {
    return {
      fileName: options.convertDefaultToIndex && stateName === defaultPage ? 'index' : stateName,
      componentName: stateName,
      path: '/' + stateName,
    }
  }

  // In case the path is used as the url (next, nuxt), we override the filename from the path
  const fileNameFromMeta = options.usePathAsFileName
    ? pageDefinition.meta.path && pageDefinition.meta.path.slice(1)
    : pageDefinition.meta.fileName

  return {
    fileName:
      options.convertDefaultToIndex && stateName === defaultPage
        ? 'index'
        : fileNameFromMeta || stateName,
    componentName: pageDefinition.meta.componentName || stateName,
    path: pageDefinition.meta.path || '/' + stateName,
  }
}

export const prefixPlaygroundAssetsURL = (prefix: string, originalString: string | undefined) => {
  if (!originalString || !originalString.startsWith(ASSETS_IDENTIFIER)) {
    return originalString
  }

  if (originalString.startsWith('/')) {
    return prefix + originalString
  }

  return `${prefix}/${originalString}`
}
