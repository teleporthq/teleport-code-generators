import { createReactComponentGenerator } from '../../src'
import componentUIDL from '../../../../examples/uidl-samples/component.json'
import { FileType } from '@teleporthq/teleport-types'

describe('declares a propDefinitions with type object and use it', () => {
  test('use the value from the object in prop', async () => {
    const generator = createReactComponentGenerator()
    const result = await generator.generateComponent(componentUIDL)
    const jsFile = result.files.find((file) => file.fileType === FileType.JS)

    expect(jsFile).toBeDefined()
    expect(jsFile?.content).toContain('config: PropTypes.object')
    expect(jsFile?.content).toContain("height: props.config?.['height']")
    expect(jsFile?.content).toContain(`config: {
    height: 30,
    width: 30,
  }`)
  })
})
