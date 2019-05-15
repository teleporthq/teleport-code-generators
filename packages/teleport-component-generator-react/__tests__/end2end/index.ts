// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createReactComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Component Generator', () => {
  describe('with CSS Modules', () => {
    const generator = createReactComponentGenerator('CSSModules')

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
    const generator = createReactComponentGenerator('JSS')

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import React')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with StyledComponents', () => {
    const generator = createReactComponentGenerator('StyledComponents')

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
    const mapping = { elements: { container: { elementType: 'fakediv' } } }
    const generator = createReactComponentGenerator('InlineStyles', { mapping })

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

describe('React Component Validator', () => {
  const generator = createReactComponentGenerator('CSSModules')

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
