// @ts-ignore-next-line
import ComponentWithValidJSON from './component-with-valid-style.json'
// @ts-ignore-next-line
import ComponentWithInValidStyle from './component-with-invalid-style.json'
// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'
import { ReactComponentStylingFlavors } from '../../../src/component-generators/react/react-component'

const ComponentWithValidStyle = ComponentWithValidJSON as ComponentUIDL

describe('React Styles in Component', () => {
  describe('supports props json declaration in styles', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      expect(result.code).toContain('props.direction')
      expect(result.code).toContain(`alignSelf: 'center'`)
    })

    it('should support object props in styledjsx', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactComponentStylingFlavors.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(ComponentWithValidStyle)
      expect(result.code).toContain(`align-self: center`)
    })

    it('should support nested styles', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactComponentStylingFlavors.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(
        ComponentWithNestedStyles as ComponentUIDL
      )
      expect(result.code).toContain('flex-direction: ${props.direction}')
      expect(result.code).toContain(`align-self: center`)
      expect(result.code).toContain('@media (max-width: 640px) {')
      expect(result.code).toContain(`@media (max-width: 634px) {`)
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

describe('Vue Props in Component Generator', () => {
  describe('supports props json declaration in styles', () => {
    const generator = createVueComponentGenerator()

    it('should add styles on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle)
      expect(result.code).toContain('align-self: center')
      expect(result.code).toContain('config.height')
    })

    it('should support nested styles', async () => {
      const result = await generator.generateComponent(ComponentWithNestedStyles as ComponentUIDL)
      expect(result.code).toContain('{flexDirection: direction}')
      expect(result.code).toContain(`align-self: center`)
      expect(result.code).toContain('@media (max-width: 640px) {')
      expect(result.code).toContain(`@media (max-width: 634px) {`)
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
