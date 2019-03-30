import { createManifestJSON, createPackageJSON } from '../../shared/utils/project-utils'

import createReactGenerator, {
  ReactComponentStylingFlavors,
} from '../../component-generators/react/react-component'
import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'

import { createDocumentComponent } from './utils'
import nextMapping from './next-mapping.json'
import { ASSETS_PREFIX, DEFAULT_OUTPUT_FOLDER, DEFAULT_PACKAGE_JSON } from './constants'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const reactGenerator = createReactGenerator({
    variation: ReactComponentStylingFlavors.StyledJSX,
  })

  // Step 1: Building the folder structure (rooted in dist by default) for the Next project
  const pagesFolder: GeneratedFolder = {
    name: 'pages',
    files: [],
    subFolders: [],
  }

  const componentsFolder: GeneratedFolder = {
    name: 'components',
    files: [],
    subFolders: [],
  }

  const staticFolder: GeneratedFolder = {
    name: 'static',
    files: [],
    subFolders: [],
  }

  const distFolder: GeneratedFolder = {
    name: options.distPath || DEFAULT_OUTPUT_FOLDER,
    files: [],
    subFolders: [pagesFolder, componentsFolder, staticFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  reactGenerator.addMapping(nextMapping as Mapping)
  if (options.customMapping) {
    reactGenerator.addMapping(options.customMapping)
  }

  let collectedDependencies: Record<string, string> = {}
  const { components, root } = uidl
  const states = root.content.states
  const stateDefinitions = root.stateDefinitions

  const result = {
    outputFolder: distFolder,
    assetsPath: ASSETS_PREFIX.slice(1),
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

  // The root html file is customized in next via the _document.js page
  const documentComponent = createDocumentComponent(uidl)
  if (documentComponent) {
    const file: GeneratedFile = {
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

        const file: GeneratedFile = {
          name: metadata.fileName,
          extension: '.js',
          content: compiledComponent.code,
        }

        collectedDependencies = {
          ...collectedDependencies,
          ...compiledComponent.externalDependencies,
        }

        pagesFolder.files.push(file)
      } catch (err) {
        console.warn(`Error on generating ${stateName} page `, err)
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
          const file: GeneratedFile = {
            name: sanitizeVariableName(component.name),
            extension: '.js',
            content: compiledComponent.code,
          }

          collectedDependencies = {
            ...collectedDependencies,
            ...compiledComponent.externalDependencies,
          }

          componentsFolder.files.push(file)
        } catch (err) {
          console.warn(`Error on generating ${componentName} component `, err)
        }
      })
    )
  }

  // Step 6: External dependencies are added to the package.json file from the template project
  const { sourcePackageJson } = options

  const packageJSON = createPackageJSON(sourcePackageJson || DEFAULT_PACKAGE_JSON, {
    projectName: uidl.name,
    dependencies: collectedDependencies,
  })

  const packageFile: GeneratedFile = {
    name: 'package',
    extension: '.json',
    content: JSON.stringify(packageJSON, null, 2),
  }

  distFolder.files.push(packageFile)

  return result
}
