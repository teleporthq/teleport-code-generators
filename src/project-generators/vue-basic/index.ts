import createVueGenerator from '../../component-generators/vue/vue-component'
import createVueRouterFileGenerator from '../../component-generators/vue/vue-router'
import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'

import vueProjectMapping from './vue-project-mapping.json'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const vueGenerator = createVueGenerator({
    customMapping: vueProjectMapping,
  })
  const vueRouterGenerator = createVueRouterFileGenerator()

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

  const distFolder: GeneratedFolder = {
    name: options.distPath || 'dist',
    files: [],
    subFolders: [srcFolder],
  }

  // pages are written in /views
  const { components, root } = uidl
  const { states } = root.content
  let collectedDependencies = {}
  const assetsPrefix = '/assets'
  const result = {
    outputFolder: distFolder,
    assetsPath: assetsPrefix,
  }

  const stateDefinitions = root.stateDefinitions
  if (!states || !stateDefinitions) {
    return result
  }

  const routerDefinitions = stateDefinitions.router
  if (!routerDefinitions) {
    return result
  }

  // Router component
  const router = await vueRouterGenerator.generateComponent(root)
  collectedDependencies = { ...collectedDependencies, ...router.externalDependencies }

  const routerFile: GeneratedFile = {
    name: 'router',
    extension: '.js',
    content: router.code,
  }

  srcFolder.files.push(routerFile)

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

  // Package.json
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
