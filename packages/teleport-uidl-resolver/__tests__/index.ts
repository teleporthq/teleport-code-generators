import { resolveUIDLElement } from '../src'
import { element } from '@teleporthq/teleport-uidl-builders'

describe('resolveUIDLElement', () => {
  it('resolves an element with the react mapping', async () => {
    const elementNode = element('container')
    const result = resolveUIDLElement(elementNode)
    expect(result.elementType).toBe('div')
  })
})
