// @ts-ignore-next-line
import ComponentWithValidJSON from './component-with-valid-style.json'
// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'
// @ts-ignore-next-line
import ComponentWithInvalidStateStyles from './component-with-invalid-state-styles.json'
// @ts-ignore-next-line
import ComponentWithValidSingleStlye from './component-with-valid-single-prop-style.json'
// @ts-ignore-next-line
import ComponentWithNestedMultiplePropRef from './component-with-nested-multiple-prop-ref-styles.json'
// @ts-ignore-next-line
import ComponentWithNestedSinglePropRef from './component-with-nested-single-prop-ref-styles.json'
// @ts-ignore-next-line
import ComponentWithStateReference from './component-with-valid-state-reference.json'

import { createReactComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const ComponentWithValidStyle = ComponentWithValidJSON as ComponentUIDL

const JS_FILE = 'js'
const CSS_FILE = 'css'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Styles in Component', () => {
  describe('supports usage of state in styles', () => {
    it('Inline Styles should refer state in styles when state is mapped', async () => {
      const generator = createReactComponentGenerator()
      const result = await generator.generateComponent(ComponentWithStateReference)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('display: active')
      expect(jsFile.content).toContain('height: props.config.height')
    })

    it('CSSModules should refer state in styles when state is mapped', async () => {
      const generator = createReactComponentGenerator('CSSModules')
      const result = await generator.generateComponent(ComponentWithStateReference)
      const jsFile = findFileByType(result.files, JS_FILE)
      const cssFile = findFileByType(result.files, CSS_FILE)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('display: active')
      expect(jsFile.content).toContain('height: props.config.height')
    })

    it('JSS should through error when state is refered', async () => {
      const generator = createReactComponentGenerator('JSS')
      try {
        await generator.generateComponent(ComponentWithStateReference)
      } catch (e) {
        expect(e.message).toContain('reactJSSComponentStyleChunksPlugin')
        expect(e.message).toContain('styleValue.content.referenceType value state')
      }
    })
  })

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
      const styledJSXGenerator = createReactComponentGenerator('StyledJSX')
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(`align-self: center`)
    })

    it('should support nested styles in styledjsx', async () => {
      const styledJSXGenerator = createReactComponentGenerator('StyledJSX')
      const result = await styledJSXGenerator.generateComponent(
        ComponentWithNestedStyles as ComponentUIDL
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('flex-direction: ${props.direction}')
      expect(jsFile.content).toContain(`align-self: center`)
      expect(jsFile.content).toContain('@media (max-width: 640px) {')
      expect(jsFile.content).toContain(`@media (max-width: 634px) {`)
    })

    it('should throw error when a state is being refered in generated StyledJSX ', async () => {
      const styledJSXGenerator = createReactComponentGenerator('StyledJSX')
      try {
        await styledJSXGenerator.generateComponent(ComponentWithInvalidStateStyles)
        expect(true).toBe(false)
      } catch (e) {
        expect(e.message).toContain(
          'Error running transformDynamicStyles in reactStyledJSXChunkPlugin'
        )
      }
    })

    it('should explicitly send prop if style is using one prop variable', async () => {
      const styledComponentsGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledComponentsGenerator.generateComponent(
        ComponentWithValidSingleStlye
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('<Container height={props.config.height}')
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('height: ${(props) => props.height}')
    })

    it('should support object props in styled-components', async () => {
      const styledComponentsGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledComponentsGenerator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(`align-self: center`)
    })

    it('should support nested styles in styled-components with single prop', async () => {
      const styledComponentsGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledComponentsGenerator.generateComponent(
        ComponentWithNestedStyles as ComponentUIDL
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('flex-direction: ${(props) => props.flexDirection}')
      expect(jsFile.content).toContain(`align-self: center`)
      expect(jsFile.content).toContain('@media (max-width: 640px) {')
      expect(jsFile.content).toContain(`@media (max-width: 634px) {`)
    })

    it('should support nested styles in styled-components with multiple prop refs', async () => {
      const styledComponentsGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledComponentsGenerator.generateComponent(
        ComponentWithNestedMultiplePropRef as ComponentUIDL
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('flex-direction: ${(props) => props.direction}')
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('height: ${(props) => props.config.height}')
      expect(jsFile.content).toContain(`align-self: center`)
      expect(jsFile.content).toContain('@media (max-width: 640px) {')
      expect(jsFile.content).toContain(`@media (max-width: 634px) {`)
    })

    it('should support nested styles in styled-components with single prop  ref', async () => {
      const styledComponentsGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledComponentsGenerator.generateComponent(
        ComponentWithNestedSinglePropRef as ComponentUIDL
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(`align-self: center`)
      expect(jsFile.content).toContain('<Container alignSelf={props.direction}')
      // tslint:disable-next-line:no-invalid-template-strings
      expect(jsFile.content).toContain('align-self: ${(props) => props.alignSelf}')
      expect(jsFile.content).toContain('@media (max-width: 835px) {')
      expect(jsFile.content).toContain('@media (max-width: 640px) {')
      expect(jsFile.content).toContain(`@media (max-width: 634px) {`)
    })

    it('should inject props only once for styled components', async () => {
      const styledJSXGenerator = createReactComponentGenerator('StyledComponents')
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidJSON)
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile.content).toContain('<Container {...props} />')
    })

    it('should throw error when a state is being refered in generated StyledComponents ', async () => {
      const styledJSXGenerator = createReactComponentGenerator('StyledComponents')
      try {
        await styledJSXGenerator.generateComponent(ComponentWithInvalidStateStyles)
        expect(true).toBe(false)
      } catch (e) {
        expect(e.message).toContain(
          'Error running transformDynamicStyles in reactStyledComponentsPlugin'
        )
      }
    })
  })

  describe('React CSS file using CSS Modules', () => {
    const generator = createReactComponentGenerator('CSSModules')

    it('should return code in an array of files', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, JS_FILE)
      const cssFile = findFileByType(result.files, CSS_FILE)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('import React')
      expect(jsFile.content).toContain('flexDirection: props.direction')
      expect(cssFile.content).toContain(`align-self: center`)
    })
  })
})
