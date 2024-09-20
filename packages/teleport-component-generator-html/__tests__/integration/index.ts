import { createHTMLComponentGenerator } from '../../src'
import componentUIDL from '../../../../examples/uidl-samples/component.json'
import { FileType } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'

describe('declares a propDefinitions with type object and use it', () => {
  test('use the value from the object in prop', async () => {
    const generator = createHTMLComponentGenerator()
    generator.addExternalComponents({
      externals: {
        sample: component('Sample', elementNode('container', {})),
      },
      options: {},
    })
    const result = await generator.generateComponent(componentUIDL)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(htmlFile).toBeDefined()
    expect(htmlFile?.content).toContain('teleportHQCluj')
  })
})
