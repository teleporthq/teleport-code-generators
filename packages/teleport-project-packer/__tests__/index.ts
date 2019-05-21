import createTeleportPacker from '../src'

import projectJson from '../../../examples/uidl-samples/project.json'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/src/typings/uidl'
import {
  AssetsDefinition,
  TemplateDefinition,
  Publisher,
} from '@teleporthq/teleport-generator-shared/src/typings/generators'
import { GeneratedFolder } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const genericPublisher = (): Publisher<string, string> => {
  let project = null
  const publish = async () => {
    return { success: true, payload: project }
  }

  const getProject = () => {
    return project
  }
  const setProject = (projectToSet: GeneratedFolder) => {
    project = projectToSet
  }

  return { publish, getProject, setProject }
}

describe('teleport generic project packer', () => {
  it('creates a new instance of generic packer', () => {
    const packer = createTeleportPacker(projectJson as ProjectUIDL)
    expect(packer.loadTemplate).toBeDefined()
    expect(packer.pack).toBeDefined()
    expect(packer.setAssets).toBeDefined()
    expect(packer.setGeneratorFunction).toBeDefined()
    expect(packer.setProjectUIDL).toBeDefined()
    expect(packer.setPublisher).toBeDefined()
    expect(packer.setTemplate).toBeDefined()
  })

  it('can set properties from generic packer', () => {
    const packer = createTeleportPacker(projectJson as ProjectUIDL)

    const assets: AssetsDefinition = { assets: [] }
    const template: TemplateDefinition = {}
    const publisher = genericPublisher()

    expect(() => packer.setAssets(assets)).not.toThrow()
    expect(() => packer.setProjectUIDL(projectJson as ProjectUIDL)).not.toThrow()
    expect(() => packer.setTemplate(template)).not.toThrow()
    expect(() => packer.setPublisher(publisher)).not.toThrow()
  })
})
