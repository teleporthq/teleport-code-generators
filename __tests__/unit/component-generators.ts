// @ts-ignore-next-line
import reactSample from '../fixtures/react-sample.json'
// @ts-ignore-next-line
import vueSample from '../fixtures/vue-sample.json'

import {
  createReactComponentGenerator,
  createVueComponentGenerator,
  GeneratorTypes,
} from '../../src'

const { ReactComponentStylingFlavors } = GeneratorTypes

describe('React Component Generator', () => {
  describe('with CSS Modules', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.CSSModules,
    })

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(reactSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBeDefined()
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with JSS', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.JSS,
    })

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(reactSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBe('')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with InlineStyles', () => {
    const generator = createReactComponentGenerator()

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(reactSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBe('')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.InlineStyles,
      customMapping: { container: { type: 'fakediv' } },
    })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(reactSample)
      expect(result.code).toContain('<fakediv')
      expect(result.externalCSS).toBe('')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Vue Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createVueComponentGenerator()

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(vueSample)
      expect(result.code).toContain('<template>')
      expect(result.externalCSS).toBeUndefined()
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createVueComponentGenerator()
    generator.addMapping({ container: { type: 'fakediv' } })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(vueSample)
      expect(result.code).toContain('<fakediv')
      expect(result.externalCSS).toBeUndefined()
      expect(result.dependencies).toBeDefined()
    })
  })
})
