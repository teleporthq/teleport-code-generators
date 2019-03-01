import * as UIDLValidators from './uidl-definitions/validators'
import * as UIDLTypes from './uidl-definitions/types'

import * as GeneratorTypes from './shared/types'

// Different project flavor creators
export { default as createReactBasicProject } from './project-generators/react-basic'
export { default as createReactNextProject } from './project-generators/react-next'
export { default as createVueBasicProject } from './project-generators/vue-basic'
export { default as createVueNuxtProject } from './project-generators/vue-nuxt'

// This is temporary function used by the component playground (another project)
// Will probably be replaced by the use of the actual component generators when the interface is final
export { default as createReactComponent } from './component-generators/react/react-all'

// Factory functions for the component generators
export {
  default as createReactComponentGenerator,
} from './component-generators/react/react-component'
export { default as createVueComponentGenerator } from './component-generators/vue/vue-component'

export { UIDLValidators, UIDLTypes, GeneratorTypes }
