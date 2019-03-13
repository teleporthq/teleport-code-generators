import { File, Folder, ProjectGeneratorOptions } from '../../shared/types'
import { ProjectUIDL } from '../../uidl-definitions/types'
import { extractPageMetadata } from '../../shared/utils/uidl-utils'
import { sanitizeVariableName } from '../../shared/utils/string-utils'
import createVueGenerator from '../../component-generators/vue/vue-component'
import nuxtMapping from './nuxt-mapping.json'

export default async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
  // Step 0: Create component generators, this will be removed later when we have factory functions for proj generators
  const vueGenerator = createVueGenerator({
    customMapping: { ...nuxtMapping },
  })

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

  const distFolder: Folder = {
    name: options.distPath || 'dist',
    files: [],
    subFolders: [pagesFolder, componentsFolder],
  }

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

  // Handling the route component which specifies which components are pages
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

      const file: File = {
        name: fileName,
        content: pageResult.code,
        extension: '.vue',
      }

      pagesFolder.files.push(file)
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

        const file: File = {
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

    const packageFile: File = {
      name: 'package',
      extension: '.json',
      content: JSON.stringify(sourcePackageJson, null, 2),
    }

    distFolder.files.push(packageFile)
  }

  return result
}
