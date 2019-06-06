// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

import { createReactNextGenerator } from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import template from './template-definition.json'

const projectUIDL = uidlSample as ProjectUIDL

describe('React Next Project Generator', () => {
  const generator = createReactNextGenerator()

  it('runs without crashing', async () => {
    const { assetsPath, outputFolder } = await generator.generateProject(projectUIDL, template)

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const components = outputFolder.subFolders[0]
    const pages = outputFolder.subFolders[1]

    expect(components.files[0].name).toBe('one-component')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
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

    const components = result.outputFolder.subFolders[0]
    const pages = result.outputFolder.subFolders[1]

    expect(components.files[0].name).toBe('one-component')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
  })
})
