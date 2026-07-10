import { Parser, Validator } from '@teleporthq/teleport-uidl-validator'
import { UIDLUtils, StringUtils, GenericUtils } from '@teleporthq/teleport-shared'
import {
  ProjectUIDL,
  ComponentUIDL,
  UIDLConditionalNode,
  UIDLPageOptions,
  UIDLRouteDefinitions,
  UIDLExternalDependency,
} from '@teleporthq/teleport-types'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import { basename } from 'path'
import { NextPartialGeneratorOptions } from './partial'

export interface SplitProjectResult {
  /** Parsed and validated ProjectUIDL */
  projectUIDL: ProjectUIDL
  /** Individual page UIDLs ready for generatePage() */
  pages: ComponentUIDL[]
  /** Individual component UIDLs ready for generateComponent() */
  components: Record<string, ComponentUIDL>
  /** Root UIDL ready for generateStyleSheet() */
  rootUIDL: ComponentUIDL
  /** Shared options to pass when constructing the partial generator */
  sharedOptions: NextPartialGeneratorOptions
  /** Env variables (if any), ready for generateEnvFiles() */
  env?: Record<string, string>
  /** Resource items (if any), ready for generateResource() */
  resources: {
    items: ProjectUIDL['resources']['items']
    mappers: ProjectUIDL['resources']['resourceMappers']
  }
  /** Data sources (if any), ready for resolveDataSourceDependencies() */
  dataSources?: Record<string, any>
}

/**
 * Takes a raw project JSON (or already-parsed ProjectUIDL) and splits it
 * into the individual pieces needed by each NextPartialGenerator method.
 *
 * This replicates the splitting logic from teleport-project-generator's
 * internal createPageUIDLs / prepareComponentOutputOptions / resolveLocalDependencies
 * utilities, so callers can work with partial generation without needing the
 * full project generator pipeline.
 */
export const splitProjectUIDL = (
  input: Record<string, unknown> | ProjectUIDL
): SplitProjectResult => {
  const validator = new Validator()

  // Validate and parse
  const schemaResult = validator.validateProjectSchema(input as Record<string, unknown>)
  if (!schemaResult.valid) {
    throw new Error(`Invalid ProjectUIDL schema: ${schemaResult.errorMsg}`)
  }

  const uidl = Parser.parseProjectJSON(
    (schemaResult.projectUIDL ?? input) as Record<string, unknown>
  )
  const contentResult = validator.validateProjectContent(uidl)
  if (!contentResult.valid) {
    throw new Error(`Invalid ProjectUIDL content: ${contentResult.errorMsg}`)
  }

  const components = { ...(uidl.components || {}) }
  const { styleSetDefinitions = {}, designLanguage } = uidl.root

  // --- Extract pages from the routing definition ---
  const routeNodes = UIDLUtils.extractRoutes(uidl.root)
  const routeDefinition = uidl.root.stateDefinitions.route

  const pages = routeNodes.map((routeNode) => buildPageUIDL(routeNode, uidl, routeDefinition))

  // --- Set output options on components ---
  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const { fileName, componentClassName } = component.outputOptions || {
      fileName: '',
      componentClassName: '',
    }

    const defaultName = 'AppComponent'
    const friendlyName = StringUtils.removeIllegalCharacters(component.name) || defaultName
    const friendlyFileName = fileName || StringUtils.camelCaseToDashCase(friendlyName)
    const friendlyComponentName =
      componentClassName || StringUtils.dashCaseToUpperCamelCase(friendlyName)

    const folderPath = UIDLUtils.getComponentFolderPath(component)

    component.outputOptions = {
      componentClassName: friendlyComponentName,
      fileName: friendlyFileName,
      styleFileName: friendlyFileName,
      templateFileName: friendlyFileName,
      folderPath,
    }
  })

  // --- Resolve local dependency paths between pages and components ---
  const pagesPath = ['pages']
  const componentsPath = ['components']

  pages.forEach((pageUIDL) => {
    const pagePath = UIDLUtils.getComponentFolderPath(pageUIDL)
    const fromPath = pagesPath.concat(pagePath)
    UIDLUtils.traverseElements(pageUIDL.node, (element) => {
      if (element.dependency && element.dependency.type === 'local') {
        resolveLocalDep(element, components, fromPath, componentsPath)
      }
    })
  })

  Object.keys(components).forEach((componentKey) => {
    const component = components[componentKey]
    const componentPath = UIDLUtils.getComponentFolderPath(component)
    const fromPath = componentsPath.concat(componentPath)
    UIDLUtils.traverseElements(component.node, (element) => {
      if (element.dependency && element.dependency.type === 'local') {
        resolveLocalDep(element, components, fromPath, componentsPath)
      }
    })
  })

  // --- Build shared options ---
  const sharedOptions: NextPartialGeneratorOptions = {
    projectRouteDefinition: routeDefinition,
    projectComponents: components,
    ...(designLanguage && { designLanguage }),
    ...(Object.keys(styleSetDefinitions).length > 0 && {
      projectStyleSet: {
        styleSetDefinitions,
        fileName: 'style',
        path: GenericUtils.generateLocalDependenciesPrefix(pagesPath, pagesPath),
        importFile: false,
      },
    }),
    ...(uidl.internationalization && {
      internationalization: {
        main: uidl.internationalization.main,
        languages: uidl.internationalization.languages,
        translations: uidl.internationalization.translations,
      },
    }),
    ...(uidl.dataSources &&
      Object.keys(uidl.dataSources).length > 0 && { dataSources: uidl.dataSources }),
    ...(uidl.forms && { forms: uidl.forms }),
    ...(uidl.workflows && { workflows: uidl.workflows }),
    ...(uidl.resources && {
      resources: {
        items: uidl.resources.items,
        cache: uidl.resources.cache,
        path: ['resources'],
      },
    }),
    assets: { prefix: '' },
  }

  return {
    projectUIDL: uidl,
    pages,
    components,
    rootUIDL: uidl.root,
    sharedOptions,
    env: uidl.globals.env,
    resources: {
      items: uidl.resources?.items || {},
      mappers: uidl.resources?.resourceMappers || {},
    },
    dataSources: uidl.dataSources,
  }
}

