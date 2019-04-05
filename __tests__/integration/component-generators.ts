// @ts-ignore
import uidlSampleJSON from '../fixtures/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../fixtures/component-invalid-sample.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../src'
import { ComponentUIDL } from '../../src/typings/uidl-definitions'
import { GeneratedFile } from '../../src/typings/generators'
import { ReactComponentStylingFlavors } from '../../src/component-generators/react/react-component'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Component Generator', () => {
  describe('with CSS Modules', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.CSSModules,
    })

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBeTruthy()
      expect(jsFile.content).toContain('import React')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with JSS', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.JSS,
    })

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import React')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with InlineStyles', () => {
    const generator = createReactComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import React')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.InlineStyles,
      customMapping: { elements: { container: { elementType: 'fakediv' } } },
    })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('<fakediv')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Vue Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createVueComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('<template>')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createVueComponentGenerator()
    generator.addMapping({ elements: { container: { elementType: 'fakediv' } } })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('<fakediv')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Vue Component Validator', () => {
  const generator = createVueComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).toContain('<template>')
    expect(result.dependencies).toBeDefined()
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateComponent(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })
  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).toContain('<template>')
    expect(result.dependencies).toBeDefined()
  })
})

describe('React Component Validator', () => {
  const generator = createReactComponentGenerator({
    variation: ReactComponentStylingFlavors.CSSModules,
  })

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateComponent(invalidUidlSample)
    await expect(result).rejects.toThrow(Error)
  })
  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
  })
})
