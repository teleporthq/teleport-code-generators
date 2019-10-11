import { component, staticNode, slotNode, elementNode } from '@teleporthq/teleport-uidl-builders'

import { createReactComponentGenerator } from '../../src'

const reactGenerator = createReactComponentGenerator()

describe('Component Slot Node', () => {
  describe('Simple Slot', () => {
    const uidl = component('Simple Slot', elementNode('container', {}, [slotNode()]))

    it('renders props.children in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children}')
    })
  })

  describe('Slot with fallback', () => {
    const uidl = component(
      'Slot Component',
      elementNode('container', {}, [slotNode(elementNode('text', {}, [staticNode('Placeholder')]))])
    )

    it('renders props.children and placeholder in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children || <span>Placeholder</span>}')
    })
  })

  describe('Slot with name', () => {
    const uidl = component(
      'Slot Component',
      elementNode('container', {}, [slotNode(undefined, 'slot-1')])
    )

    it('renders props.children in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children}')
    })
  })
})
