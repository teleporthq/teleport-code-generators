import { readFileSync } from 'fs'
import { join } from 'path'

// @ts-ignore
import projectJson from '../../../examples/uidl-samples/project.json'
// @ts-ignore
import templateDefinition from './template-definition.json'

import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/src/typings/uidl'
import {
  AssetsDefinition,
  TemplateDefinition,
  Publisher,
  ProjectGeneratorOutput,
} from '@teleporthq/teleport-generator-shared/src/typings/generators'
import {
  GeneratedFolder,
  GeneratedFile,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import createTeleportPacker from '../src'
import {
  NO_TEMPLATE_PROVIDED,
  NO_REMOTE_TEMPLATE_PROVIDED,
  NO_GENERATOR_FUNCTION_PROVIDED,
  NO_PUBLISHER_PROVIDED,
} from '../src/errors'

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
    const packer = createTeleportPacker()
    expect(packer.loadTemplate).toBeDefined()
    expect(packer.pack).toBeDefined()
    expect(packer.setAssets).toBeDefined()
    expect(packer.setGeneratorFunction).toBeDefined()
    expect(packer.setPublisher).toBeDefined()
    expect(packer.setTemplate).toBeDefined()
  })

  it('can set properties from generic packer', () => {
    const packer = createTeleportPacker()

    const assets: AssetsDefinition = { assets: [] }
    const template: TemplateDefinition = {}
    const publisher = createDummyPublisher()

    expect(() => packer.setAssets(assets)).not.toThrow()
    expect(() => packer.setTemplate(template)).not.toThrow()
    expect(() => packer.setPublisher(publisher)).not.toThrow()
  })

  it('should fail to load template if no template definition is provided', async () => {
    const packer = createTeleportPacker()

    const { success, payload } = await packer.loadTemplate()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_TEMPLATE_PROVIDED)
  })

  it('should load template if template folder is described in the definition', async () => {
    const packer = createTeleportPacker({
      template: templateDefinition,
    })

    const { success, payload } = await packer.loadTemplate()
    expect(success).toBeTruthy()
    expect(JSON.stringify(payload)).toBe(JSON.stringify(templateDefinition.templateFolder))
  })

  it('should fail to load template if no folder or remote meta is described in the definition', async () => {
    const packer = createTeleportPacker({
      template: {},
    })

    const { success, payload } = await packer.loadTemplate()
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_REMOTE_TEMPLATE_PROVIDED)
  })

  it('should fail to pack if no template is provided', async () => {
    const packer = createTeleportPacker()

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL)
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_TEMPLATE_PROVIDED)
  })

  it('should fail to pack if no generator function is provided', async () => {
    const packer = createTeleportPacker()

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL, {
      template: templateDefinition,
    })
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_GENERATOR_FUNCTION_PROVIDED)
  })

  it('should fail to pack if no publisher is provider', async () => {
    const packer = createTeleportPacker({
      generatorFunction: dummyGeneratorFunction,
      template: templateDefinition,
    })

    const { success, payload } = await packer.pack(projectJson as ProjectUIDL)
    expect(success).toBeFalsy()
    expect(payload).toBe(NO_PUBLISHER_PROVIDED)
  })

  it('should pack if all required data is provided', async () => {
    const publisher = createDummyPublisher()
    const packer = createTeleportPacker({
      publisher,
      generatorFunction: dummyGeneratorFunction,
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
  uidl: ProjectUIDL,
  template: TemplateDefinition
): Promise<ProjectGeneratorOutput> => {
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

  template.templateFolder.files.push(uidlFile)
  template.templateFolder.files.push(templateFile)

  return { assetsPath: 'static', outputFolder: template.templateFolder }
}
