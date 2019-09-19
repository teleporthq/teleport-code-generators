import { PrettierFormatOptions } from '@teleporthq/teleport-types'

export const ASSETS_IDENTIFIER = 'playground_assets'
export const PRETTIER_CONFIG: PrettierFormatOptions = {
  arrowParens: 'always',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
}
