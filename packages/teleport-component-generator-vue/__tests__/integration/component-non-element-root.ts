import { createVueComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  staticNode,
  dynamicNode,
  conditionalNode,
  elementNode,
  definition,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = VUE_FILE) =>
  files.find((file) => file.fileType === type)

describe('Vue Component Generator support for non elements as root', () => {
  const generator = createVueComponentGenerator()
  it('should support static as root node', async () => {
    const uidl = component('StaticRootComponent', staticNode('Teleport Code Generators'))
    const result = await generator.generateComponent(uidl)
    const file = findFileByType(result.files, VUE_FILE)
    const { content } = file

    expect(VUE_FILE).toBeDefined()
    expect(content).toBeDefined()
    expect(result.files).toBeDefined()
    expect(content).toContain('<span>Teleport Code Generators')
    expect(result.files.length).toBeTruthy()
  })

  it('should support dynamic as root node', async () => {
    const prop = {
      name: {
        type: 'string',
        defaultValue: 'Teleport',
      },
    }
    const uidl = component('DynamicRootComponent', dynamicNode('prop', 'name'), prop)
    const result = await generator.generateComponent(uidl)
    const file = findFileByType(result.files, VUE_FILE)
    const { content } = file

    expect(VUE_FILE).toBeDefined()
    expect(result.files).toBeDefined()
    expect(content).toContain('<span>{{ name }}</span>')
    expect(content).toContain("default: 'Teleport'")
    expect(result.files.length).toBeTruthy()
  })

  it('should support conditional and string as root node', async () => {
    const uidl = component(
      'ComponentWithConditionalRootStringNode',
      conditionalNode(dynamicNode('state', 'isVisible'), staticNode('Now you can see me!'), true),
      {},
      { isVisible: definition('boolean', true) }
    )

    const result = await generator.generateComponent(uidl)
    const file = findFileByType(result.files, VUE_FILE)
    const { content } = file

    expect(result.files.length).toBeTruthy()
    expect(VUE_FILE).toBeDefined()
    expect(result.files).toBeDefined()
    expect(content).toContain('<span v-if="isVisible">Now you can see me!</span>')
  })

  it('should support conditional array as root node', async () => {
    const uidl = component(
      'ComponentWithConditionalRootArrayNode',
      conditionalNode(
        dynamicNode('state', 'isVisible'),
        elementNode('text', {}, [staticNode('Now you see me!')]),
        true
      ),
      {},
      { isVisible: definition('boolean', true) }
    )

    const result = await generator.generateComponent(uidl)
    const file = findFileByType(result.files, VUE_FILE)
    const { content } = file

    expect(VUE_FILE).toBeDefined()
    expect(result.files).toBeDefined()
    expect(result.files.length).toBeTruthy()
    expect(content).toContain('data() {')
    expect(content).toContain('v-if="isVisible"')
  })
})
