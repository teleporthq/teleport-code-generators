// @ts-ignore-next-line
import ComponentWithValidStyle from './component-with-valid-style.json'
// @ts-ignore-next-line
import ComponentWithInValidStyle from './component-with-invalid-style.json'
// @ts-ignore-next-line
import ComponentWithNestedStyles from './component-with-nested-styles.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'
import { ReactComponentStylingFlavors } from '../../../src/component-generators/react/react-component'

describe('React Props in Component', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle as ComponentUIDL)
      expect(result.code).toContain('props.direction')
      expect(result.code).toContain(`alignSelft: 'center'`)
    })

    it('should support nested styles', async () => {
      const styledJSXGenerator = createReactComponentGenerator({
        variation: ReactComponentStylingFlavors.StyledJSX,
      })
      const result = await styledJSXGenerator.generateComponent(
        ComponentWithNestedStyles as ComponentUIDL
      )
      expect(result.code).toContain('flex-direction: ${direction}')
      expect(result.code).toContain(`align-selft: center`)
      expect(result.code).toContain('@media (max-width: 640px) {')
      expect(result.code).toContain(` @media (max-width: 634px) {`)
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
  describe('supports props json declaration in attributes', () => {
    const generator = createVueComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidStyle as ComponentUIDL)
      expect(result.code).toContain(':data-test')
      expect(result.code).not.toContain(':data-static')
      expect(result.code).toContain('data-static')
    })

    it('should support nested styles', async () => {
      const result = await generator.generateComponent(ComponentWithNestedStyles as ComponentUIDL)
      expect(result.code).toContain('flex-direction: ${direction}')
      expect(result.code).toContain(`align-selft: center`)
      expect(result.code).toContain('@media (max-width: 640px) {')
      expect(result.code).toContain(` @media (max-width: 634px) {`)
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
