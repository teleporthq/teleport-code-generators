import { createAngularComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-uidl-builders'

const TS_FILE = 'ts'
const HTML_FILE = 'html'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

const generator = createAngularComponentGenerator()

const uidl = component(
  'Repeat Component',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    ),
  ]),
  { items: definition('array', ['hello', 'world']) },
  {}
)

const uidlWithoutIndex = component(
  'Repeat Component',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      dynamicNode('prop', 'items'),
      {}
    ),
  ]),
  { items: definition('array', ['hello', 'world']) },
  {}
)

describe('Component with repeat node type', () => {
  it('renders code that contains *ngFor and adds index', async () => {
    const result = await generator.generateComponent(uidl)
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(result.files.length).toBe(2)
    expect(tsFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(tsFile.content).toContain(`@Input()`)
    expect(tsFile.content).toContain(`items: unknown = ['hello', 'world']`)
    expect(htmlFile.content).toContain(`*ngFor="let item of items; index as index"`)
  })

  it('renders code that contains *ngFor without index', async () => {
    const result = await generator.generateComponent(uidlWithoutIndex)
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(result.files.length).toBe(2)
    expect(tsFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(tsFile.content).toContain(`@Input()`)
    expect(tsFile.content).toContain(`items: unknown = ['hello', 'world']`)
    expect(htmlFile.content).toContain(`*ngFor="let item of items"`)
  })
})
