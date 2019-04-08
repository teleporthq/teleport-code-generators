// @ts-ignore
import uidlSample from '../fixtures/project-sample.json'
// @ts-ignore
import invalidUidlSample from '../fixtures/project-invalid-sample.json'

import {
  createReactBasicGenerator,
  createReactNextGenerator,
  createVueBasicGenerator,
  createVueNuxtGenerator,
} from '../../src'
import { ProjectUIDL } from '../../src/typings/uidl-definitions'

const projectUIDL = uidlSample as ProjectUIDL

describe('React Basic Project Generator', () => {
  const generator = createReactBasicGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')

    const srcFolder = result.outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, options)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')

    const srcFolder = result.outputFolder.subFolders[0]

    expect(srcFolder.files[0].name).toBe('index')
    expect(srcFolder.files[0].fileType).toBe('html')
    expect(srcFolder.files[1].name).toBe('index')
    expect(srcFolder.files[1].fileType).toBe('js')
    expect(srcFolder.subFolders[0].name).toBe('components')
    expect(srcFolder.subFolders[1].name).toBe('pages')
  })
})

describe('React Next Project Generator', () => {
  const generator = createReactNextGenerator()

  it('runs without crashing', async () => {
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
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })
  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, options)

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
  const generator = createVueBasicGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, options)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})

describe('Vue Nuxt Project Generator', () => {
  const generator = createVueNuxtGenerator()

  it('runs without crashing', async () => {
    const result = await generator.generateProject(projectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample)

    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateProject(invalidUidlSample, options)
    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})
