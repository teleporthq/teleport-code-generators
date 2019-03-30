import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import createVueGenerator from '../../component-generators/vue/vue-component'
import nuxtMapping from './nuxt-mapping.json'
import { ASSETS_PREFIX, DEFAULT_OUTPUT_FOLDER } from './constants'
import { createManifestJSON, createHtmlIndexFile } from '../../shared/utils/project-utils'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const vueGenerator = createVueGenerator({
    customMapping: nuxtMapping as Mapping,
  })

  // Step 1: Building the folder structure (rooted in dist by default) for the Nuxt project
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
    subFolders: [pagesFolder, componentsFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  const { components, root } = uidl
  const { states } = root.content
  let collectedDependencies = {}
  const result = {
    outputFolder: distFolder,
    assetsPath: ASSETS_PREFIX.slice(1), // remove the leading `/`
  }

  const stateDefinitions = root.stateDefinitions
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

  const htmlIndexContent = createHtmlIndexFile(uidl, ASSETS_PREFIX, '{{ APP }}')
  if (htmlIndexContent) {
    const htmlFile: GeneratedFile = {
      name: 'app',
      extension: '.html',
      content: htmlIndexContent,
    }

    distFolder.files.push(htmlFile)
  }

  // Step 4: Iterating through the first level state branches in the root and generating the components in the "/pages" folder
  await Promise.all(
    states.map(async (stateBranch) => {
      const { value: pageKey, content: pageContent } = stateBranch

      if (typeof pageKey !== 'string' || typeof pageContent === 'string') {
        return
      }

      const { componentName, fileName } = extractPageMetadata(routerDefinitions, pageKey, {
        usePathAsFileName: true,
        convertDefaultToIndex: true,
      })
      const pageComponent = {
        name: componentName,
        content: pageContent,
        meta: {
          fileName,
        },
      }

      const pageResult = await vueGenerator.generateComponent(pageComponent, {
        localDependenciesPrefix: '../components/',
      })

      collectedDependencies = { ...collectedDependencies, ...pageResult.externalDependencies }

      const file: GeneratedFile = {
        name: fileName,
        content: pageResult.code,
        extension: '.vue',
      }

      pagesFolder.files.push(file)
    })
  )

  // Step 5: Components are generated into a separate /components folder
  if (components) {
    const [...generatedComponentFiles] = await Promise.all(
      Object.keys(components).map(async (componentName) => {
        const component = components[componentName]
        const componentResult = await vueGenerator.generateComponent(component)
        collectedDependencies = {
          ...collectedDependencies,
          ...componentResult.externalDependencies,
        }

        const file: GeneratedFile = {
          name: sanitizeVariableName(component.name),
          extension: '.vue',
          content: componentResult.code,
        }
        return file
      })
    )

    componentsFolder.files.push(...generatedComponentFiles)
  }

  // Step 6: External dependencies are added to the package.json file from the template project
  const { sourcePackageJson } = options
  if (sourcePackageJson) {
    sourcePackageJson.dependencies = {
      ...sourcePackageJson.dependencies,
      ...collectedDependencies,
    }

    const packageFile: GeneratedFile = {
      name: 'package',
      extension: '.json',
      content: JSON.stringify(sourcePackageJson, null, 2),
    }

    distFolder.files.push(packageFile)
  }

  return result
}
