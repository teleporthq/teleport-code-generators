import {
  ProjectPlugin,
  ProjectPluginStructure,
  InMemoryFileRecord,
  ProjectStrategy,
} from '@teleporthq/teleport-types'

class ProjectAssemblyLine {
  private plugins: ProjectPlugin[]

  constructor(plugins: ProjectPlugin[] = []) {
    this.plugins = plugins
  }

  public async runBefore(
    structure: ProjectPluginStructure
  ): Promise<{
    files: Map<string, InMemoryFileRecord>
    dependencies: Record<string, string>
    strategy: ProjectStrategy
  }> {
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
    }
  }

  public async runAfter(
    structure: ProjectPluginStructure
  ): Promise<{ files: Map<string, InMemoryFileRecord>; dependencies: Record<string, string> }> {
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
