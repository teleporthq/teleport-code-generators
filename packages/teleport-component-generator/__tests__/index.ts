import { GenerateComponentFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { createGenerator } from '../src/index'
import { element } from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

describe('component generator', () => {
  it('creates a new instance of the generator', () => {
    const generator = createGenerator()
    expect(generator.generateComponent).toBeDefined()
    expect(generator.addMapping).toBeDefined()
    expect(generator.addPlugin).toBeDefined()
    expect(generator.addPostProcessor).toBeDefined()
    expect(generator.resolveElement).toBeDefined()
  })

  it('resolves a node', () => {
    const generator = createGenerator()

    generator.addMapping({
      elements: {
        container: {
          elementType: 'div',
          attrs: { 'data-test': { type: 'static', content: '123' } },
        },
      },
    })

    const result = generator.resolveElement(element('container', {}, []))
    expect(result.elementType).toBe('div')
    expect(result.attrs['data-test'].content).toBe('123')
  })
})
