import { PrettierFormatOptions } from '@teleporthq/teleport-types'

export const LOCK_FILE_NAME = `teleport`
export const LOCK_FILE_EXTENSION = 'lock'
export const LOCKFILE = `${LOCK_FILE_NAME}.${LOCK_FILE_EXTENSION}`

export const LOCK_FILE_TEMPLATE: DefaultConfigTemplate = {
  project: {},
  components: {},
}

export const BASE_URL = 'https://us-central1-croapp-dev.cloudfunctions.net/repl-api/'

export const HOST_NAME_MAP: Record<string, string> = {
  'play.teleporthq.io': 'https://playground-api-production-v5.services.teleporthq.io/project',
  'editorcc.teleporthq.io': 'https://playground-api-editor-zx5f37orwa-ew.a.run.app/project',
}

export const UUDID_REGEX =
  /[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/gm
export const IGNORE_FOLDERS = ['node_modules', 'dist', 'bin', 'build']
export const IGNORE_EXTENSIONS = ['.json', '.test.js', '.test.ts', '.map', '.d.ts', '.md']
export interface DefaultConfigTemplate {
  project?: {
    url?: string
    projectType?: string
    path?: string
  }
  components: Record<string, { url: string; path: string }>
  format?: {
    config?: PrettierFormatOptions
    ignoreFiles?: string[]
    ignoreFolders?: string[]
  }
  sync?: {
    ignoreFiles?: string[]
    ignoreFolders?: string[]
  }
}
