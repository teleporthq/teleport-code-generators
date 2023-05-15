import {
  ProjectPlugin,
  ProjectPluginStructure,
  InMemoryFileRecord,
  ProjectStrategy,
} from '@teleporthq/teleport-types'

interface ProjectAssemblyLineResult {
  files: Map<string, InMemoryFileRecord>
  strategy: ProjectStrategy
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
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
      devDependencies: finalStructure.devDependencies,
      strategy: finalStructure.strategy,
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
      uidl: finalStructure.uidl,
      files: finalStructure.files,
      dependencies: finalStructure.dependencies,
      devDependencies: finalStructure.devDependencies,
    }
  }

  public getPlugins() {
    return this.plugins
  }

  public cleanPlugins() {
    this.plugins = []
  }

  public addPlugin(plugin: ProjectPlugin) {
    this.plugins.push(plugin)
  }
}

export default ProjectAssemblyLine