// --- Internal helpers (mirrors teleport-project-generator/src/utils.ts) ---

const buildPageUIDL = (
  routeNode: UIDLConditionalNode,
  uidl: ProjectUIDL,
  routeDefinition: UIDLRouteDefinitions
): ComponentUIDL => {
  const { value, node, importDefinitions: rootNodeImportDefinitions } = routeNode.content
  const pageName = value.toString()
  const isHomePage = routeDefinition.defaultValue === pageName
  const pageDefinition = routeDefinition.values.find((route) => route.value === pageName)

  // Next.js uses file-name-based navigation — for nested routes like "posts/Posts",
  // split on "/" and use the last segment as the base file name (mirrors extractPageOptions)
  const splittedRouteName = pageName.split('/')
  const baseRouteName = splittedRouteName.length > 1 ? splittedRouteName.pop() : pageName

  const friendlyStateName = StringUtils.removeIllegalCharacters(baseRouteName) || 'AppPage'
  const friendlyComponentName = StringUtils.dashCaseToUpperCamelCase(friendlyStateName)
  const friendlyFileName = StringUtils.camelCaseToDashCase(friendlyStateName)

  const fileName = isHomePage ? 'index' : basename(friendlyFileName)
  const navLink = pageDefinition?.pageOptions?.fallback
    ? '**'
    : '/' + (isHomePage ? '' : basename(friendlyFileName))

  let pageOptions: UIDLPageOptions = {
    fileName,
    componentName: friendlyComponentName,
    navLink,
    ...(pageDefinition?.pageOptions?.pagination && {
      pagination: pageDefinition.pageOptions.pagination,
    }),
    ...(pageDefinition?.pageOptions?.initialPropsData && {
      initialPropsData: pageDefinition.pageOptions.initialPropsData,
    }),
    ...(pageDefinition?.pageOptions?.initialPathsData && {
      initialPathsData: pageDefinition.pageOptions.initialPathsData,
    }),
  }

  // pageDefinition values have precedence, defaults are fallbacks
  if (pageDefinition?.pageOptions) {
    pageOptions = { ...pageOptions, ...pageDefinition.pageOptions }
  }

  // For Next.js: file-based routing, override fileName based on navLink
  if (pageOptions.fallback) {
    pageOptions.fileName = '404'
  } else if (isHomePage) {
    pageOptions.fileName = 'index'
  } else {
    const navFileName = pageOptions.navLink.replace('/', '')
    pageOptions.fileName = basename(navFileName)
  }

  // Update the route definition with computed page options
  if (pageDefinition) {
    pageDefinition.pageOptions = pageOptions
  }

  const title = (pageDefinition?.seo && pageDefinition.seo.title) || uidl.globals.settings.title
  const seo = { ...pageDefinition?.seo, title }

  const pageContent = node.type === 'element' ? node : elementNode('group', {}, [node])

  // folderPath is derived from the final navLink (which may have been overridden
  // by pageDefinition.pageOptions) — slice off leading "/" and trailing fileName
  const pageUIDL: ComponentUIDL = {
    name: pageOptions.componentName,
    node: pageContent,
    outputOptions: {
      componentClassName: pageOptions.componentName,
      fileName: pageOptions.fileName,
      styleFileName: pageOptions.fileName,
      templateFileName: pageOptions.fileName,
      folderPath: [...pageOptions.navLink.split('/').slice(1, -1)],
      initialPropsData: pageOptions.initialPropsData,
      initialPathsData: pageOptions.initialPathsData,
      detailsPageInfo: pageOptions.detailsPageInfo,
      pagination: pageOptions.pagination,
      pageId: pageDefinition?.pageId,
    },
    propDefinitions: pageOptions.propDefinitions,
    stateDefinitions: pageOptions.stateDefinitions,
    seo,
  }

  // For home page with file-name navigation, attach root import definitions
  if (isHomePage) {
    const { importDefinitions = {} } = uidl.root
    pageUIDL.importDefinitions = Object.keys(importDefinitions).reduce(
      (acc: Record<string, UIDLExternalDependency>, importRef) => {
        // Skip .css imports — those go into _app.js via externalStyles
        if (importDefinitions[importRef].path.endsWith('.css')) {
          return acc
        }
        acc[importRef] = importDefinitions[importRef]
        return acc
      },
      {}
    )
  }

  if (rootNodeImportDefinitions) {
    pageUIDL.importDefinitions = {
      ...pageUIDL.importDefinitions,
      ...rootNodeImportDefinitions,
    }
  }

  return pageUIDL
}

const resolveLocalDep = (
  element: any,
  components: Record<string, ComponentUIDL>,
  fromPath: string[],
  toBasePath: string[]
) => {
  const componentKey = element.semanticType || element.elementType
  const component = components[componentKey]
  if (!component) {
    return
  }

  const componentPath = UIDLUtils.getComponentFolderPath(component)
  const componentClassName = UIDLUtils.getComponentClassName(component)
  const toPath = toBasePath.concat(componentPath)
  const importFileName = UIDLUtils.getComponentFileName(component)
  const importPath = GenericUtils.generateLocalDependenciesPrefix(fromPath, toPath)

  element.dependency.path = `${importPath}${importFileName}`
  element.elementType = 'component'
  element.semanticType = componentClassName
}
