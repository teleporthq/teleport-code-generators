export const CONFIG_FILE_NAME = `teleport.config`
export const CONIFG_FILE_EXTENSION = '.json'
export const DEFAULT_CONFIG_FILE_NAME = `${CONFIG_FILE_NAME}${CONIFG_FILE_EXTENSION}`

export const DEFALT_CONFIG_TEMPLATE: DefaultConfigTemplate = {
  project: {},
  components: {},
}

export const BASE_URL = 'https://us-central1-croapp-dev.cloudfunctions.net/repl-api/'
export const STUDIO_URL = 'https://playground-api-production-v5.services.teleporthq.io/project/'
export const UUDID_REGEX = /[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/gm
export const IGNORE_FOLDERS = ['node_modules', 'dist', 'bin', 'build']
export const IGNORE_EXTENSIONS = ['.json', '.test.js', '.test.ts', '.map', '.d.ts', '.md']
export interface DefaultConfigTemplate {
  project?: {
    url?: string
    projectType?: string
    path?: string
    name?: string
  }
  components: Record<string, { url: string; path: string }>
}
