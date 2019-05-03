// @ts-ignore-next-line
import ComponentWithValidPropsJSON from './component-with-valid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithRepeatPropsJSON from './component-with-repeat.json'
// @ts-ignore-next-line
import ComponentWithOldFormatAttributesJSON from './component-with-old-format-attributes.json'

import { createReactComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const ComponentWithValidProps = ComponentWithValidPropsJSON as ComponentUIDL
const ComponentWithRepeatProps = ComponentWithRepeatPropsJSON as ComponentUIDL

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
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('key={index}>')
      expect(jsFile.content).toContain('test={index}>')
    })
  })
})
