// @ts-ignore-next-line
import ComponentWithValidJSON from './component-with-valid-style.json'
// @ts-ignore-next-line
import ComponentWithInValidStyle from './component-with-invalid-style.json'
// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'
import { ReactComponentStylingFlavors } from '../../../src/component-generators/react/react-component'

const ComponentWithValidStyle = ComponentWithValidJSON as ComponentUIDL

const JS_FILE = 'js'
const VUE_FILE = 'vue'
const CSS_FILE = 'css'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Styles in Component', () => {
  describe('supports props json declaration in styles', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('props.direction')
      expect(jsFile.content).toContain(`alignSelf: 'center'`)
    })

    it('should support object props in styledjsx', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactComponentStylingFlavors.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(`align-self: center`)
    })

    it('should support nested styles', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactComponentStylingFlavors.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(
        ComponentWithNestedStyles as ComponentUIDL
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('flex-direction: ${props.direction}')
      expect(jsFile.content).toContain(`align-self: center`)
      expect(jsFile.content).toContain('@media (max-width: 640px) {')
      expect(jsFile.content).toContain(`@media (max-width: 634px) {`)
    })

    it('should fail to add old style attributes on component', async () => {
      const operation = generator.generateComponent(
        (ComponentWithInValidStyle as unknown) as ComponentUIDL,
        {
          skipValidation: true,
        }
      )

      await expect(operation).rejects.toThrow(Error)
    })
  })

  describe('React CSS file using CSS Modules', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.CSSModules,
    })

    it('should return code in an array of files', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)
      const cssFile = findFileByType(result.files, CSS_FILE)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('import React')
      expect(jsFile.content).toContain('flexDirection: (props) => props.direction')
      expect(cssFile.content).toContain(`align-self: center`)
    })
  })
})

describe('Vue Props in Component Generator', () => {
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

    it('should fail to add old style attributes on component', async () => {
      const operation = generator.generateComponent(
        (ComponentWithInValidStyle as unknown) as ComponentUIDL,
        {
          skipValidation: true,
        }
      )
      await expect(operation).rejects.toThrow(Error)
    })
  })
})
