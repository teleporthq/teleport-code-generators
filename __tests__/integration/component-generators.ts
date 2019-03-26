// @ts-ignore-next-line
import uidlSample from '../fixtures/component-sample.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../src'

import { ReactComponentStylingFlavors } from '../../src/component-generators/react/react-component.js'

describe('React Component Generator', () => {
  describe('with CSS Modules', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.CSSModules,
    })

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBeDefined()
      expect(result.externalDependencies).toBeDefined()
    })
  })

  describe('with JSS', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.JSS,
    })

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBe('')
      expect(result.externalDependencies).toBeDefined()
    })
  })

  describe('with InlineStyles', () => {
    const generator = createReactComponentGenerator()

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('import React')
      expect(result.externalCSS).toBe('')
      expect(result.externalDependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.InlineStyles,
      customMapping: { elements: { container: { type: 'fakediv' } } },
    })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('<fakediv')
      expect(result.externalCSS).toBe('')
      expect(result.externalDependencies).toBeDefined()
    })
  })
})

describe('Vue Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createVueComponentGenerator()

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('<template>')
      expect(result.externalCSS).toBeUndefined()
      expect(result.externalDependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createVueComponentGenerator()
    generator.addMapping({ elements: { container: { type: 'fakediv' } } })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      expect(result.code).toContain('<fakediv')
      expect(result.externalCSS).toBeUndefined()
      expect(result.externalDependencies).toBeDefined()
    })
  })
})
