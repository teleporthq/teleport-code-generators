import {
  component,
  definition,
  elementNode,
  staticNode,
  dynamicNode,
  repeatNode,
  conditionalNode,
} from '../src/component-builders'
import { UIDLStaticValue, UIDLElement, UIDLDynamicReference } from '@teleporthq/teleport-types'

describe('UIDL Builders', () => {
  describe('component', () => {
    const dummyNode: UIDLStaticValue = { type: 'static', content: 'test' }

    it('returns a new ComponentUIDL object', () => {
      const testComponent = component('uidl-test', dummyNode)

      expect(testComponent.name).toBe('uidl-test')
      expect(testComponent.node.content).toBe('test')
    })

    it('adds prop and state definitions', () => {
      const testComponent = component(
        'uidl-test',
        dummyNode,
        {
          'test-prop': definition('string', 'empty-string'),
        },
        {
          'test-state': definition('boolean', false),
        }
      )

      expect(testComponent.name).toBe('uidl-test')
      expect(testComponent.node.content).toBe('test')
      expect(testComponent.propDefinitions['test-prop'].defaultValue).toBe('empty-string')
      expect(testComponent.stateDefinitions['test-state'].defaultValue).toBe(false)
    })
  })

  describe('elementNode', () => {
    it('returns a new UIDLElement node', () => {
      const element = elementNode('div', {
        test: staticNode('test-value'),
      })

      expect(element.type).toBe('element')
      expect(element.content.attrs.test.content).toBe('test-value')
    })

    it('adds children inside the root node', () => {
      const element = elementNode('div', {}, [elementNode('span', {})])

      expect(element.type).toBe('element')
      expect(element.content.children[0].type).toBe('element')
    })

    it('adds dependencies', () => {
      const dependency = {
        type: 'package',
        path: 'npm-dependency',
      }

      const element = elementNode('div', {}, [elementNode('span', {})], dependency)

      expect(element.content.dependency.type).toBe('package')
      expect(element.content.dependency.path).toBe('npm-dependency')
    })

    it('adds style', () => {
      const element = elementNode('div', {}, [elementNode('span', {})], null, {
        height: staticNode('100px'),
      })

      expect(element.content.style.height.content).toBe('100px')
    })
  })

  describe('dynamic node', () => {
    it('returns a dynamic node', () => {
      const node = dynamicNode('prop', 'title')

      expect(node.content.id).toBe('title')
      expect(node.content.referenceType).toBe('prop')
    })
  })

  describe('conditional node', () => {
    it('returns a conditional node', () => {
      const node = conditionalNode(dynamicNode('state', 'isVisible'), elementNode('div'), true)

      expect(node.content.value).toBe(true)
      expect((node.content.node.content as UIDLElement).elementType).toBe('div')
      expect(node.content.reference.content.id).toBe('isVisible')
    })
  })

  describe('repeat node', () => {
    it('returns a repeat node', () => {
      const node = repeatNode(elementNode('div'), dynamicNode('prop', 'items'), {
        useIndex: true,
      })

      expect((node.content.dataSource as UIDLDynamicReference).content.id).toBe('items')
      expect((node.content.node.content as UIDLElement).elementType).toBe('div')
      expect(node.content.meta.useIndex).toBe(true)
    })
  })
})
