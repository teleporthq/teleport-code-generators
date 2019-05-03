// @ts-ignore-next-line
import ComponentWithValidPropsJSON from './component-with-valid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithRepeatPropsJSON from './component-with-repeat.json'
// @ts-ignore-next-line
import ComponentWithOldFormatAttributesJSON from './component-with-old-format-attributes.json'

import { createVueComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const ComponentWithValidProps = ComponentWithValidPropsJSON as ComponentUIDL
const ComponentWithRepeatProps = ComponentWithRepeatPropsJSON as ComponentUIDL

const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = VUE_FILE) =>
  files.find((file) => file.fileType === type)

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
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile.content).toContain(':key="index"')
      expect(vueFile.content).toContain(':test="index"')
    })
  })
})
