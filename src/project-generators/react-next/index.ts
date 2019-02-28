import { Folder, File, ProjectGeneratorOptions } from '../types'
import { ReactComponentStylingFlavors } from '../../component-generators/types'
import { ProjectUIDL, ComponentDependency, ComponentUIDL } from '../../uidl-definitions/types'

import { createManifestJSON, createPackageJSON } from '../utils/generator-utils'

import createReactGenerator from '../../component-generators/react/react-component'
import { extractPageMetadata } from '../../component-generators/utils/uidl-utils'

import { createDocumentComponent } from './utils'
import nextMapping from './next-mapping.json'
import { ASSETS_PREFIX, DEFAULT_OUTPUT_FOLDER, DEFAULT_PACKAGE_JSON } from './constants'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.StyledJSX,
    customMapping: nextMapping,
  })

  // Step 1: Building the folder structure (rooted in dist by default) for the Next project
  const pagesFolder: Folder = {
    name: 'pages',
    files: [],
    subFolders: [],
  }

  const componentsFolder: Folder = {
    name: 'components',
    files: [],
    subFolders: [],
  }

  const staticFolder: Folder = {
    name: 'static',
    files: [],
    subFolders: [],
  }

  const distFolder: Folder = {
    name: options.distPath || DEFAULT_OUTPUT_FOLDER,
    files: [],
    subFolders: [pagesFolder, componentsFolder, staticFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  reactGenerator.addMapping(nextMapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  let allDependencies: Record<string, ComponentDependency> = {}
  const { components, root } = uidl
  const states = root.content.states
  const stateDefinitions = root.stateDefinitions

  const result = {
    outputFolder: distFolder,
    assetsPath: ASSETS_PREFIX,
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
    const manifestFile: File = {
      name: 'manifest',
      extension: '.json',
      content: JSON.stringify(manifestJSON, null, 2),
    }

    staticFolder.files.push(manifestFile)
  }

  // The root html file is customized in next via the _document.js page
  const documentComponent = createDocumentComponent(uidl)
  if (documentComponent) {
    const file: File = {
      name: '_document',
      extension: '.js',
      content: documentComponent,
    }

    pagesFolder.files.push(file)
  }

  // Step 4: First level stateBranches are transformed into React components which are placed in the /pages folder
  await Promise.all(
    states.map(async (stateBranch) => {
      const stateName = stateBranch.value as string
      const pageContent = stateBranch.content
      if (typeof pageContent === 'string') {
        return
      }

      const metadata = extractPageMetadata(routerDefinitions, stateName, {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      })

      const pageComponentUIDL: ComponentUIDL = {
        content: pageContent,
        name: metadata.componentName,
      }

      try {
        const compiledComponent = await reactGenerator.generateComponent(pageComponentUIDL, {
          localDependenciesPrefix: '../components/',
          assetsPrefix: ASSETS_PREFIX,
        })

        const file: File = {
          name: metadata.fileName,
          extension: '.js',
          content: compiledComponent.code,
        }

        allDependencies = {
          ...allDependencies,
          ...compiledComponent.dependencies,
        }

        pagesFolder.files.push(file)
      } catch (err) {
        console.warn(stateName, err)
      }
    })
  )

  // Step 5: Components are generated into a separate /components folder
  if (components) {
    await Promise.all(
      Object.keys(components).map(async (componentName) => {
        const component = components[componentName]

        try {
          const compiledComponent = await reactGenerator.generateComponent(component, {
            assetsPrefix: ASSETS_PREFIX,
          })
          const file: File = {
            name: component.name,
            extension: '.js',
            content: compiledComponent.code,
          }

          allDependencies = {
            ...allDependencies,
            ...compiledComponent.dependencies,
          }

          componentsFolder.files.push(file)
        } catch (err) {
          console.warn(componentName, err)
        }
      })
    )
  }

  // Step 6: External dependencies are added to the package.json file from the template project
  const { sourcePackageJson } = options

  const packageJSON = createPackageJSON(
    sourcePackageJson || DEFAULT_PACKAGE_JSON,
    allDependencies,
    {
      projectName: uidl.name,
    }
  )

  const packageFile: File = {
    name: 'package',
    extension: '.json',
    content: JSON.stringify(packageJSON, null, 2),
  }

  distFolder.files.push(packageFile)

  return result
}
