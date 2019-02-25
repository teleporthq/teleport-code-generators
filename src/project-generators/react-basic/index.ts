import reactProjectMapping from './elements-mapping.json'

import createRouterComponentGenerator from '../../component-generators/react/react-router'
import createReactGenerator from '../../component-generators/react/react-component'
import { ReactComponentStylingFlavors } from '../../component-generators/types'
import { extractPageMetadata } from '../../component-generators/utils/uidl-utils'

import { extractExternalDependencies, createManifestJSON } from '../utils/generator-utils'

import { File, Folder, ProjectGeneratorOptions } from '../types'
import { ProjectUIDL, ComponentDependency } from '../../uidl-definitions/types'
import { createHtmlIndexFile } from './utils'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.CSSModules,
  })

  const routingComponentGenerator = createRouterComponentGenerator()

  // Step 1: Building the folder structure (rooted in dist by default) for the React project
  const componentsFolder: Folder = {
    name: 'components',
    files: [],
    subFolders: [],
  }

  const pagesFolder: Folder = {
    name: 'pages',
    files: [],
    subFolders: [],
  }

  const staticFolder: Folder = {
    name: 'static',
    files: [],
    subFolders: [],
  }

  const srcFolder: Folder = {
    name: 'src',
    files: [],
    subFolders: [componentsFolder, pagesFolder, staticFolder],
  }

  const distFolder: Folder = {
    name: options.distPath || 'dist',
    files: [],
    subFolders: [srcFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  reactGenerator.addMapping(reactProjectMapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  let allDependencies: Record<string, ComponentDependency> = {}
  const { components = {}, root } = uidl
  const { states } = root.content
  const stateDefinitions = root.stateDefinitions
  const assetsPrefix = '/static'

  const result = {
    outputFolder: distFolder,
    assetsPath: assetsPrefix,
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
    const manifestJSON = createManifestJSON(uidl.globals.manifest, uidl.name)
    const manifestFile: File = {
      name: 'manifest',
      extension: '.json',
      content: JSON.stringify(manifestJSON, null, 2),
    }

    staticFolder.files.push(manifestFile)
  }

  const htmlIndexContent = createHtmlIndexFile(uidl)
  if (htmlIndexContent) {
    const htmlFile: File = {
      name: 'index',
      extension: '.html',
      content: htmlIndexContent,
    }

    srcFolder.files.push(htmlFile)
  }

  // Step 4: Routing component (index.js)
  // Avoid leaky memory reference because the root is parsed once here and then each branch is parsed below
  const rootCopy = JSON.parse(JSON.stringify(root))
  const routingComponent = await routingComponentGenerator.generateComponent(rootCopy)

  srcFolder.files.push({
    name: 'index',
    extension: '.js',
    content: routingComponent.code,
  })

  allDependencies = {
    ...allDependencies,
    ...routingComponent.dependencies,
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
      })

      let cssFile: File | null = null
      if (compiledComponent.externalCSS) {
        cssFile = {
          name: fileName,
          extension: '.css',
          content: compiledComponent.externalCSS,
        }

        pagesFolder.files.push(cssFile)
      }

      const jsFile: File = {
        name: fileName,
        extension: '.js',
        content: compiledComponent.code,
      }

      allDependencies = {
        ...allDependencies,
        ...compiledComponent.dependencies,
      }

      pagesFolder.files.push(jsFile)
    })
  )

  // Step 6: Components are generated into a separate /components folder
  await Promise.all(
    Object.keys(components).map(async (componentName) => {
      const component = components[componentName]
      const compiledComponent = await reactGenerator.generateComponent(component)

      let cssFile: File | null = null
      if (compiledComponent.externalCSS) {
        cssFile = {
          name: component.name,
          extension: '.css',
          content: compiledComponent.externalCSS,
        }

        componentsFolder.files.push(cssFile)
      }

      const jsFile: File = {
        name: component.name,
        extension: '.js',
        content: compiledComponent.code,
      }

      allDependencies = {
        ...allDependencies,
        ...compiledComponent.dependencies,
      }

      componentsFolder.files.push(jsFile)
    })
  )

  // Step 7: External dependencies are added to the package.json file from the template project
  const { sourcePackageJson } = options
  if (sourcePackageJson) {
    const externalDep = extractExternalDependencies(allDependencies)

    sourcePackageJson.dependencies = {
      ...sourcePackageJson.dependencies,
      ...externalDep,
    }

    const packageFile: File = {
      name: 'package',
      extension: '.json',
      content: JSON.stringify(sourcePackageJson, null, 2),
    }

    distFolder.files.push(packageFile)
  }

  return result
}
