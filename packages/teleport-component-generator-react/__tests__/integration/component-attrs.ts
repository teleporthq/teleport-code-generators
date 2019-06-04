// @ts-ignore-next-line
import ComponentWithOldFormatAttributesJSON from './component-with-old-format-attributes.json'

import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

const uidl = component(
  'ComponentWithAttrProp',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [
        elementNode(
          'div',
          {
            test: dynamicNode('local', 'index'),
            'data-test': dynamicNode('prop', 'test'),
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

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Props in Component', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(uidl)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('props.test')
      expect(jsFile.content).toContain('props.content.heading')
    })

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithOldFormatAttributesJSON)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('props.test')
      expect(jsFile.content).toContain('props.content.heading')
    })

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(uidl)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('key={index}>')
      expect(jsFile.content).toContain('test={index}')
    })
  })
})
