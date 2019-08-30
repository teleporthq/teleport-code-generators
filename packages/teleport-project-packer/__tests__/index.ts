import { readFileSync } from 'fs'
import { join } from 'path'

// @ts-ignore
import projectJson from '../../../examples/test-samples/project-sample.json'
// @ts-ignore
import templateDefinition from './template-definition.json'

import {
  ProjectUIDL,
  AssetsDefinition,
  Publisher,
  GeneratedFolder,
  GeneratedFile,
} from '@teleporthq/teleport-types'

import { createProjectPacker } from '../src'
import { NO_GENERATOR_PROVIDED, NO_PUBLISHER_PROVIDED } from '../src/errors'
import { DEFAULT_TEMPLATE } from '../src/constants'

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
}

describe('teleport generic project packer', () => {
  it('creates a new instance of generic packer', () => {
    const packer = createProjectPacker()
    expect(packer.loadTemplate).toBeDefined()
    expect(packer.pack).toBeDefined()
    expect(packer.setAssets).toBeDefined()
    expect(packer.setGenerator).toBeDefined()
    expect(packer.setPublisher).toBeDefined()
    expect(packer.setTemplate).toBeDefined()
  })

  it('can set properties from generic packer', () => {
    const packer = createProjectPacker()

    const assets: AssetsDefinition = { assets: [] }
    const template: GeneratedFolder = DEFAULT_TEMPLATE
    const publisher = createDummyPublisher()

    expect(() => packer.setAssets(assets)).not.toThrow()
    expect(() => packer.setTemplate(template)).not.toThrow()
    expect(() => packer.setPublisher(publisher)).not.toThrow()
  })

  it('should fail to pack if no generator function is provided', async () => {
    const packer = createProjectPacker()

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL, {
      template: templateDefinition,
      remoteTemplateDefinition: { provider: 'github', username: 'test', repo: 'test' },
    })
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_GENERATOR_PROVIDED)
  })

  it('should fail to pack if no publisher is provider', async () => {
    const packer = createProjectPacker({
      generator: dummyGenerator,
      template: templateDefinition,
    })

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL)
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PUBLISHER_PROVIDED)
  })

  it('should pack if all required data is provided', async () => {
    const publisher = createDummyPublisher()
    const packer = createProjectPacker({
      publisher,
      generator: dummyGenerator,
      template: templateDefinition,
      assets: assetsData,
    })

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL)
    expect(success).toBeTruthy()

    const { project } = payload

    const assetsFolder = project.subFolders.find((subFolder) => {
      return subFolder.name === 'static'
    })

    expect(assetsFolder.files[0]).toBeDefined()

    expect(project.files[0].name).toBe('uidl')
    expect(project.files[0].content).toBeDefined()

    expect(project.files[1].name).toBe('template')
    expect(project.files[1].content).toBeDefined()
  })

  it('takes the templateFolder with priority over the remote template definitions', async () => {
    const publisher = createDummyPublisher()
    const packer = createProjectPacker({
      publisher,
      generator: dummyGenerator,
      assets: assetsData,
    })

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL, {
      template: templateDefinition,
    })
    expect(success).toBeTruthy()

    const { project } = payload
    const assetsFolder = project.subFolders.find((subFolder) => {
      return subFolder.name === 'static'
    })

    expect(assetsFolder.files[0]).toBeDefined()

    expect(project.files[0].name).toBe('uidl')
    expect(project.files[0].content).toBeDefined()

    expect(project.files[1].name).toBe('template')
    expect(project.files[1].content).toBeDefined()
  })
})

const createDummyPublisher = (): Publisher<ProjectUIDL, string> => {
  let project = null
  const publish = async (projectUIDL: ProjectUIDL) => {
    project = projectUIDL
    return { success: true, payload: { ...project } }
  }

  const getProject = () => {
    return project
  }
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  return { publish, getProject, setProject }
}

const dummyGeneratorFunction = async (
  uidl: Record<string, unknown>,
  template: GeneratedFolder
): Promise<GeneratedFolder> => {
  const uidlFile: GeneratedFile = {
    name: 'uidl',
    fileType: 'txt',
    content: JSON.stringify(uidl),
  }

  const templateFile: GeneratedFile = {
    name: 'template',
    fileType: 'txt',
    content: JSON.stringify(template),
  }

  template.files.push(uidlFile)
  template.files.push(templateFile)

  return template
}

const dummyGenerator = {
  addMapping: jest.fn(),
  getAssetsPath: jest.fn(() => ['static']),
  generateProject: dummyGeneratorFunction,
}
