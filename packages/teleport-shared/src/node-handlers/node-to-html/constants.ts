import { HTMLTemplateSyntax } from './types'

// Vue.js template values
export const DEFAULT_TEMPLATE_SYNTAX: HTMLTemplateSyntax = {
  interpolation: (value) => `{{ ${value} }}`,
  eventBinding: (value) => `@${value}`,
  valueBinding: (value) => `:${value}`,
  eventEmmitter: (value) => `this.$emit('${value}')`,
  eventHandlersBindingMode: (value) => value,
  conditionalAttr: 'v-if',
  repeatAttr: 'v-for',
  repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
    const iterator = useIndex ? `(${iteratorName}, index)` : iteratorName
    return `${iterator} in ${iteratedCollection}`
  },
  customElementTagName: (value) => value,
  dependencyHandling: 'import',
}
