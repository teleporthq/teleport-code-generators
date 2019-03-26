// @ts-ignore
import projectUIDL from '../fixtures/project-sample.json'

import {
  createReactBasicProject,
  createReactNextProject,
  createVueBasicProject,
  createVueNuxtProject,
} from '../../src'

describe('React Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createReactBasicProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
    const srcFolder = result.outputFolder.subFolders[0]
    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].extension).toBe('.html')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].extension).toBe('.js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
})

describe('React Next Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createReactNextProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
    const components = result.outputFolder.subFolders[1]
    const pages = result.outputFolder.subFolders[0]
    expect(components.files[0].name).toBe('ExpandableArea')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
  })
})

describe('Vue Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createVueBasicProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})

describe('Vue Nuxt Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createVueNuxtProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})
