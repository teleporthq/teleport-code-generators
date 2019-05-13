// @ts-ignore-next-line
import ComponentWithValidPropsJSON from './component-with-valid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithOldFormatAttributesJSON from './component-with-old-format-attributes.json'

import { createReactComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const ComponentWithValidProps = ComponentWithValidPropsJSON as ComponentUIDL

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

const uidl = component(
  'ComponentWithAttrProp',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [
        elementNode('div', { test: dynamicNode('local', 'index') }, [dynamicNode('local', 'item')]),
      ]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    ),
  ]),
  { items: definition('object', { test: '123' }) },
  {}
)

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Props in Component', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidProps)
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
      expect(jsFile.content).toContain('test={index}>')
    })
  })
})
