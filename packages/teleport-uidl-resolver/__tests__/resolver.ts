import Resolver from '../src/resolver'
import mappingJSON from './mapping.json'
import { Mapping } from '@teleporthq/teleport-types'

import {
  element,
  component,
  definition,
  staticNode,
  dynamicNode,
  elementNode,
  conditionalNode,
} from '@teleporthq/teleport-uidl-builders'

const mapping = mappingJSON as Mapping

describe('resolveElement', () => {
  const uidlElement = element('text', {
    dummy: staticNode('remains here'),
  })

  it('returns a mapped content node', () => {
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedElement = resolver.resolveElement(uidlElement)
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })

  it('returns a mapped content node with a custom mapping', () => {
    const resolver = new Resolver()
    const resolvedElement = resolver.resolveElement(uidlElement, { mapping })
    expect(resolvedElement.elementType).toBe('span')
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })

  it('drops editor-only chapter bookkeeping but keeps the runtime lanes', () => {
    const chapter = element('container', {
      'data-scroll-bind': staticNode('[{"prop":"opacity","at":[0,1],"values":[0,1]}]'),
      'data-scroll-bind-rel': staticNode('[{"prop":"opacity","at":[0,1],"values":[0,1]}]'),
      'data-chapter-window': staticNode('0-0.5'),
      'data-chapter-template': staticNode('finale'),
      'data-snap-into-view': staticNode('gentle'),
    })
    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolved = resolver.resolveElement(chapter)

    expect(Object.keys(resolved.attrs)).toEqual(['data-scroll-bind', 'data-snap-into-view'])
  })

  it('maps a seflClosing tag', () => {
    const resolver = new Resolver()
    const imageElement = element('image', {
      dummy: staticNode('remains here'),
    })
    const resolvedElement = resolver.resolveElement(imageElement, { mapping })
    expect(resolvedElement.elementType).toBe('img')
    expect(resolvedElement.selfClosing).toBe(true)
    expect(resolvedElement.attrs.dummy.content).toBe('remains here')
  })
})

describe('resolveUIDL', () => {
  it('should return resolved UIDL', () => {
    const uidl = component(
      'Conditional Component',
      elementNode('container', {}, [
        conditionalNode(
          dynamicNode('state', 'isVisible'),
          elementNode('div', {}, [staticNode('Now you see me!')]),
          true
        ),
      ]),
      {},
      { isVisible: definition('boolean', true), isShareable: definition('boolean', false) }
    )

    const extraMapping = {
      elements: {
        container: {
          elementType: 'div',
        },
      },
    }

    const resolver = new Resolver()
    resolver.addMapping(mapping)
    const resolvedUIDL = resolver.resolveUIDL(uidl, { mapping: extraMapping })
    expect(resolvedUIDL.name).toBe('Conditional Component')
    expect(resolvedUIDL.outputOptions.fileName).toBe('conditional-component')
    expect(resolvedUIDL.outputOptions.componentClassName).toBe('ConditionalComponent')
    expect(resolvedUIDL.node.type).toBe('element')
    expect(resolvedUIDL.stateDefinitions.isVisible.type).toBe('boolean')
  })
})
