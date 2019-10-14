import uidlSample from '../../../../examples/test-samples/project-sample.json'
import template from './template-definition.json'
import { createReactNativeProjectGenerator } from '../../src'
import { ProjectUIDL } from '@teleporthq/teleport-types'

const projectUIDL = (uidlSample as unknown) as ProjectUIDL

describe('ReactNative Project Generator', () => {
  const generator = createReactNativeProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(projectUIDL, template)
    const assetsPath = generator.getAssetsPath()

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const srcFolder = outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('App')
    expect(srcFolder.files[0].fileType).toBe('js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[0].files.length).toBe(4)
    expect(srcFolder.subFolders[1].name).toBe('screens')
    expect(srcFolder.subFolders[1].files.length).toBe(3)
  })
})
