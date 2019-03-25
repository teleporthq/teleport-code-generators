import reactProjectMapping from './react-project-mapping.json'

import createRouterComponentGenerator from '../../component-generators/react/react-router'
import createReactGenerator, {
  ReactComponentStylingFlavors,
} from '../../component-generators/react/react-component'

import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import { createPackageJSON, createManifestJSON } from '../../shared/utils/project-utils'

import { createHtmlIndexFile } from './utils'
import { ASSETS_PREFIX, DEFAULT_OUTPUT_FOLDER, DEFAULT_PACKAGE_JSON } from './constants'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.CSSModules,
  })

  const routingComponentGenerator = createRouterComponentGenerator()

  // Step 1: Building the folder structure (rooted in dist by default) for the React project
  const componentsFolder: GeneratedFolder = {
    name: 'components',
    files: [],
    subFolders: [],
  }

  const pagesFolder: GeneratedFolder = {
    name: 'pages',
    files: [],
    subFolders: [],
  }

  const staticFolder: GeneratedFolder = {
    name: 'static',
    files: [],
    subFolders: [],
  }

  const srcFolder: GeneratedFolder = {
    name: 'src',
    files: [],
    subFolders: [componentsFolder, pagesFolder, staticFolder],
  }

  const distFolder: GeneratedFolder = {
    name: options.distPath || DEFAULT_OUTPUT_FOLDER,
    files: [],
    subFolders: [srcFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  reactGenerator.addMapping(reactProjectMapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  let collectedDependencies: Record<string, string> = {}
  const { components = {}, root } = uidl
  const { states } = root.content
  const stateDefinitions = root.stateDefinitions

  const result = {
    outputFolder: distFolder,
    assetsPath: 'src' + ASSETS_PREFIX,
  }

  if (!states || !stateDefinitions) {
    return result
  }

  const routerDefinitions = stateDefinitions.router
  if (!routerDefinitions) {
    return result
  }

  // Step 3: Global settings are transformed into the root html file and the manifest file for PWA support
  if (uidl.globals.manifest) {
    const manifestJSON = createManifestJSON(uidl.globals.manifest, uidl.name, ASSETS_PREFIX)
    const manifestFile: GeneratedFile = {
      name: 'manifest',
      extension: '.json',
      content: JSON.stringify(manifestJSON, null, 2),
    }

    staticFolder.files.push(manifestFile)
  }

  const htmlIndexContent = createHtmlIndexFile(uidl)
  if (htmlIndexContent) {
    const htmlFile: GeneratedFile = {
      name: 'index',
      extension: '.html',
      content: htmlIndexContent,
    }

    srcFolder.files.push(htmlFile)
  }

  // Step 4: Routing component (index.js)
  // Avoid leaky memory reference because the root is parsed once here and then each branch is parsed below
  const routingComponent = await routingComponentGenerator.generateComponent(root)

  srcFolder.files.push({
    name: 'index',
    extension: '.js',
    content: routingComponent.code,
  })

  collectedDependencies = {
    ...collectedDependencies,
    ...routingComponent.externalDependencies,
  }

  // Step 5: Iterating through the first level state branches in the root and generating the components in the "/pages" folder
  await Promise.all(
    states.map(async (stateBranch) => {
      const { value: pageKey, content: pageContent } = stateBranch

      if (typeof pageKey !== 'string' || typeof pageContent === 'string') {
        return
      }

      // fileName and componentName may be overridden from the UIDL meta when defining the state keys/branches
      const { componentName, fileName } = extractPageMetadata(routerDefinitions, pageKey)
      const pageComponent = {
        name: componentName,
        content: pageContent,
        meta: {
          fileName,
        },
      }

      const compiledComponent = await reactGenerator.generateComponent(pageComponent, {
        localDependenciesPrefix: '../components/',
        assetsPrefix: ASSETS_PREFIX,
      })

      let cssFile: GeneratedFile | null = null
      if (compiledComponent.externalCSS) {
        cssFile = {
          name: fileName,
          extension: '.css',
          content: compiledComponent.externalCSS,
        }

        pagesFolder.files.push(cssFile)
      }

      const jsFile: GeneratedFile = {
        name: fileName,
        extension: '.js',
        content: compiledComponent.code,
      }

      collectedDependencies = {
        ...collectedDependencies,
        ...compiledComponent.externalDependencies,
      }

      pagesFolder.files.push(jsFile)
    })
  )

  // Step 6: Components are generated into a separate /components folder
  await Promise.all(
    Object.keys(components).map(async (componentName) => {
      const component = components[componentName]
      const compiledComponent = await reactGenerator.generateComponent(component, {
        assetsPrefix: ASSETS_PREFIX,
      })

      let cssFile: GeneratedFile | null = null
      if (compiledComponent.externalCSS) {
        cssFile = {
          name: sanitizeVariableName(component.name),
          extension: '.css',
          content: compiledComponent.externalCSS,
        }

        componentsFolder.files.push(cssFile)
      }

      const jsFile: GeneratedFile = {
        name: sanitizeVariableName(component.name),
        extension: '.js',
        content: compiledComponent.code,
      }

      collectedDependencies = {
        ...collectedDependencies,
        ...compiledComponent.externalDependencies,
      }

      componentsFolder.files.push(jsFile)
    })
  )

  // Step 7: External dependencies are added to the package.json file from the template project
  const { sourcePackageJson } = options

  const packageJSON = createPackageJSON(sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    dependencies: collectedDependencies,
    projectName: uidl.name,
  })

  const packageFile: GeneratedFile = {
    name: 'package',
    extension: '.json',
    content: JSON.stringify(packageJSON, null, 2),
  }

  distFolder.files.push(packageFile)

  return result
}
