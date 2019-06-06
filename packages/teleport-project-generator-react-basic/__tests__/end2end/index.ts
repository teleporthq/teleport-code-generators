// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

import { createReactBasicGenerator } from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import template from './template-definition.json'

const projectUIDL = uidlSample as ProjectUIDL

describe('React Basic Project Generator', () => {
  const generator = createReactBasicGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL, template)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe(template.name)
    expect(result.outputFolder.files[0].name).toBe('package')

    const srcFolder = result.outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, template, undefined, options)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe(template.name)
    expect(result.outputFolder.files[0].name).toBe('package')

    const srcFolder = result.outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
})
