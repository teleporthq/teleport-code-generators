import uidlSampleJSON from '../../../examples/test-samples/component-sample.json'
import { createReactNativeComponentGenerator } from '../src'
import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'

const uidlSample = uidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('ReactNative Component Generator', () => {
  describe('with default settings', () => {
    const generator = createReactNativeComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBeTruthy()
      expect(jsFile.content).toContain('import React')
      expect(jsFile.content).toContain('<View')
      expect(jsFile.content).toContain('<Text')
      expect(result.dependencies).toBeDefined()
    })
  })
})
