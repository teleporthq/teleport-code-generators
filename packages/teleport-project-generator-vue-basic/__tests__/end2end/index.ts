// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
// @ts-ignore
import template from './template-definition.json'
import { createVueBasicGenerator } from '../../src'

describe('Vue Basic Project Generator', () => {
  const generator = createVueBasicGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(uidlSample, template)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe(template.name)
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, template, options)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe(template.name)
  })
})
