import { GeneratedFile, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

export interface ProjectCustomFile {
  name: string
  fileType: string
  content: string
  path: string
}

export class ProjectPluginCustomFiles implements ProjectPlugin {
  files: ProjectCustomFile[] = []
  dependencies: Record<string, string> = {}
  devDependencies: Record<string, string> = {}

  constructor(
    files: ProjectCustomFile[],
    options?: { dependencies: Record<string, string>; devDependencies: Record<string, string> }
  ) {
    this.files.push(...files)
    if (options?.dependencies) {
      this.dependencies = options.dependencies
    }

    if (options?.devDependencies) {
      this.devDependencies = options.devDependencies
    }
  }

  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { files } = structure

    const filesMap = this.files.reduce(
      (acc: Record<string, GeneratedFile[]>, file: ProjectCustomFile) => {
        if (!acc[file.path]) {
          acc[file.path] = []
        }

        acc[file.path].push(file)
        return acc
      },
      {}
    )

    Object.keys(filesMap).forEach((pathId) => {
      files.set(pathId, {
        files: filesMap[pathId].map((file) => {
          return {
            name: file.name,
            fileType: file.fileType,
            content: file.content,
          }
        }),
        path: pathId.split(',').map((str) => str.trim()),
      })
    })

    structure.dependencies = { ...structure.dependencies, ...this.dependencies }
    structure.devDependencies = { ...structure.devDependencies, ...this.devDependencies }

    return structure
  }
}
