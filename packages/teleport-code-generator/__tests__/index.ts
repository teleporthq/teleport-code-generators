import { readFileSync, existsSync, readdirSync, unlinkSync, statSync, rmdirSync } from 'fs'
import { join } from 'path'

import projectJson from '../../../examples/test-samples/project-sample.json'
import { ProjectUIDL } from '@teleporthq/teleport-types'
import { element } from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

import { createCodeGenerator, PackerOptions, PublisherType, ProjectType } from '../src/index'
import { GenerateOptions, ComponentType } from '../src/types'
import { ReactStyleVariation } from '@teleporthq/teleport-component-generator-react'
import { PreactStyleVariation } from '@teleporthq/teleport-component-generator-preact'

const reactProjectPath = join(__dirname, 'react')
const nextProjectPath = join(__dirname, 'next')
const vueProjectPath = join(__dirname, 'vue')
const nuxtProjectPath = join(__dirname, 'nuxt')
const stencilProjectPath = join(__dirname, 'stencil')
const preactProjectPath = join(__dirname, 'preact')

const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')

const assets = [
  {
    data: base64File,
    name: 'asset',
    type: 'png',
  },
]

const projectUIDL = (projectJson as unknown) as ProjectUIDL
const componentUIDL = projectUIDL.components.ExpandableArea

afterAll(() => {
  // Comment these lines if you want to see the generated projects
  removeDirectory(reactProjectPath)
  removeDirectory(nextProjectPath)
  removeDirectory(vueProjectPath)
  removeDirectory(nuxtProjectPath)
  removeDirectory(stencilProjectPath)
  removeDirectory(preactProjectPath)
})

describe('code generator', () => {
  const packer = createCodeGenerator()
  it('should pack a react project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.REACT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: reactProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should pack a next project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.NEXT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: nextProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should pack a vue project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.VUE,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: vueProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should pack a nuxt project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.NUXT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: nuxtProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should pack a nuxt project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.STENCIL,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: stencilProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should pack a nuxt project', async () => {
    const options: PackerOptions = {
      projectType: ProjectType.PREACT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: preactProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
  })

  it('should generate a react component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.REACT,
      styleVariation: ReactStyleVariation.CSSModules,
    }

    const { files } = await packer.generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('should generate a preact component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.PREACT,
      styleVariation: PreactStyleVariation.CSS,
    }

    const { files } = await packer.generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('should generate a vue component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.VUE,
    }

    const { files } = await packer.generateComponent(componentUIDL, options)
    expect(files.length).toBe(1)
  })

  it('should generate a stencil component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.STENCIL,
    }

    const { files } = await packer.generateComponent(componentUIDL, options)
    expect(files.length).toBe(2)
  })

  it('should generate a angular component', async () => {
    const options: GenerateOptions = {
      componentType: ComponentType.ANGULAR,
    }

    const { files } = await packer.generateComponent(componentUIDL, options)
    expect(files.length).toBe(3)
  })

  it('should resolve an element with react mapping', async () => {
    const elementNode = element('container')
    const result = await packer.resolveElement(elementNode)
    expect(result.elementType).toBe('div')
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
