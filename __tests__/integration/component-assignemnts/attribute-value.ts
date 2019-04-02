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

describe('React Props in Component', () => {
  describe('supports props json declaration in attributes', () => {
    const generator = createReactComponentGenerator()

    it('should add attributes on component', async () => {
      const result = await generator.generateComponent(ComponentWithValidProps)
      expect(result.code).toContain('props.test')
      expect(result.code).toContain('props.content.heading')
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
      expect(result.code).toContain('content.heading')
      expect(result.code).toContain('content: {')
      expect(result.code).toContain('heading: ')
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
