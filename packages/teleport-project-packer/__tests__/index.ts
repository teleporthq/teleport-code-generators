import createTeleportPacker from '../src'

import projectJson from '../../../examples/uidl-samples/project.json'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/src/typings/uidl'

describe('teleport generic project packer', () => {
  it('creates a new instance of generic packer', () => {
    const publisher = createTeleportPacker(projectJson as ProjectUIDL)
    expect(publisher.loadTemplate).toBeDefined()
    expect(publisher.pack).toBeDefined()
    expect(publisher.setAssets).toBeDefined()
    expect(publisher.setGeneratorFunction).toBeDefined()
    expect(publisher.setProjectUIDL).toBeDefined()
    expect(publisher.setPublisher).toBeDefined()
    expect(publisher.setTemplate).toBeDefined()
  })
})
