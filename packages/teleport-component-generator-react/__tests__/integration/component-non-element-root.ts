// @ts-ignore
import ComponentWithConditionalRootStringNode from '../integration/component-with-conditional-root-string-child-node.json'
// @ts-ignore
import ComponentWithConditionalRootArrayNode from '../integration/component-with-conditional-root-array-child-node.json'

import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import {
  component,
  staticNode,
  dynamicNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Component Generator support for non elements as root', () => {
  const generator = createReactComponentGenerator()
  it('should support static as root node', async () => {
    const uidl = component('StaticRootComponent', staticNode('Teleport Code Generators'))
    const result = await generator.generateComponent(uidl)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain(`() => 'Teleport Code Generators'`)
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
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain('(props) => props.name')
    expect(jsFile.content).toContain('PropTypes.string')
    expect(result.files.length).toBeTruthy()
  })

  it('should support conditional as root node', async () => {
    const result = await generator.generateComponent(ComponentWithConditionalRootStringNode)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain("(props) => props.test && 'test'")
    expect(result.files.length).toBeTruthy()
  })

  it('should support conditional array as root node', async () => {
    const result = await generator.generateComponent(ComponentWithConditionalRootArrayNode)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React, { useState }')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain('[isVisible, setIsVisible]')
    expect(jsFile.content).toContain('isVisible && <span>Now you see me!</span>')
    expect(result.files.length).toBeTruthy()
  })
})
