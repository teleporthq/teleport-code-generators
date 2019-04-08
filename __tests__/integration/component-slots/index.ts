import {
  component,
  staticNode,
  slotNode,
  elementNode,
} from '../../../src/shared/builders/uidl-builders'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'

const reactGenerator = createReactComponentGenerator()
const vueGenerator = createVueComponentGenerator()

describe('Component Slot Node', () => {
  describe('Simple Slot', () => {
    const uidl = component('Simple Slot', elementNode('container', {}, [slotNode()]))

    it('renders props.children in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children}')
    })

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

    it('renders props.children and placeholder in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children || <span>Placeholder</span>}')
    })

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

    it('renders props.children in React', async () => {
      const result = await reactGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('{props.children}')
    })

    it('renders a <slot name="name"> tag in Vue', async () => {
      const result = await vueGenerator.generateComponent(uidl)
      const code = result.files[0].content

      expect(code).toContain('<slot name="slot-1"></slot>')
    })
  })
})
