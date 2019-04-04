// @ts-ignore-next-line
import ComponentWithInValidPropsJSON from './component-with-invalid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithValidPropsJSON from './component-with-valid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithRepeatPropsJSON from './component-with-repeat.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'

const ComponentWithValidProps = ComponentWithValidPropsJSON as ComponentUIDL
const ComponentWithInValidProps = (ComponentWithInValidPropsJSON as unknown) as ComponentUIDL
const ComponentWithRepeatProps = ComponentWithRepeatPropsJSON as ComponentUIDL

const JS_FILE = 'js'
const VUE_FILE = 'vue'
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

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('key={index}>')
      expect(jsFile.content).toContain('test={index}>')
    })

    it('should fail to add old style attributes on component', async () => {
      const operation = generator.generateComponent(ComponentWithInValidProps, {
        skipValidation: true,
      })

      await expect(operation).rejects.toThrow(Error)
    })
  })
})

describe('Vue Props in Component Generator', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createVueComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidProps)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':data-test')
      expect(vueFile.content).not.toContain(':data-static')
      expect(vueFile.content).toContain('data-static')
      expect(vueFile.content).toContain('content.heading')
      expect(vueFile.content).toContain('content: {')
      expect(vueFile.content).toContain('heading: ')
    })

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':key="index"')
      expect(vueFile.content).toContain(':test="index"')
    })

    it('should fail to add old style attributes on component', async () => {
      const operation = generator.generateComponent(ComponentWithInValidProps, {
        skipValidation: true,
      })
      await expect(operation).rejects.toThrow(Error)
    })
  })
})
