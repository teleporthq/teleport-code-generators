// @ts-ignore-next-line
import ComponentWithValidJSON from './component-with-valid-style.json'
// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'

import { createVueComponentGenerator } from '../../src'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'

const ComponentWithValidStyle = ComponentWithValidJSON as ComponentUIDL

const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = VUE_FILE) =>
  files.find((file) => file.fileType === type)

describe('Vue styles in Component Generator', () => {
  describe('supports props json declaration in styles', () => {
    const generator = createVueComponentGenerator()

    it('should add styles on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('align-self: center')
      expect(vueFile.content).toContain('config.height')
    })

    it('should not support nested styles', async () => {
      // @ts-ignore
      const result = generator.generateComponent(ComponentWithNestedStyles)
      await expect(result).rejects.toThrow(Error)
    })
  })
})
