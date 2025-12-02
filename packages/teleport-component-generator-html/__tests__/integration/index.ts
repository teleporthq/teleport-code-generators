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

describe('data-node-id attribute support', () => {
  test('adds data-node-id to HTML elements when explicitly set in attrs', async () => {
    const generator = createHTMLComponentGenerator()
    const testComponent = component(
      'TestComponent',
      elementNode('container', { 'data-node-id': { type: 'static', content: 'my-custom-id' } })
    )
    const result = await generator.generateComponent(testComponent)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(htmlFile).toBeDefined()
    expect(htmlFile?.content).toContain('data-node-id="my-custom-id"')
  })

  test('adds data-node-id to component instance wrapper tags when explicitly set', async () => {
    const generator = createHTMLComponentGenerator()
    const childComponent = component('ChildComponent', elementNode('container', {}))
    generator.addExternalComponents({
      externals: {
        ChildComponent: childComponent,
      },
      options: {},
    })

    const parentComponent = component(
      'ParentComponent',
      elementNode(
        'container',
        {},
        [
          elementNode(
            'ChildComponent',
            { 'data-node-id': { type: 'static', content: 'component-wrapper-id' } },
            [],
            {
              type: 'local',
            }
          ),
        ]
      )
    )
    const result = await generator.generateComponent(parentComponent)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(htmlFile).toBeDefined()
    expect(htmlFile?.content).toContain('data-node-id="component-wrapper-id"')
  })

  test('adds data-node-id to code embed wrapper when explicitly set', async () => {
    const generator = createHTMLComponentGenerator()
    const testComponent = component(
      'TestComponent',
      elementNode('container', {}, [
        elementNode('html-node', {
          'data-node-id': { type: 'static', content: 'embed-wrapper-id' },
          html: { type: 'raw', content: '<div>Embedded HTML</div>' },
        }),
      ])
    )
    const result = await generator.generateComponent(testComponent)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(htmlFile).toBeDefined()
    expect(htmlFile?.content).toContain('data-node-id="embed-wrapper-id"')
  })

  test('does not add data-node-id when not explicitly set', async () => {
    const generator = createHTMLComponentGenerator()
    const testComponent = component('TestComponent', elementNode('container', {}))
    const result = await generator.generateComponent(testComponent)
    const htmlFile = result.files.find((file) => file.fileType === FileType.HTML)

    expect(htmlFile).toBeDefined()
    expect(htmlFile?.content).not.toContain('data-node-id')
  })
})
