export const DEFAULT_ANGULAR_TEMPLATE_CHUNK_NAME = 'template-chunk'

export const DEFAULT_ANGULAR_TS_CHUNK_NAME = 'angular-ts-chunk'

export const DEFAULT_ANGULAR_DECORATOR_CHUNK_NAME = 'component-decorator'

export const DEFAULT_TS_CHUNK_AFTER = ['import-lib', 'import-pack', 'import-local']

export const ANGULAR_CORE_DEPENDENCY = {
  type: 'library',
  path: '@angular/core',
  version: '8.1.0',
  meta: {
    namedImport: true,
  },
}
