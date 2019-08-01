import { UIDLStaticValue } from '@teleporthq/teleport-types/lib'
import { ComponentUIDL } from '@teleporthq/teleport-types/src'
import { component } from '../../src/builders/uidl-builders'
import { ProjectUIDL } from '@teleporthq/teleport-types/dist/esm'
import { project, simpleProjectGlobals } from '../../src/builders/project-builders'

describe('Project Builders', () => {
  const dummyNode: UIDLStaticValue = { type: 'static', content: 'test' }
  const dummyRootComponent: ComponentUIDL = component('component-root-test', dummyNode)
  const dummyComponent: ComponentUIDL = component('component-test', dummyNode)

  it('returns a new simpleProjectGlobals object', () => {
    const testProjectGlobals = simpleProjectGlobals('test-globals')

    expect(testProjectGlobals.settings.title).toBe('test-globals')
    expect(testProjectGlobals.settings.language).toBe('en')
  })

  it('returns a new ProjectUIDL object', () => {
    const testProjectUIDL: ProjectUIDL = project(
      'project-uidl-test',
      dummyRootComponent,
      [dummyComponent],
      simpleProjectGlobals('test-globals')
    )

    expect(testProjectUIDL.name).toBe('project-uidl-test')
    expect(testProjectUIDL.root.name).toBe('component-root-test')
  })
})
