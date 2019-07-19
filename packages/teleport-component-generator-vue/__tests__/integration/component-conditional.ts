import {
  component,
  definition,
  staticNode,
  dynamicNode,
  elementNode,
  conditionalNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

import { createVueComponentGenerator } from '../../src'

const vueGenerator = createVueComponentGenerator()

const uidl = component(
  'Conditional Component',
  elementNode('container', {}, [
    conditionalNode(
      dynamicNode('state', 'isVisible'),
      elementNode('text', {}, [staticNode('Now you see me!')]),
      true
    ),
    conditionalNode(
      dynamicNode('state', 'isShareable'),
      elementNode('text', {}, [staticNode('I am not shareable!')]),
      false
    ),
  ]),
  {},
  { isVisible: definition('boolean', true), isShareable: definition('boolean', false) }
)

describe('Component with conditional node type', () => {
  it('renders code with condition if value on state is true', async () => {
    const result = await vueGenerator.generateComponent(uidl)
    const code = result.files[0].content

    expect(code).toContain('<span v-if="isVisible">Now you see me!</span>')
  })
  it('renders code with !condition if value on state is false', async () => {
    const result = await vueGenerator.generateComponent(uidl)
    const code = result.files[0].content

    expect(code).toContain('<span v-if="!isShareable">I am not shareable!</span>')
  })
})
