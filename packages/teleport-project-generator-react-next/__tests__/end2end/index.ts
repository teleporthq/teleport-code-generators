// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

import createReactNextGenerator from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const projectUIDL = uidlSample as ProjectUIDL

describe('React Next Project Generator', () => {
  const generator = createReactNextGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')

    const components = result.outputFolder.subFolders[1]
    const pages = result.outputFolder.subFolders[0]

    expect(components.files[0].name).toBe('one-component')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })
  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, options)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')

    const components = result.outputFolder.subFolders[1]
    const pages = result.outputFolder.subFolders[0]

    expect(components.files[0].name).toBe('one-component')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
  })
})
