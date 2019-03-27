import createVueGenerator from '../../component-generators/vue/vue-component'
import createVueRouterFileGenerator from '../../component-generators/vue/vue-router'
import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import {
  createManifestJSON,
  createHtmlIndexFile,
  createPackageJSON,
} from '../../shared/utils/project-utils'
import { ASSETS_PREFIX, DEFAULT_OUTPUT_FOLDER, DEFAULT_PACKAGE_JSON } from './constants'
import vueProjectMapping from './vue-project-mapping.json'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const vueGenerator = createVueGenerator({
    customMapping: vueProjectMapping,
  })
  const vueRouterGenerator = createVueRouterFileGenerator()

  // Step 1: Building the folder structure (rooted in dist by default) for the Vue project
  const pagesFolder: GeneratedFolder = {
    name: 'views',
    files: [],
    subFolders: [],
  }

  const componentsFolder: GeneratedFolder = {
    name: 'components',
    files: [],
    subFolders: [],
  }

  const srcFolder: GeneratedFolder = {
    name: 'src',
    files: [],
    subFolders: [componentsFolder, pagesFolder],
  }

  const publicFolder: GeneratedFolder = {
    name: 'public',
    files: [],
    subFolders: [],
  }

  const distFolder: GeneratedFolder = {
    name: options.distPath || DEFAULT_OUTPUT_FOLDER,
    files: [],
    subFolders: [srcFolder, publicFolder],
  }

  // Step 2: Initialization with project specific mappings and of other data structures
  const { components, root } = uidl
  const { states } = root.content
  let collectedDependencies = {}
  const result = {
    outputFolder: distFolder,
    assetsPath: 'src' + ASSETS_PREFIX,
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

    publicFolder.files.push(manifestFile)
  }

  const htmlIndexContent = createHtmlIndexFile(uidl, ASSETS_PREFIX)
  if (htmlIndexContent) {
    const htmlFile: GeneratedFile = {
      name: 'index',
      extension: '.html',
      content: htmlIndexContent,
    }

    publicFolder.files.push(htmlFile)
  }

  // Step 4: Routing component (index.js)
  const router = await vueRouterGenerator.generateComponent(root)
  collectedDependencies = { ...collectedDependencies, ...router.externalDependencies }

  const routerFile: GeneratedFile = {
    name: 'router',
    extension: '.js',
    content: router.code,
  }

  srcFolder.files.push(routerFile)

  // Step 5: Iterating through the first level state branches in the root and generating the components in the "/views" folder
  await Promise.all(
    states.map(async (stateBranch) => {
      const { value: pageKey, content: pageContent } = stateBranch

      if (typeof pageKey !== 'string' || typeof pageContent === 'string') {
        return
      }

      const { componentName, fileName } = extractPageMetadata(routerDefinitions, pageKey)
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

      pagesFolder.files.push({
        name: fileName,
        content: pageResult.code,
        extension: '.vue',
      })
    })
  )

  // Step 6: Components are generated into a separate /components folder
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
