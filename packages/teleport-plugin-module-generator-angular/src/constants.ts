import { UIDLDependency } from '@teleporthq/teleport-types'

export const DEFAULT_MODULE_CHUNK_NAME = 'ts-module'

export const DEFAULT_MODULE_DECORATOR_CHUNK_NAME = 'module-decorator'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'

export const ANGULAR_CORE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: '@angular/core',
  version: '8.1.0',
  meta: {
    namedImport: true,
  },
}

export const ANGULAR_PLATFORM_BROWSER: UIDLDependency = {
  type: 'library',
  path: '@angular/platform-browser',
  version: '8.1.0',
  meta: {
    namedImport: true,
  },
}

export const ANGULAR_ROUTER: UIDLDependency = {
  type: 'library',
  path: '@angular/router',
  version: '8.1.0',
  meta: {
    namedImport: true,
  },
}

export const ANGULAR_COMMON_MODULE: UIDLDependency = {
  type: 'library',
  path: '@angular/common',
  version: '8.1.0',
  meta: {
    namedImport: true,
  },
}

export const APP_COMPONENT: UIDLDependency = {
  type: 'local',
  path: `./app.component`,
  meta: {
    namedImport: true,
  },
}
