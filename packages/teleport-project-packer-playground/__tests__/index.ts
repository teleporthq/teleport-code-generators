import { readFileSync, existsSync, readdirSync, unlinkSync, statSync, rmdirSync } from 'fs'
import { join } from 'path'

// @ts-ignore
import projectJson from '../../../examples/test-samples/project-sample.json'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import { createPlaygroundPacker, PackerOptions, PublisherType, ProjectType } from '../src/index'

const reactProjectPath = join(__dirname, 'react')
const nextProjectPath = join(__dirname, 'next')
const vueProjectPath = join(__dirname, 'vue')
const nuxtProjectPath = join(__dirname, 'nuxt')

const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')

const assets = [
  {
    data: base64File,
    name: 'asset',
    type: 'png',
  },
]

const projectUIDL = projectJson as ProjectUIDL

afterAll(() => {
  // Comment these lines if you want to see the generated projects
  removeDirectory(reactProjectPath)
  removeDirectory(nextProjectPath)
  removeDirectory(vueProjectPath)
  removeDirectory(nuxtProjectPath)
})

describe('project packer playground', () => {
  it('creates a new instance of the project packer playground', () => {
    const packer = createPlaygroundPacker()
    expect(packer.packProject).toBeDefined()
  })

  it('should pack a react project', async () => {
    const packer = createPlaygroundPacker()
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
    const packer = createPlaygroundPacker()
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
    const packer = createPlaygroundPacker()
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
    const packer = createPlaygroundPacker()
    const options: PackerOptions = {
      projectType: ProjectType.NUXT,
      assets,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: nuxtProjectPath },
    }

    const { success } = await packer.packProject(projectUIDL, options)
    expect(success).toBeTruthy()
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
