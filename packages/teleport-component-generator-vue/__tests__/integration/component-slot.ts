import {
  component,
  staticNode,
  slotNode,
  elementNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

import { createVueComponentGenerator } from '../../src'

const vueGenerator = createVueComponentGenerator()

describe('Component Slot Node', () => {
  describe('Simple Slot', () => {
    const uidl = component('Simple Slot', elementNode('container', {}, [slotNode()]))

    it('renders a <slot> tag in Vue', async () => {
      const result = await vueGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('<slot></slot>')
    })
  })

  describe('Slot with fallback', () => {
    const uidl = component(
      'Slot Component',
      elementNode('container', {}, [slotNode(elementNode('text', {}, [staticNode('Placeholder')]))])
    )

    it('renders a <slot> tag and placeholder in Vue', async () => {
      const result = await vueGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('<slot><span>Placeholder</span></slot>')
    })
  })

  describe('Slot with name', () => {
    const uidl = component(
      'Slot Component',
      elementNode('container', {}, [slotNode(undefined, 'slot-1')])
    )

    it('renders a <slot name="name"> tag in Vue', async () => {
      const result = await vueGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('<slot name="slot-1"></slot>')
    })
  })
})
