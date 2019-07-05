import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'

import prettierTS from '@teleporthq/teleport-postprocessor-prettier-ts'

export const createAngularComponentGenerator = () => {
  const generator = createComponentGenerator()

  generator.addPlugin(angularComponentPlugin)

  generator.addPostProcessor(prettierTS)

  return generator
}
