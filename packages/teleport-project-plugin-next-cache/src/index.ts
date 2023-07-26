import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createNextCacheValidationPlugin } from './component-plugin'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJSPlugin from '@teleporthq/teleport-postprocessor-prettier-js'

export class ProjectPluginNextCache implements ProjectPlugin {
  private routeMapper: Record<string, string[]> = {}
  private cacheHandlerPath: string[] = ['pages', 'api']

  constructor(routeMappings?: Record<string, string[]>, cacheHandlerPath?: string[]) {
    if (routeMappings) {
      this.routeMapper = routeMappings
    }
    if (cacheHandlerPath) {
      this.cacheHandlerPath = cacheHandlerPath
    }
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure
    if ('revalidate' in uidl.resources?.cache) {
      return structure
    }

    const generator = createComponentGenerator()
    generator.addPlugin(
      createNextCacheValidationPlugin({
        routeMappers: this.routeMapper,
        dependency: uidl.resources.cache.dependency,
      })
    )
    generator.addPlugin(importStatementsPlugin)
    generator.addPostProcessor(prettierJSPlugin)

    const { files: cacheHandlerFiles, dependencies: cacheHandlerDependencies } =
      await generator.generateComponent(
        {
          ...uidl.root,
          name: 'revalidate',
        },
        {
          skipValidation: true,
          skipNavlinkResolver: true,
        }
      )

    structure.dependencies = { ...structure.dependencies, ...cacheHandlerDependencies }

    files.set('revalidate', {
      path: this.cacheHandlerPath,
      files: cacheHandlerFiles,
    })

    return structure
  }

  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }
}
