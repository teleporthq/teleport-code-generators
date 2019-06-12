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
    path: string[]
  }
  pages: {
    generator: ComponentGenerator
    path: string[]
    metaDataOptions?: {
      usePathAsFileName?: boolean
      convertDefaultToIndex?: boolean
    }
  }
  router?: {
    generatorFunction: (root: ComponentUIDL, options: GeneratorOptions) => Promise<GeneratedFile>
    path: string[]
  }
  entry: {
    generatorFunction: (project: ProjectUIDL, options: EntryFileOptions) => Promise<GeneratedFile>
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
