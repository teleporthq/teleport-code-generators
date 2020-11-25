import {
  ProjectPlugin,
  ProjectPluginStructure,
  InMemoryFileRecord,
  ProjectStrategy,
  GeneratedFolder,
} from '@teleporthq/teleport-types'

interface ProjectAssemblyLineResult {
  files: Map<string, InMemoryFileRecord>
  dependencies: Record<string, string>
  strategy: ProjectStrategy
  template: GeneratedFolder
}

class ProjectAssemblyLine {
  private plugins: ProjectPlugin[]

  constructor(plugins: ProjectPlugin[] = []) {
    this.plugins = plugins
  }

  public async runBefore(structure: ProjectPluginStructure): Promise<ProjectAssemblyLineResult> {
    const finalStructure = await this.plugins.reduce(
      async (previousPluginOperation: Promise<ProjectPluginStructure>, plugin) => {
        const modifiedStructure = await previousPluginOperation
        return plugin.runBefore(modifiedStructure)
      },
      Promise.resolve(structure)
    )

    return {
      files: finalStructure.files,
      dependencies: finalStructure.dependencies,
      strategy: finalStructure.strategy,
      template: finalStructure.template,
    }
  }

  public async runAfter(
    structure: ProjectPluginStructure
  ): Promise<Omit<ProjectAssemblyLineResult, 'strategy'>> {
    const finalStructure = await this.plugins.reduce(
      async (previousPluginOperation: Promise<ProjectPluginStructure>, plugin) => {
        const modifiedStructure = await previousPluginOperation
        return plugin.runAfter(modifiedStructure)
      },
      Promise.resolve(structure)
    )

    return {
      files: finalStructure.files,
      dependencies: finalStructure.dependencies,
      template: finalStructure.template,
    }
  }

  public getPlugins() {
    return this.plugins
  }

  public addPlugin(plugin: ProjectPlugin) {
    this.plugins.push(plugin)
  }
}

export default ProjectAssemblyLine
