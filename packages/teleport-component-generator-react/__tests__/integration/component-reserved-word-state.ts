/**
 * A UIDL state name is DATA — it mirrors a database column, and a WoW character
 * sheet has a column called `class`. The generator turned that straight into a
 * JS binding:
 *
 *   const [class, setClass] = useState("")
 *
 * which is a SyntaxError, so the prettier post-processor threw and `packProject`
 * aborted — every page of the project failed to generate, not just this one.
 *
 * These tests exercise the reserved name in every position a state can appear
 * (declaration, text binding, attribute binding, conditional, event setter).
 * `createReactComponentGenerator()` runs the prettier post-processor, so a
 * generation that RESOLVES is itself proof that the emitted module parses —
 * a missed emission site would reject here.
 */

import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  definition,
  staticNode,
  dynamicNode,
  elementNode,
  conditionalNode,
} from '@teleporthq/teleport-uidl-builders'

const generator = createReactComponentGenerator()

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

const reservedStateUidl = component(
  'Character Sheet',
  elementNode('container', {}, [
    // Text binding.
    elementNode('text', {}, [dynamicNode('state', 'class')]),
    // Attribute binding.
    elementNode('input', { value: dynamicNode('state', 'class') }, []),
    // Conditional.
    conditionalNode(
      dynamicNode('state', 'class'),
      elementNode('text', {}, [staticNode('Class chosen')]),
      true
    ),
    // Event setter.
    elementNode('button', {}, [staticNode('Reset')], null, null, {
      click: [{ type: 'stateChange', modifies: 'class', newState: '' }],
    }),
    // A neighbouring ordinary state must be untouched by the fix.
    elementNode('text', {}, [dynamicNode('state', 'realm')]),
  ]),
  {},
  {
    class: definition('string', ''),
    realm: definition('string', ''),
  }
)

describe('Component with a RESERVED-WORD state name', () => {
  it('generates a module that parses (prettier would reject `const [class, …]`)', async () => {
    const result = await generator.generateComponent(reservedStateUidl)
    expect(findFileByType(result.files, JS_FILE)).toBeDefined()
  })

  it('declares the state under a bindable identifier', async () => {
    const { content } = findFileByType(
      (await generator.generateComponent(reservedStateUidl)).files,
      JS_FILE
    )
    expect(content).toContain('const [class_, setClass] = useState')
    expect(content).not.toContain('const [class,')
  })

  it('reads the state through the SAME identifier it declared', async () => {
    const { content } = findFileByType(
      (await generator.generateComponent(reservedStateUidl)).files,
      JS_FILE
    )
    // Text + attribute + conditional all bind the sanitised name.
    // (`value` is emitted as React's `defaultValue` by the attribute mapper.)
    expect(content).toContain('{class_}')
    expect(content).toContain('defaultValue={class_}')
    expect(content).toContain('{class_ && ')
  })

  it('calls the setter for the state-change event', async () => {
    const { content } = findFileByType(
      (await generator.generateComponent(reservedStateUidl)).files,
      JS_FILE
    )
    expect(content).toContain('setClass(')
  })

  it('leaves an ordinary neighbouring state byte-identical', async () => {
    const { content } = findFileByType(
      (await generator.generateComponent(reservedStateUidl)).files,
      JS_FILE
    )
    expect(content).toContain('const [realm, setRealm] = useState')
    expect(content).toContain('{realm}')
  })
})
