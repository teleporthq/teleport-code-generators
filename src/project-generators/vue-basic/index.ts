import createVueGenerator from '../../component-generators/vue/vue-component'
import {
  createPageOutputs,
  createComponentOutputs,
  joinGeneratorOutputs,
  createManifestJSONFile,
  createHtmlIndexFile,
  createPackageJSONFile,
} from '../../shared/utils/project-utils'

import {
  ASSETS_PREFIX,
  LOCAL_DEPENDENCIES_PREFIX,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_PACKAGE_JSON,
} from './constants'
import vueProjectMapping from './vue-project-mapping.json'
import { FILE_EXTENSIONS } from '../../shared/constants'
import { createRouterFile, buildFolderStructure } from './utils'
import { extractRoutes } from '../../shared/utils/uidl-utils'

const initGenerator = (options: ProjectGeneratorOptions): ComponentGenerator => {
  const vueGenerator = createVueGenerator({
    mapping: vueProjectMapping as Mapping,
  })

  if (options.customMapping) {
    vueGenerator.addMapping(options.customMapping)
  }

  return vueGenerator
}

const createVueBasicGenerator = (generatorOptions: ProjectGeneratorOptions = {}) => {
  const vueGenerator = initGenerator(generatorOptions)

  const addCustomMapping = (mapping: Mapping) => {
    vueGenerator.addMapping(mapping)
  }

  const generateProject = async (uidl: ProjectUIDL, options: ProjectGeneratorOptions = {}) => {
    // Step 0: Add any custom mappings found in the options
    if (options.customMapping) {
      addCustomMapping(options.customMapping)
    }

    const { components = {}, root } = uidl
    const routes = extractRoutes(root)

    // Step 1: The first level conditional nodes are taken as project pages
    const pagePromises = routes.map((routeNode) => {
      const { value, node } = routeNode.content
      const pageName = value.toString()

      const componentUIDL: ComponentUIDL = {
        name: pageName,
        node,
        stateDefinitions: root.stateDefinitions,
      }

      const pageParams: ComponentFactoryParams = {
        componentGenerator: vueGenerator,
        componentUIDL,
        componentExtension: FILE_EXTENSIONS.VUE,
        componentOptions: {
          assetsPrefix: ASSETS_PREFIX,
          localDependenciesPrefix: LOCAL_DEPENDENCIES_PREFIX,
        },
      }
      return createPageOutputs(pageParams)
    })

    // Step 2: The components generation process is started
    const componentPromises = Object.keys(components).map((componentName) => {
      const componentUIDL = components[componentName]
      const componentParams: ComponentFactoryParams = {
        componentUIDL,
        componentGenerator: vueGenerator,
        componentExtension: FILE_EXTENSIONS.VUE,
        componentOptions: { assetsPrefix: ASSETS_PREFIX },
      }

      return createComponentOutputs(componentParams)
    })

    // Step 3: The process of creating the pages and the components is awaited
    const createdPageFiles = await Promise.all(pagePromises)
    const createdComponentFiles = await Promise.all(componentPromises)

    // Step 4: The generated page and component files are joined
    const joinedPageFiles = joinGeneratorOutputs(createdPageFiles)
    const pageFiles: GeneratedFile[] = [].concat(joinedPageFiles.files)

    const joinedComponentFiles = joinGeneratorOutputs(createdComponentFiles)
    const componentFiles = joinedComponentFiles.files

    // Step 5: Global settings are transformed into the root html file and the manifest file for PWA support
    const publicFiles: GeneratedFile[] = []
    if (uidl.globals.manifest) {
      const manifestFile = createManifestJSONFile(uidl, ASSETS_PREFIX)
      publicFiles.push(manifestFile)
    }

    const htmlIndexFile = createHtmlIndexFile(uidl, { assetsPrefix: ASSETS_PREFIX })
    publicFiles.push(htmlIndexFile)

    // Step 6: Create the routing component (router.js)
    const { routerFile, externalDependencies } = await createRouterFile(root)
    const srcFiles: GeneratedFile[] = [].concat(routerFile)

    const collectedDependencies = {
      ...externalDependencies,
      ...joinedPageFiles.dependencies,
      ...joinedComponentFiles.dependencies,
    }

    // Step 7: External dependencies are added to the package.json file from the template project
    const packageJSONFile = createPackageJSONFile(
      options.sourcePackageJson || DEFAULT_PACKAGE_JSON,
      {
        dependencies: collectedDependencies,
        projectName: uidl.name,
      }
    )
    const distFiles = [packageJSONFile]

    // Step 8: Build the folder structure
    const folderStructure = buildFolderStructure(
      {
        pages: pageFiles,
        components: componentFiles,
        public: publicFiles,
        src: srcFiles,
        dist: distFiles,
      },
      options.distPath || DEFAULT_OUTPUT_FOLDER
    )

    return {
      outputFolder: folderStructure,
      assetsPath: 'src' + ASSETS_PREFIX,
    }
  }

  return {
    addCustomMapping,
    generateProject,
  }
}

export default createVueBasicGenerator
