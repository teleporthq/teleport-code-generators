import uidlSampleJSON from '../fixtures/component-sample.json'
// import invalidUidlSampleJSON from '../fixtures/component-invalid-sample.json'

import { createReactComponentGenerator, createVueComponentGenerator } from '../../src'

import { ReactComponentStylingFlavors } from '../../src/component-generators/react/react-component.js'

const uidlSample = uidlSampleJSON as ComponentUIDL
// const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const findJsFile = (files: GeneratedFile[]) => files.find((file) => file.fileType === 'js')
const findVueFile = (files: GeneratedFile[]) => files.find((file) => file.fileType === 'vue')

describe('React Component Generator', () => {
  describe('with CSS Modules', () => {
    const generator = createReactComponentGenerator({
      variation: ReactComponentStylingFlavors.CSSModules,
    })

    it('should return code in an array of files', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findJsFile(result.files)

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

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findJsFile(result.files)

      expect(jsFile).toBeDefined()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import React')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with InlineStyles', () => {
    const generator = createReactComponentGenerator()

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findJsFile(result.files)

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
      const jsFile = findJsFile(result.files)

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

    it('should return the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findVueFile(result.files)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('<template>')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createVueComponentGenerator()
    generator.addMapping({ elements: { container: { elementType: 'fakediv' } } })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findVueFile(result.files)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('<fakediv')
      expect(result.dependencies).toBeDefined()
    })
  })
})

// describe('Vue Component Validator', () => {
//   const generator = createVueComponentGenerator()

//   it('works with valid UIDL sample', async () => {
//     const result = await generator.generateComponent(uidlSample)
//     expect(result.code).toContain('<template>')
//     expect(result.externalCSS).toBeUndefined()
//     expect(result.externalDependencies).toBeDefined()
//   })
//   it('throws error when invalid UIDL sample is used', async () => {
//     const result = generator.generateComponent(invalidUidlSample)

//     await expect(result).rejects.toThrow(Error)
//   })
//   it('works when validation step is skiped', async () => {
//     const options = { skipValidation: true }
//     const result = await generator.generateComponent(invalidUidlSample, options)
//     expect(result.code).toContain('<template>')
//     expect(result.externalCSS).toBeUndefined()
//     expect(result.externalDependencies).toBeDefined()
//   })
// })

// describe('React Component Validator', () => {
//   const generator = createReactComponentGenerator({
//     variation: ReactComponentStylingFlavors.CSSModules,
//   })

//   it('works with valid UIDL sample', async () => {
//     const result = await generator.generateComponent(uidlSample)
//     expect(result.code).toContain('import React')
//     expect(result.externalCSS).toBeDefined()
//     expect(result.externalDependencies).toBeDefined()
//   })
//   it('throws error when invalid UIDL sample is used', async () => {
//     const result = generator.generateComponent(invalidUidlSample)
//     await expect(result).rejects.toThrow(Error)
//   })
//   it('works when validation step is skiped', async () => {
//     const options = { skipValidation: true }
//     const result = await generator.generateComponent(invalidUidlSample, options)
//     expect(result.code).toContain('import React')
//     expect(result.externalCSS).toBeDefined()
//     expect(result.externalDependencies).toBeDefined()
//   })
// })
