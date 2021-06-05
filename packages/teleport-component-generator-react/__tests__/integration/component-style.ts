// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'
// @ts-ignore-next-line
import ComponentWithInvalidStateStyles from './component-with-invalid-state-styles.json'
// @ts-ignore-next-line
import ComponentWithValidSingleStlye from './component-with-valid-single-prop-style.json'
// @ts-ignore-next-line
import ComponentWithStateReference from './component-with-valid-state-reference.json'

import { createReactComponentGenerator } from '../../src'
import {
  ComponentUIDL,
  GeneratedFile,
  UIDLPropDefinition,
  UIDLStyleDefinitions,
  FileType,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import { staticNode, dynamicNode, component, elementNode } from '@teleporthq/teleport-uidl-builders'

const ComponentWithValidStyle: ComponentUIDL = component(
  'ComponentWithAttrProp',
  elementNode('container', {}, [], null, {
    flexDirection: dynamicNode('prop', 'direction'),
    height: dynamicNode('prop', 'config.height'),
    alignSelf: staticNode('center'),
  }),
  {
    direction: {
      type: 'string',
      defaultValue: 'row',
    },
    config: {
      type: 'object',
      defaultValue: {
        height: 32,
      },
    },
  },
  {}
)

const findFileByType = (files: GeneratedFile[], type: string = FileType.JS) =>
  files.find((file) => file.fileType === type)

describe('React Styles in Component', () => {
  describe('supports usage of state in styles', () => {
    it('Inline Styles should refer state in styles when state is mapped', async () => {
      const generator = createReactComponentGenerator({
        variation: ReactStyleVariation.InlineStyles,
      })
      const result = await generator.generateComponent(ComponentWithStateReference)
      const jsFile = findFileByType(result.files, FileType.JS)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('display: active')
      expect(jsFile.content).toContain('height: props.config.height')
    })

    it('CSSModules should refer state in styles when state is mapped', async () => {
      const generator = createReactComponentGenerator({
        variation: ReactStyleVariation.CSSModules,
      })
      const result = await generator.generateComponent(ComponentWithStateReference)
      const jsFile = findFileByType(result.files, FileType.JS)
      const cssFile = findFileByType(result.files, FileType.CSS)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('display: active')
      expect(jsFile.content).toContain('height: props.config.height')
      expect(cssFile.content).toContain('align-self: center;')
    })

    it('Basic CSS should refer state in styles when state is mapped', async () => {
      const generator = createReactComponentGenerator({
        variation: ReactStyleVariation.CSS,
      })
      const result = await generator.generateComponent(ComponentWithStateReference)
      const jsFile = findFileByType(result.files, FileType.JS)
      const cssFile = findFileByType(result.files, FileType.CSS)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('display: active')
      expect(jsFile.content).toContain('height: props.config.height')
      expect(cssFile.content).toContain('align-self: center;')
    })

    it('JSS should through error when state is refered', async () => {
      const generator = createReactComponentGenerator({
        variation: ReactStyleVariation.ReactJSS,
      })
      try {
        await generator.generateComponent(ComponentWithStateReference)
      } catch (e) {
        expect(e.message).toContain('reactJSSComponentStyleChunksPlugin')
        expect(e.message).toContain('styleValue.content.referenceType value state')
      }
    })
  })

  describe('supports props json declaration in styles', () => {
    const generator = createReactComponentGenerator({
      variation: ReactStyleVariation.InlineStyles,
    })

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, FileType.JS)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('props.direction')
      expect(jsFile.content).toContain(`alignSelf: 'center'`)
    })

    it('should support object props in styledjsx', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactStyleVariation.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, FileType.JS)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(`align-self: center`)
    })

    it('should throw error when a state is being refered in generated StyledJSX ', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactStyleVariation.StyledJSX,
      })
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
      const styledComponentsGenerator = createReactComponentGenerator({
        variation: ReactStyleVariation.StyledComponents,
      })
      const result = await styledComponentsGenerator.generateComponent(
        ComponentWithValidSingleStlye
      )
      const jsFile = findFileByType(result.files, FileType.JS)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('<Container {...props}')
      expect(jsFile.content).toContain('height: props.config.height')
    })

    it('should inject props only once for styled components', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactStyleVariation.StyledComponents,
      })
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidStyle)

      const jsFile = findFileByType(result.files, FileType.JS)
      expect(jsFile.content).toContain('<Container {...props}')
    })

    it('should throw error when a state is being refered in generated StyledComponents ', async () => {
      const styledComponentsGenerator = createReactComponentGenerator({
        variation: ReactStyleVariation.StyledComponents,
      })
      try {
        await styledComponentsGenerator.generateComponent(ComponentWithInvalidStateStyles)
        expect(true).toBe(false)
      } catch (e) {
        expect(e.message).toContain(
          'Error running transformDynamicStyles in reactStyledComponentsPlugin'
        )
      }
    })
  })

  describe('React CSS file using CSS Modules', () => {
    const generator = createReactComponentGenerator({ variation: ReactStyleVariation.CSSModules })

    it('should return code in an array of files', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      const jsFile = findFileByType(result.files, FileType.JS)
      const cssFile = findFileByType(result.files, FileType.CSS)

      expect(jsFile).toBeDefined()
      expect(cssFile).toBeDefined()
      expect(jsFile.content).toContain('import React')
      expect(jsFile.content).toContain('flexDirection: props.direction')
      expect(cssFile.content).toContain(`align-self: center`)
    })
  })
})
