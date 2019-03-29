// Different project flavor creators
export { default as createReactBasicGenerator } from './project-generators/react-basic'
export { default as createReactNextGenerator } from './project-generators/react-next'
export { default as createVueBasicGenerator } from './project-generators/vue-basic'
export { default as createVueNuxtGenerator } from './project-generators/vue-nuxt'

// Factory functions for the component generators
export {
  default as createReactComponentGenerator,
} from './component-generators/react/react-component'
export { default as createVueComponentGenerator } from './component-generators/vue/vue-component'
