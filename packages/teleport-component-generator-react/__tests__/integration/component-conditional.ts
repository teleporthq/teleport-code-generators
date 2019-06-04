import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  definition,
  staticNode,
  dynamicNode,
  elementNode,
  conditionalNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

const generator = createReactComponentGenerator()

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
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
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('{isVisible && <span>Now you see me!</span>}')
  })
  it('renders code with !condition if value on state is false', async () => {
    const result = await generator.generateComponent(uidl)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('{!isShareable && <span>I am not shareable!</span>}')
  })
})
