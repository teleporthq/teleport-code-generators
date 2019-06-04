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

    it('should support nested styles', async () => {
      const result = await generator.generateComponent(ComponentWithNestedStyles as ComponentUIDL)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('{flexDirection: direction}')
      expect(vueFile.content).toContain(`align-self: center`)
      expect(vueFile.content).toContain('@media (max-width: 640px) {')
      expect(vueFile.content).toContain(`@media (max-width: 634px) {`)
    })
  })
})
