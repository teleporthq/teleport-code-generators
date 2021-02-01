import { handlePackageJSON, createEntryFile, createManifestJSONFile } from '../src/file-handlers'
import { PackageJSON } from '../src/types'
import { GeneratedFolder, ProjectUIDL, FileType } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createStrategyWithCommonGenerator } from './mocks'

import uidlSample from '../../../examples/test-samples/project-sample.json'

describe('createHtmlIndexFile', () => {
  it('returns index file with prefixed assets and app file', async () => {
    const options = {
      assetsPrefix: '/static',
      appRootOverride: '{{root-placeholder}}',
    }
    const [entryFile] = await createEntryFile(
      (uidlSample as unknown) as ProjectUIDL,
      createStrategyWithCommonGenerator(),
      createComponentGenerator(),
      options
    )

    expect(entryFile.content).toContain('<html')
    expect(entryFile.content).toContain('{{root-placeholder}}')
  })
})

describe('createManifestJSONFile', () => {
  it('returns manifest file with prefixed assets', () => {
    const assetsPrefix = 'playground'
    const result = createManifestJSONFile((uidlSample as unknown) as ProjectUIDL, assetsPrefix)

    expect(result.name).toBe('manifest')
    expect(result.fileType).toBe('json')
    expect(result.content).toContain('"src": "playground/playground_assets/')
  })

  it('returns manifest file with no prefixed assets', () => {
    const result = createManifestJSONFile((uidlSample as unknown) as ProjectUIDL)

    expect(result.name).toBe('manifest')
    expect(result.fileType).toBe('json')
    expect(result.content).toContain('"src": "/playground_assets/')
  })
})

describe('handlePackageJSON', () => {
  const uidl: ProjectUIDL = {
    name: 'test-project',
    globals: { settings: { title: 'Random', language: 'en' }, meta: [], assets: [] },
    root: component('random', elementNode('container')),
  }

  const dependencies = {
    'test-package': '^0.5.0',
    'another-test': '1.0.0',
  }

  it('creates one from scratch if template does not provide it', () => {
    const template: GeneratedFolder = {
      name: 'template',
      files: [],
      subFolders: [],
    }

    handlePackageJSON(template, uidl, dependencies)

    expect(template.files[0].fileType === FileType.JSON)
    expect(template.files[0].name === 'package')

    const jsonContent = JSON.parse(template.files[0].content) as PackageJSON
    expect(Object.keys(jsonContent.dependencies).length).toBe(2)
    expect(jsonContent.name).toBe('test-project')
  })

  it('appends data to the original one', () => {
    const templatePackageJSON: PackageJSON = {
      name: 'template-name',
      version: '1.2.3',
      description: 'package description',
      dependencies: {
        'template-dependency': '2.0.0',
      },
    }

    const template: GeneratedFolder = {
      name: 'template',
      files: [
        {
          name: 'package',
          fileType: FileType.JSON,
          content: JSON.stringify(templatePackageJSON),
        },
      ],
      subFolders: [],
    }

    handlePackageJSON(template, uidl, dependencies)

    expect(template.files[0].fileType === FileType.JSON)
    expect(template.files[0].name === 'package')

    const jsonContent = JSON.parse(template.files[0].content) as PackageJSON
    expect(Object.keys(jsonContent.dependencies).length).toBe(3)
    expect(jsonContent.name).toBe('test-project')
    expect(jsonContent.version).toBe('1.2.3')
  })
})
