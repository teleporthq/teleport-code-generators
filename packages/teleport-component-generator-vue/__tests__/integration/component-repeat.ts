import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

import { createVueComponentGenerator } from '../../src'

const vueGenerator = createVueComponentGenerator()

const uidl = component(
  'Repeat Component',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    ),
  ]),
  { items: definition('array', ['hello', 'world']) },
  {}
)

describe('Component Repeat Node', () => {
  it('renders code that contains map method', async () => {
    const result = await vueGenerator.generateComponent(uidl)
    const code = result.files[0].content

    expect(code).toContain('v-for="(item, index) in items"')
  })

  it('renders code with map method that iterates using index', async () => {
    const result = await vueGenerator.generateComponent(uidl)
    const code = result.files[0].content

    expect(code).toContain(':key="index"')
  })
})
