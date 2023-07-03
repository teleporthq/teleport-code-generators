import { PrettierFormatOptions, UIDLDependency } from '@teleporthq/teleport-types'

export const ASSETS_IDENTIFIER = 'playground_assets'
export const PRETTIER_CONFIG: PrettierFormatOptions = {
  arrowParens: 'always',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
}

export const USE_ROUTER_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/router',
  version: '12.1.0',
  meta: {
    namedImport: true,
  },
}

export const USE_EFFECT_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'react',
  version: '16.8.3',
  meta: {
    namedImport: true,
  },
}

export const USE_STATE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'react',
  version: '16.8.3',
  meta: {
    namedImport: true,
  },
}
