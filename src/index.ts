import * as UIDLValidators from './uidl-definitions/validators'

// Different project flavor creators
export { default as createReactBasicProject } from './project-generators/react-basic'
export { default as createReactNextProject } from './project-generators/react-next'
export { default as createVueBasicProject } from './project-generators/vue-basic'
export { default as createVueNuxtProject } from './project-generators/vue-nuxt'

// Factory functions for the component generators
export {
  default as createReactComponentGenerator,
} from './component-generators/react/react-component'
export { default as createVueComponentGenerator } from './component-generators/vue/vue-component'

export { UIDLValidators }
