import { createAngularComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  definition,
  staticNode,
  dynamicNode,
  elementNode,
  conditionalNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

const generator = createAngularComponentGenerator()

const TS_FILE = 'ts'
const HTML_FILE = 'html'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

const uidl = component(
  'Conditional Component',
  elementNode('container', {}, [
    conditionalNode(
      dynamicNode('state', 'isVisible'),
      elementNode('text', {}, [staticNode('Now you see me!')]),
      true
    ),
    conditionalNode(
      dynamicNode('state', 'isShareable'),
      elementNode('text', {}, [staticNode('I am not shareable!')]),
      false
    ),
  ]),
  {},
  { isVisible: definition('boolean', true), isShareable: definition('boolean', false) }
)

describe('Component with conditional node type', () => {
  it('renders code with condition if value on state is true', async () => {
    const result = await generator.generateComponent(uidl)
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(result.files.length).toBe(2)
    expect(tsFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(tsFile.content).toContain('isVisible: boolean = true')
    expect(htmlFile.content).toContain('*ngIf="isVisible"')
  })

  it('renders code with !condition if value on state is false', async () => {
    const result = await generator.generateComponent(uidl)
    const jsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(result.files.length).toBe(2)
    expect(jsFile).toBeDefined()
    expect(htmlFile).toBeDefined()
    expect(jsFile.content).toContain('isShareable: boolean = false')
    expect(htmlFile.content).toContain('*ngIf="!isShareable"')
  })
})
