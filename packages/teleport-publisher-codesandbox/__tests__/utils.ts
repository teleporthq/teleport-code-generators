import { convertToCodesandboxStructure } from '../src/utils'
import { createProjectFolder } from './mocks'

describe('convertToCodesandboxStructure', () => {
  it('creates a flat structure based on the given folder', () => {
    const folder = createProjectFolder()
    const result = convertToCodesandboxStructure(folder)
    expect(result['root-file'].content).toBe('<asdasd>')
    expect(result['src/file-1'].content).toBe('asdasd-1')
    expect(result['src/file-2'].content).toBe('asdasd-2')
  })
})
