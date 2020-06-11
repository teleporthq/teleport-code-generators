// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createPreactComponentGenerator } from '../../src'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Preact Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createPreactComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBe(1)
      expect(jsFile.content).toContain('import { Component }')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Preact Component Validator', () => {
  const generator = createPreactComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import { Component }')
    expect(result.dependencies).toBeDefined()
  })

  it('Additational fields are removed by decoders and uidl is used to generate', async () => {
    const result = await generator.generateComponent(invalidUidlSample)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain(`import { Component } from 'preact'`)
    expect(result.dependencies).toBeDefined()
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files.length).toBe(1)
    expect(jsFile.content).toContain('import { Component }')
    expect(result.dependencies).toBeDefined()
  })
})
