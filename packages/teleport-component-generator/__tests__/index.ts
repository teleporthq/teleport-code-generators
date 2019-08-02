import { createComponentGenerator } from '../src/index'
import {
  elementNode,
  element,
  component,
} from '../../teleport-shared/dist/cjs/builders/uidl-builders'
import { ChunkDefinition } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('component generator', () => {
  it('creates a new instance of the generator', () => {
    const generator = createComponentGenerator()
    expect(generator.generateComponent).toBeDefined()
    expect(generator.addMapping).toBeDefined()
    expect(generator.addPlugin).toBeDefined()
    expect(generator.addPostProcessor).toBeDefined()
    expect(generator.resolveElement).toBeDefined()
  })

  describe('resolveNode', () => {
    it('resolves a node', () => {
      const generator = createComponentGenerator()

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

  describe('generateComponent', () => {
    it('does not crash when no plugin is set', async () => {
      const generator = createComponentGenerator()

      const uidl = component('test', elementNode('container'))

      const result = generator.generateComponent(uidl)
      await expect(result).rejects.toThrowError('No plugins found.')
    })

    it('calls all the plugins', async () => {
      const generator = createComponentGenerator()
      const uidl = component('test', elementNode('container'))

      let pluginCalls = 0
      // dummy plugins
      const plugin1 = (structure) => {
        pluginCalls++
        return structure
      }

      const plugin2 = (structure) => {
        pluginCalls++
        return structure
      }

      generator.addPlugin(plugin1)
      generator.addPlugin(plugin2)

      await generator.generateComponent(uidl)

      expect(pluginCalls).toBe(2)
    })
  })

  describe('linkCodeChunks', () => {
    it('works with no postprocessor', () => {
      const generator = createComponentGenerator()
      const codeChunks: Record<string, ChunkDefinition[]> = {
        js: [
          {
            type: CHUNK_TYPE.STRING,
            fileType: FILE_TYPE.JS,
            name: 'chunk',
            content: 'import lib from "lib"',
            linkAfter: [],
          },
        ],
      }

      generator.addPostProcessor((_) => _)

      const result = generator.linkCodeChunks(codeChunks, 'output')
      expect(result[0].fileType).toBe('js')
      expect(result[0].content).toContain('import lib from "lib"')
      expect(result[0].name).toBe('output')
    })
  })
})
