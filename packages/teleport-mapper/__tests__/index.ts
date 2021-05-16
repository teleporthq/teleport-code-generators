import { MapSnapshotToUIDL } from '../src/index'
import snapshot from './snapshots/studio.json'

describe('Mapper to ProjectUIDL', () => {
  it('Map Snapshot to ProjectUIDL', () => {
    const mapper = new MapSnapshotToUIDL(snapshot)
    const uidl = mapper.toProjectUIDL()

    expect(uidl).toBeDefined()
    expect(Object.keys(uidl?.components).length).toBe(1)
  })
})
