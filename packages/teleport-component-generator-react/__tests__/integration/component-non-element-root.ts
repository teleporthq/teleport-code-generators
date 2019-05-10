// @ts-ignore
import ComponentWithStaticRootNode from '../integration/component-with-static-root-node.json'
// @ts-ignore
import ComponentWithDynamicRootNode from '../integration/component-with-dynamic-root-node.json'
// @ts-ignore
import ComponentWithConditionalRootStringNode from '../integration/component-with-conditional-root-string-child-node.json'
// @ts-ignore
import ComponentWithConditionalRootArrayNode from '../integration/component-with-conditional-root-array-child-node.json'

import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('React Component Generator support for non elements as root', () => {
  const generator = createReactComponentGenerator()
  it('should support static as root node', async () => {
    const result = await generator.generateComponent(ComponentWithStaticRootNode)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain(`(props) => 'Teleport Code Generators'`)
    expect(result.files.length).toBeTruthy()
  })

  it('should support dynamic as root node', async () => {
    const result = await generator.generateComponent(ComponentWithDynamicRootNode)
    const jsFile = findFileByType(result.files, JS_FILE)

    expect(jsFile).toBeDefined()
    expect(result.files).toBeDefined()
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain('(props) => props.name')
    expect(jsFile.content).toContain('PropTypes.string')
    expect(result.files.length).toBeTruthy()
  })

  it('should support conditional string as root node', async () => {
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
    expect(jsFile.content).toContain('import React')
    expect(result.dependencies).toBeDefined()
    expect(jsFile.content).toContain('(props) => props.isVisible && <span>Now you see me!</span>')
    expect(result.files.length).toBeTruthy()
  })
})
