// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createStencilComponentGenerator } from '../../src'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const TSX_FILE = 'tsx'
const findFileByType = (files: GeneratedFile[], type: string = TSX_FILE) =>
  files.find((file) => file.fileType === type)

describe('Stencil Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createStencilComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, TSX_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import { Component, h, Prop, State }')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Stencil Component Validator', () => {
  const generator = createStencilComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const jsFile = findFileByType(result.files, TSX_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import { Component, h, Prop, State }')
    expect(result.dependencies).toBeDefined()
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateComponent(invalidUidlSample)
    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const jsFile = findFileByType(result.files, TSX_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import { Component, h, Prop, State }')
    expect(result.dependencies).toBeDefined()
  })
})
