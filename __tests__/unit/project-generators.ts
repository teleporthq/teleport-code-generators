// @ts-ignore
import projectUIDL from '../../examples/uidl-samples/project-routing.json'

import {
  createReactBasicProject,
  createReactNextProject,
  createVueBasicProject,
  createVueNuxtProject,
} from '../../src'

describe('React Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL))
    const result = await createReactBasicProject(uidl)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
  })
})

describe('React Next Project Generator', () => {
  it('runs without crashing', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL))
    const result = await createReactNextProject(uidl)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
  })
})

describe('Vue Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL))
    const result = await createVueBasicProject(uidl)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})

describe('Vue Nuxt Project Generator', () => {
  it('runs without crashing', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL))
    const result = await createVueNuxtProject(uidl)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})
