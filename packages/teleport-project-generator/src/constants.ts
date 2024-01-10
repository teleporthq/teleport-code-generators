import { GeneratedFolder } from '@teleporthq/teleport-types'

export const DEFAULT_TEMPLATE: GeneratedFolder = {
  name: 'teleport-project',
  files: [],
  subFolders: [],
}

export const DEFAULT_PACKAGE_JSON = {
  name: 'teleportHQ Project',
  version: '1.0.0',
  description: 'Project generated based on a UIDL document',
}

export const DEFAULT_GITIGNORE = ['node_modules', 'dist', '.env'].join('\n')
export const DEFAULT_ROUTER_FILE_NAME = 'index'
