import { createVueComponentGenerator } from '../../src'
import componentUIDL from '../../../../examples/uidl-samples/component.json'
import { FileType } from '@teleporthq/teleport-types'

describe('declares a propDefinitions with type object and use it', () => {
  test('use the value from the object in prop', async () => {
    const generator = createVueComponentGenerator()
    const result = await generator.generateComponent(componentUIDL)
    const vueFile = result.files.find((file) => file.fileType === FileType.VUE)

    expect(vueFile?.content).toContain(
      "{{ company?.['name'] }}{{ company?.['location']?.['city'] }}"
    )
    expect(vueFile?.content).toContain(`company: {
      type: Object,
      default: () => ({
        name: 'teleportHQ',
        location: {
          city: 'Cluj',
        },
      }),
    }`)
  })
})
