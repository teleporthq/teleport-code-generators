import { ProjectUIDL, ComponentGenerator, ChunkDefinition } from '@teleporthq/teleport-types'

export interface ProjectStrategy {
  components: {
    generator: ComponentGenerator
    path: string[]
    metaDataOptions?: {
      useFolderStructure?: boolean
    }
  }
  pages: {
    generator: ComponentGenerator
    path: string[]
    metaDataOptions?: {
      usePathAsFileName?: boolean
      convertDefaultToIndex?: boolean
      useFolderStructure?: boolean
    }
  }
  router?: {
    generator: ComponentGenerator
    path: string[]
    fileName?: string
    metaDataOptions?: {
      useFolderStructure?: boolean
      disableDOMInjection?: boolean
    }
  }
  entry: {
    generator: ComponentGenerator
    path: string[]
    fileName?: string
    chunkGenerationFunction?: (
      uidl: ProjectUIDL,
      options: EntryFileOptions
    ) => Record<string, ChunkDefinition[]>
    appRootOverride?: string
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
