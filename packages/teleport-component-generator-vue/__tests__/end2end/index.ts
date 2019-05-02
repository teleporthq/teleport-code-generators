// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createVueComponentGenerator } from '../../src'
import { ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

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
