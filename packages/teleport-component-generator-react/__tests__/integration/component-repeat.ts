import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

const generator = createReactComponentGenerator()

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

describe('Component with repeat node type', () => {
  it('renders code that contains map method', async () => {
    const result = await generator.generateComponent(uidl)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('props.items.map((item, index)')
  })
  it('renders code with map method that iterates using index', async () => {
    const result = await generator.generateComponent(uidl)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('key={index}')
  })
})
