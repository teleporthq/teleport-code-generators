import { readFileSync, existsSync, readdirSync, unlinkSync, statSync, rmdirSync } from 'fs'
import { join } from 'path'
import { performance } from 'perf_hooks'
import projectJson from '../../../examples/test-samples/project-sample.json'
import htmlProjectJson from '../../../examples/uidl-samples/project.json'
import {
  ProjectUIDL,
  GenerateOptions,
  ComponentType,
  PackerOptions,
  PublisherType,
  ProjectType,
  ReactStyleVariation,
  PreactStyleVariation,
  ComponentUIDL,
} from '@teleporthq/teleport-types'
import { packProject, generateComponent } from '../src/index'

const reactProjectPath = join(__dirname, 'react')
const nextProjectPath = join(__dirname, 'next')
const vueProjectPath = join(__dirname, 'vue')
const nuxtProjectPath = join(__dirname, 'nuxt')
const stencilProjectPath = join(__dirname, 'stencil')
const preactProjectPath = join(__dirname, 'preact')
const htmlProjectPath = join(__dirname, 'html')
const gatsbyProjectPath = join(__dirname, 'gatsby')
const gridsomeProjectPath = join(__dirname, 'gridsome')
const angularProjectPath = join(__dirname, 'angular')

const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')

const assets = [
  {
    content: base64File,
    name: 'asset',
    fileType: 'png',
  },
]

const projectUIDL = projectJson as unknown as ProjectUIDL
const componentUIDL = (projectUIDL.components as Record<string, ComponentUIDL>).ExpandableArea

afterAll(() => {
  // Comment these lines if you want to see the generated projects
  removeDirectory(reactProjectPath)
  removeDirectory(nextProjectPath)
  removeDirectory(vueProjectPath)
  removeDirectory(nuxtProjectPath)
  removeDirectory(stencilProjectPath)
  removeDirectory(preactProjectPath)
  removeDirectory(htmlProjectPath)
  removeDirectory(gatsbyProjectPath)
  removeDirectory(gridsomeProjectPath)
  removeDirectory(angularProjectPath)
})

describe('Performance tests for the code-generator', () => {
  const runs = 20
  let totalTime = 0

  it('Runs React project generaotr multiple times and tests for memory leaks', async () => {
    totalTime = 0
    for (let i = 0; i <= runs; i++) {
      const t1 = performance.now()
      await packProject(projectUIDL as unknown as ProjectUIDL, {
        projectType: ProjectType.REACT,
      })
      const t2 = performance.now()
      const timeTaken = Number((t2 - t1).toFixed(2))
      totalTime = totalTime + timeTaken
    }

    expect(totalTime / runs).toBeLessThan(500)
  })
})

describe('code generator', () => {
  it('creates a react project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.REACT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: reactProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a next project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.NEXT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: nextProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a vue project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.VUE,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: vueProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a nuxt project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.NUXT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: nuxtProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a stencil project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.STENCIL,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: stencilProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a preact project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.PREACT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: preactProjectPath },
    }

    const { success } = await packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a html project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.HTML,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: htmlProjectPath },
    }

    const { success } = await packProject(htmlProjectJson as unknown as ProjectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a angular project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.ANGULAR,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: angularProjectPath },
    }

    const { success } = await packProject(htmlProjectJson as unknown as ProjectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a gatsby project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.GATSBY,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: gatsbyProjectPath },
    }

    const { success } = await packProject(htmlProjectJson as unknown as ProjectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a gridsome project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.GRIDSOME,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: gridsomeProjectPath },
    }

    const { success } = await packProject(htmlProjectJson as unknown as ProjectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('creates a react component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.REACT,
      styleVariation: ReactStyleVariation.CSSModules,
    }

    const { files } = await generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('creates a preact component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.PREACT,
      styleVariation: PreactStyleVariation.CSS,
    }

    const { files } = await generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('creates a vue component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.VUE,
    }

    const { files } = await generateComponent(componentUIDL, options)
    expect(files.length).toBe(1)
  })

  it('creates a stencil component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.STENCIL,
    }

    const { files } = await generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('creates an angular component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.ANGULAR,
    }

    const { files } = await generateComponent(componentUIDL, options)
    expect(files.length).toBe(3)
  })

  it('throws an error when given an invalid ProjectType', async () => {
    // @ts-ignore
    const result = packProject(projectUIDL, { projectType: 'random' })
    await expect(result).rejects.toThrow(Error)
  })

  it('throws an error when given an invalid Publisher', async () => {
    // @ts-ignore
    const result = packProject(projectUIDL, { publisher: 'random' })
    await expect(result).rejects.toThrow(Error)
  })
})

const removeDirectory = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    return
  }

  const files = readdirSync(dirPath)

  for (const file of files) {
    const filePath = join(dirPath, file)
    statSync(filePath).isFile() ? unlinkSync(filePath) : removeDirectory(filePath)
  }

  rmdirSync(dirPath)
}
