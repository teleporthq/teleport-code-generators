import {
  GeneratorOptions,
  GeneratedFile,
  ComponentUIDL,
  ProjectUIDL,
  ComponentGenerator,
} from '@teleporthq/teleport-types'

export interface ProjectStrategy {
  components: {
    generator: ComponentGenerator
    options: GeneratorOptions
    path: string[]
  }
  pages: {
    generator: ComponentGenerator
    options: GeneratorOptions
    path: string[]
  }
  router?: {
    generator: (root: ComponentUIDL, options: GeneratorOptions) => Promise<GeneratedFile>
    path: string[]
  }
  entry: {
    generator: (project: ProjectUIDL, options) => Promise<GeneratedFile>
    path: string[]
  }
  static: {
    prefix?: string
    path: string[]
  }
}
