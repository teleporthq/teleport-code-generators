import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'

export const createAngularComponentGenerator = () => {
  const generator = createComponentGenerator()

  generator.addPlugin(angularComponentPlugin)

  return generator
}
