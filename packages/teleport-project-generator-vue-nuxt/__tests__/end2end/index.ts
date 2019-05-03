// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'

import createVueNuxtGenerator from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

const projectUIDL = uidlSample as ProjectUIDL

describe('Vue Nuxt Project Generator', () => {
  const generator = createVueNuxtGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
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
  })
})
