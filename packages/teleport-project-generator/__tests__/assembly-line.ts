import { ReactStyleVariation } from '@teleporthq/teleport-types'
import AssemblyLine from '../src/assembly-line'
import { mockAssemblyLineStructure, simplePluginMock, simplePluginMockToInjectFiles } from './mocks'

describe('Tests Project Aseembly line', () => {
  const assembly = new AssemblyLine([simplePluginMock])

  it('Plugin returns structure with style modified in runBefore life-cycle', async () => {
    const result = await assembly.runBefore(mockAssemblyLineStructure())

    expect(result).toBeDefined()
    expect(result.strategy.style).toBe(ReactStyleVariation.CSS)
    expect(Object.keys(result.dependencies).length).not.toBe(1)
    expect(Object.keys(result.devDependencies).length).not.toBe(1)
  })

  it('Plugin returns structure with dependencies modified in run-after life-cycle', async () => {
    const result = await assembly.runAfter(mockAssemblyLineStructure())

    expect(result).toBeDefined()
    expect(Object.keys(result.dependencies).length).toBe(1)
    expect(Object.keys(result.devDependencies).length).toBe(1)
  })

  it('Adds multiple plugins to assembly-line', async () => {
    assembly.addPlugin(simplePluginMockToInjectFiles)
    const result = await assembly.runAfter(mockAssemblyLineStructure())
    const { dependencies, devDependencies, files } = result
    const configFile = files.get('config')

    expect(result).toBeDefined()
    expect(Object.keys(dependencies).length).toBe(1)
    expect(Object.keys(devDependencies).length).toBe(1)
    /* tslint:disable:no-string-literal */
    expect(dependencies['react']).toBe(`^16.0.8`)
    expect(configFile).toBeDefined()
    expect(configFile.files[0].content).toContain(`cssModules: true`)
  })
})
