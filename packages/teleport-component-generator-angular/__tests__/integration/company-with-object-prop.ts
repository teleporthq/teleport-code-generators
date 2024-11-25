import { createAngularComponentGenerator } from '../../src'
import componentUIDL from '../../../../examples/uidl-samples/component.json'
import { FileType } from '@teleporthq/teleport-types'

describe('declares a propDefinitions with type object and use it', () => {
  test('use the value from the object in prop', async () => {
    const generator = createAngularComponentGenerator()
    const result = await generator.generateComponent(componentUIDL)
    const jsFile = result.files.find((file) => file.fileType === FileType.TS)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(jsFile?.content).toContain(`@Input()
  company: any = {
    name: 'teleportHQ',
    location: {
      city: 'Cluj',
    },
  }`)
    expect(htmlFile?.content).toContain(
      "{{ company?.['name'] }}{{ company?.['location']?.['city'] }}"
    )
  })
})
