import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src/index'
import { createComponentChunk } from './mocks'

describe('plugin-react-styled-jsx', () => {
  const plugin = createReactStyledJSXPlugin()

  it('adds nothing on the AST if not styles are defined', async () => {
    const uidlSample = component('StyledJSX', elementNode('container'))
    uidlSample.node.content.key = 'container'
    const componentChunk = createComponentChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const oldStructure = JSON.stringify(structure)
    await plugin(structure)
    const newStructure = JSON.stringify(structure)

    expect(oldStructure).toBe(newStructure)
  })
})
