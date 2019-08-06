// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createAngularComponentGenerator } from '../../src'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const TS_FILE = 'ts'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Angular Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createAngularComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const tsFile = findFileByType(result.files, TS_FILE)

      expect(tsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBe(2)
      expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Angular Component Validator', () => {
  const generator = createAngularComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const tsFile = findFileByType(result.files, TS_FILE)

    expect(tsFile).toBeDefined()
    expect(result.files.length).toBe(2)
    expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
    expect(result.dependencies).toBeDefined()
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateComponent(invalidUidlSample)
    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const tsFile = findFileByType(result.files, TS_FILE)

    expect(tsFile).toBeDefined()
    expect(result.files.length).toBe(2)
    expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
    expect(result.dependencies).toBeDefined()
  })
})
