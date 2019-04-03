// @ts-ignore
import projectUIDLJSON from '../fixtures/project-sample.json'

import {
  createReactBasicGenerator,
  createReactNextGenerator,
  createVueBasicGenerator,
  createVueNuxtGenerator,
} from '../../src'

const projectUIDL = projectUIDLJSON as ProjectUIDL

describe('React Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const generator = createReactBasicGenerator()
    const result = await generator.generateProject(projectUIDL)

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
    const generator = createReactNextGenerator()
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
    const components = result.outputFolder.subFolders[1]
    const pages = result.outputFolder.subFolders[0]
    expect(components.files[0].name).toBe('OneComponent')
    expect(pages.files[0].name).toBe('_document')
    expect(pages.files[1].name).toBe('index')
  })
})

describe('Vue Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const generator = createVueBasicGenerator()
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})

describe('Vue Nuxt Project Generator', () => {
  it('runs without crashing', async () => {
    const generator = createVueNuxtGenerator()
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})
