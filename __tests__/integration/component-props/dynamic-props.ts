// @ts-ignore-next-line
import ComponentWithInValidProps from './component-with-invalid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithValidProps from './component-with-valid-attr-prop.json'
// @ts-ignore-next-line
import ComponentWithRepeatProps from './component-with-repeat.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../../src'

describe('React Props in Component', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidProps)
      expect(result.code).toContain('props.test')
    })

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      expect(result.code).toContain('key={index}>')
      expect(result.code).toContain('test={index}>')
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
      expect(result.code).toContain(':data-test')
      expect(result.code).not.toContain(':data-static')
      expect(result.code).toContain('data-static')
    })

    it('should run repeat attributes and data source', async () => {
      const result = await generator.generateComponent(ComponentWithRepeatProps)
      expect(result.code).toContain(':key="index"')
      expect(result.code).toContain(':test="index"')
    })

    it('should fail to add old style attributes on component', async () => {
      const operation = generator.generateComponent(ComponentWithInValidProps, {
        skipValidation: true,
      })
      await expect(operation).rejects.toThrow(Error)
    })
  })
})
