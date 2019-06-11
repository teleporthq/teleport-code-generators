import {
  generateLocalDependenciesPrefix,
  handlePackageJSON,
  createHtmlIndexFile,
  createManifestJSONFile,
} from '../src/utils'
import { PackageJSON } from '../src/types'
import { GeneratedFolder, ProjectUIDL, HastNode, HastText } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-shared/lib/builders/uidl-builders'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

// @ts-ignore
import uidlSample from '../../../examples/test-samples/project-sample.json'

describe('createHtmlIndexFile', () => {
  it('returns index file with prefixed assets and app file', () => {
    const HtmlIndexFileOptions = {
      assetsPrefix: 'playground',
      fileName: 'app',
      appRootOverride: '-root-placeholder-',
    }
    const result = createHtmlIndexFile(uidlSample, HtmlIndexFileOptions)

    expect(result.tagName).toBe('html')
    expect(result.children.length).toBe(2)

    const body = result.children[1] as HastNode
    expect(body.children[0].type).toBe('text')
    expect((body.children[0] as HastText).value).toBe(HtmlIndexFileOptions.appRootOverride)
  })
})

describe('createManifestJSONFile', () => {
  it('returns manifest file with prefixed assets', () => {
    const assetsPrefix = 'playground'
    const result = createManifestJSONFile(uidlSample, assetsPrefix)

    expect(result.name).toBe('manifest')
    expect(result.fileType).toBe('json')
    expect(result.content).toContain('"src": "playground/playground_assets/')
  })

  it('returns manifest file with no prefixed assets', () => {
    const result = createManifestJSONFile(uidlSample)

    expect(result.name).toBe('manifest')
    expect(result.fileType).toBe('json')
    expect(result.content).toContain('"src": "/playground_assets/')
  })
})

describe('generateLocalDependenciesPrefix', () => {
  it('works when there is a common parent', () => {
    const from = ['src', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../to/')
  })

  it('works when there is no common parent', () => {
    const from = ['dist', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../../src/to/')
  })

  it('works when to is a parent of from', () => {
    const from = ['src', 'from']
    const to = ['src']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../')
  })

  it('works when to is a child of from', () => {
    const from = ['src']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./to/')
  })

  it('works when they are identical', () => {
    const from = ['src', 'from']
    const to = ['src', 'from']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./')
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

    expect(template.files[0].fileType === FILE_TYPE.JSON)
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
          fileType: FILE_TYPE.JSON,
          content: JSON.stringify(templatePackageJSON),
        },
      ],
      subFolders: [],
    }

    handlePackageJSON(template, uidl, dependencies)

    expect(template.files[0].fileType === FILE_TYPE.JSON)
    expect(template.files[0].name === 'package')

    const jsonContent = JSON.parse(template.files[0].content) as PackageJSON
    expect(Object.keys(jsonContent.dependencies).length).toBe(3)
    expect(jsonContent.name).toBe('test-project')
    expect(jsonContent.version).toBe('1.2.3')
  })
})
