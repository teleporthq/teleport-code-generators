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
    generatorOptions?: GeneratorOptions
    metaOptions?: Record<string, any>
    path: string[]
  }
  pages: {
    generator: ComponentGenerator
    generatorOptions?: GeneratorOptions
    metaOptions?: Record<string, any>
    path: string[]
  }
  router?: {
    generator: (root: ComponentUIDL, options: GeneratorOptions) => Promise<GeneratedFile>
    path: string[]
  }
  entry: {
    generator: (project: ProjectUIDL, options: EntryFileOptions) => Promise<GeneratedFile>
    path: string[]
  }
  static: {
    prefix?: string
    path: string[]
  }
}

export interface EntryFileOptions {
  assetsPrefix?: string
  appRootOverride?: string
}

export interface ComponentGeneratorOutput {
  files: GeneratedFile[]
  dependencies: Record<string, string>
}

export interface PackageJSON {
  name: string
  description: string
  version: string
  main?: string
  author?: string
  license?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  [key: string]: any
}
