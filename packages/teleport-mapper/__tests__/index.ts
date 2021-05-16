import { MapSnapshotToUIDL } from '../src/index'
import snapshot from './snapshots/studio.json'

describe('Mapper to ProjectUIDL', () => {
  it('Map Snapshot to ProjectUIDL', () => {
    const mapper = new MapSnapshotToUIDL(snapshot)
    const uidl = mapper.toProjectUIDL()

    expect(uidl).toBeDefined()
    expect(Object.keys(uidl?.components).length).toBe(1)
    expect(uidl.root.node.content.children.length).toBe(2)
    expect(uidl.root.designLanguage.tokens).toBeDefined()
    expect(uidl.root.styleSetDefinitions).toBeDefined()
  })
})
