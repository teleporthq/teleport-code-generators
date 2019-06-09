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
    files?: GeneratedFile[]
  }
  pages: {
    generator: ComponentGenerator
    options: GeneratorOptions
    path: string[]
    files?: GeneratedFile[]
  }
  routes?: {
    generator: (root: ComponentUIDL, options: GeneratorOptions) => Promise<GeneratedFile>
    path: string[]
    file?: GeneratedFile
  }
  entry?: {
    generator: (project: ProjectUIDL, options) => Promise<GeneratedFile> // TODO: options?
    path: string[]
    file?: GeneratedFile
  }
  assets?: {
    prefix: string
    path: string[] // TODO: check what we return at the end
  }
}
