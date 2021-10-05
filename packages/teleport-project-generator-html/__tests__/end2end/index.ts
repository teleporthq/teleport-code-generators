import uidlSample from '../../../../examples/uidl-samples/simple-html.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import { createHTMLProjectGenerator } from '../../src'
import HTMLTemplate from '../../src/project-template'

describe('Html Project Generator', () => {
  const generator = createHTMLProjectGenerator()

  it('runs without crasing', async () => {
    const { name, files, subFolders } = await generator.generateProject(uidlSample, HTMLTemplate)

    expect(name).toBe('teleport-project-html')
    expect(files.length).toBe(1)
    expect(files[0].content).toContain('start')
    expect(subFolders.length).toBe(2)
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, HTMLTemplate)
    await expect(result).rejects.toThrow(Error)
  })
})
