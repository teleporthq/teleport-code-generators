import {
  createHtmlIndexFile,
  createPackageJSONFile,
  createManifestJSONFile,
} from '../../src/utils/project-utils'

// @ts-ignore
import uidlSample from '../../../../examples/test-samples/project-sample.json'

describe('createHtmlIndexFile', () => {
  it('returns index file with prefixed assets and app file', () => {
    const HtmlIndexFileOptions = {
      assetsPrefix: 'playground',
      fileName: 'app',
      appRootOverride: 'SomeRandomText?',
    }
    const result = createHtmlIndexFile(uidlSample, HtmlIndexFileOptions)

    expect(result.name).toBe('app')
    expect(result.fileType).toBe('html')
    expect(result.content).toContain('<!DOCTYPE html>')
    expect(result.content).toContain(
      '<meta property="og:url" content="playground/playground_assets/'
    )
    expect(result.content).toContain('<body>\n    SomeRandomText?\n    ')
  })

  it('returns index file with no prefixed assets and index file', () => {
    const HtmlIndexFileOptions = {}
    const result = createHtmlIndexFile(uidlSample, HtmlIndexFileOptions)

    expect(result.name).toBe('index')
    expect(result.fileType).toBe('html')
    expect(result.content).toContain('<!DOCTYPE html>')
    expect(result.content).toContain('<meta property="og:url" content="/playground_assets/')
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

describe('createPackageJSONFile', () => {
  it('returns package JSON file', () => {
    const packageJSONTemplate = {
      name: 'template',
      description: 'test template',
      version: '1',
      main: 'index.js',
      author: 'teleportHQ',
      license: 'MIT',
      dependencies: {},
    }
    const options = {
      dependencies: { test: '1.0.0' },
      projectName: 'testProject',
    }
    const result = createPackageJSONFile(packageJSONTemplate, options)

    expect(result.name).toBe('package')
    expect(result.fileType).toBe('json')
    expect(result.content).toContain('"name": "testproject')
    expect(result.content).toContain('"dependencies": {\n    "test": "1.0.0"\n  }')
  })
})
