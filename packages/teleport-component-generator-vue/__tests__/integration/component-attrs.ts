// @ts-ignore-next-line
import ComponentWithOldFormatAttributesJSON from './component-with-old-format-attributes.json'

import { createVueComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = VUE_FILE) =>
  files.find((file) => file.fileType === type)

const uidl = component(
  'ComponentWithAttrProp',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [
        elementNode(
          'div',
          {
            test: dynamicNode('local', 'index'),
            for: staticNode('mappedTest'),
            'data-test': dynamicNode('prop', 'test'),
            'data-static': staticNode('test'),
            'data-inner-value': dynamicNode('prop', 'content.heading'),
          },
          [dynamicNode('local', 'item')]
        ),
      ]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    ),
  ]),
  {
    items: definition('object', { test: '123' }),
    test: definition('string', '123'),
    content: definition('object', { heading: 'Hello World' }),
  },
  {}
)

describe('Vue Attribute Mapping', () => {
  const generator = createVueComponentGenerator()

  it('should return code with attributes mapped', async () => {
    const result = await generator.generateComponent(uidl)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).not.toContain('htmlFor')
    expect(vueFile.content).toContain('for')
  })
})

describe('Vue Props in Component Generator', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createVueComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(uidl)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':data-test')
      expect(vueFile.content).not.toContain(':data-static')
      expect(vueFile.content).toContain('data-static')
      expect(vueFile.content).toContain('content.heading')
      expect(vueFile.content).toContain('content: {')
      expect(vueFile.content).toContain('heading: ')
    })

    it('should work with old style attributes', async () => {
      const result = await generator.generateComponent(ComponentWithOldFormatAttributesJSON)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':data-test')
      expect(vueFile.content).not.toContain(':data-static')
      expect(vueFile.content).toContain('data-static')
      expect(vueFile.content).toContain('content.heading')
      expect(vueFile.content).toContain('content: {')
      expect(vueFile.content).toContain('heading: ')
    })

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(uidl)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':key="index"')
      expect(vueFile.content).toContain(':test="index"')
    })
  })
})
