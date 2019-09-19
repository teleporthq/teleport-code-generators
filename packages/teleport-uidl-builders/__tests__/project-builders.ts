import { component } from '../src/component-builders'
import { ProjectUIDL, ComponentUIDL, UIDLStaticValue } from '@teleporthq/teleport-types'
import { project, simpleProjectGlobals } from '../src/project-builders'

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
