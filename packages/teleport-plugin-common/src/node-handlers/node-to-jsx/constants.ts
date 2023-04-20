import { JSXGenerationOptions } from './types'

export const DEFAULT_JSX_OPTIONS: JSXGenerationOptions = {
  dynamicReferencePrefixMap: {
    prop: '',
    state: '',
    local: '',
    ctx: '',
  },
  dependencyHandling: 'import',
  stateHandling: 'mutation',
  slotHandling: 'native',
}
