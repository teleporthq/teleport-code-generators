import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createNextCacheValidationPlugin } from './component-plugin'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJSPlugin from '@teleporthq/teleport-postprocessor-prettier-js'

export class ProjectPluginRevalidateAPI implements ProjectPlugin {
  private routeMappers: Record<string, string[]> = {}
  private cacheHandlerPath: string[] = ['pages', 'api']
  private cacheHandlerSecret: string | null = null

  constructor(
    params: {
      routeMappers?: Record<string, string[]>
      cacheHandlerPath?: string[]
      cacheHandlerSecret?: string
    } = {}
  ) {
    const { routeMappers, cacheHandlerPath, cacheHandlerSecret } = params
    if (routeMappers) {
      this.routeMappers = routeMappers
    }
    if (cacheHandlerPath) {
      this.cacheHandlerPath = cacheHandlerPath
    }

    if (cacheHandlerSecret) {
      this.cacheHandlerSecret = cacheHandlerSecret
    }
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure
    if (!uidl.resources.cache?.webhook?.dependency) {
      return structure
    }
    const generator = createComponentGenerator()
    generator.addPlugin(
      createNextCacheValidationPlugin({
        routeMappers: this.routeMappers,
        cacheHandlerSecret: this.cacheHandlerSecret,
        webhook: uidl.resources.cache.webhook,
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
