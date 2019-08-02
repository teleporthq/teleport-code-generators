import { readFileSync, existsSync, readdirSync, unlinkSync, statSync, rmdirSync } from 'fs'
import { join } from 'path'

// @ts-ignore
import projectJson from '../../../examples/test-samples/project-sample.json'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import { createPlaygroundPacker, PackerFactoryParams } from '../src/index'

// @ts-ignore
import reactVariation from './react-variation.json'
// @ts-ignore
import nextVariation from './next-variation.json'
// @ts-ignore
import vueVariation from './vue-variation.json'
// @ts-ignore
import nuxtVariation from './nuxt-variation.json'

const reactProjectPath = join(__dirname, 'react')
const nextProjectPath = join(__dirname, 'next')
const vueProjectPath = join(__dirname, 'vue')
const nuxtProjectPath = join(__dirname, 'nuxt')

const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')

const assetsData = {
  assets: [
    {
      data: base64File,
      name: 'asset',
      type: 'png',
    },
  ],
  meta: {
    prefix: [''],
  },
}

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
    expect(packer.loadTemplate).toBeDefined()
    expect(packer.pack).toBeDefined()
  })

  it('should pack a react project', async () => {
    const packer = createPlaygroundPacker()
    const factoryParams: PackerFactoryParams = JSON.parse(JSON.stringify(reactVariation))

    factoryParams.assets = assetsData
    factoryParams.publisher.meta = { outputPath: reactProjectPath }

    const { success } = await packer.pack(projectJson as ProjectUIDL, factoryParams)
    expect(success).toBeTruthy()
  })

  it('should pack a next project', async () => {
    const packer = createPlaygroundPacker()
    const factoryParams: PackerFactoryParams = JSON.parse(JSON.stringify(nextVariation))

    factoryParams.assets = assetsData
    factoryParams.publisher.meta = { outputPath: nextProjectPath }

    const { success } = await packer.pack(projectJson as ProjectUIDL, factoryParams)
    expect(success).toBeTruthy()
  })

  it('should pack a vue project', async () => {
    const packer = createPlaygroundPacker()
    const factoryParams: PackerFactoryParams = JSON.parse(JSON.stringify(vueVariation))

    factoryParams.assets = assetsData
    factoryParams.publisher.meta = { outputPath: vueProjectPath }

    const { success } = await packer.pack(projectJson as ProjectUIDL, factoryParams)
    expect(success).toBeTruthy()
  })

  it('should pack a nuxt project', async () => {
    const packer = createPlaygroundPacker()
    const factoryParams: PackerFactoryParams = JSON.parse(JSON.stringify(nuxtVariation))

    factoryParams.assets = assetsData
    factoryParams.publisher.meta = { outputPath: nuxtProjectPath }

    const { success } = await packer.pack(projectJson as ProjectUIDL, factoryParams)
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
