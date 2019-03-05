// @ts-ignore
import vueProjectUIDL from '../../examples/uidl-samples/project-routing.json'
// @ts-ignore
import reactProjectUIDL from '../../examples/uidl-samples/project-state-components.json'

import {
  createReactBasicProject,
  createReactNextProject,
  createVueBasicProject,
  createVueNuxtProject,
} from '../../src'

describe('React Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createReactBasicProject(reactProjectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
  })
})

describe('React Next Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createReactNextProject(reactProjectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
    expect(result.outputFolder.files[0].name).toBe('package')
  })
})

describe('Vue Basic Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createVueBasicProject(vueProjectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})

describe('Vue Nuxt Project Generator', () => {
  it('runs without crashing', async () => {
    const result = await createVueNuxtProject(vueProjectUIDL)

    expect(result.assetsPath).toBeDefined()
    expect(result.outputFolder.name).toBe('dist')
  })
})
