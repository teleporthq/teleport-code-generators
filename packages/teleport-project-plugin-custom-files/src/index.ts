import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
export interface ProjectCustomFile {
  name: string
  fileType?: string
  content: string
  path: string[]
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
      (acc: Record<string, ProjectCustomFile[]>, file: ProjectCustomFile) => {
        const id = file.path.join('-')
        if (!acc[id]) {
          acc[id] = []
        }

        acc[id].push(file)
        return acc
      },
      {}
    )

    Object.keys(filesMap).forEach((pathId) => {
      const path = filesMap[pathId]?.[0]?.path

      if (!path) {
        return
      }

      const mappedFiles = filesMap[pathId].map((file) => {
        return {
          name: file.name,
          content: file.content,
          ...(file?.fileType && { fileType: file.fileType }),
        }
      })

      if (files.get(pathId)) {
        files.get(pathId).files.push(...mappedFiles)
      } else {
        files.set(pathId, {
          files: mappedFiles,
          path,
        })
      }
    })

    structure.dependencies = { ...structure.dependencies, ...this.dependencies }
    structure.devDependencies = { ...structure.devDependencies, ...this.devDependencies }

    return structure
  }
}
