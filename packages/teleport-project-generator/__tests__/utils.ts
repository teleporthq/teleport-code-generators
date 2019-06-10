import { generateLocalDependenciesPrefix, handlePackageJSON } from '../src/utils'
import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { component, elementNode } from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

describe('generateLocalDependenciesPrefix', () => {
  it('works when there is a common parent', () => {
    const from = ['src', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../to/')
  })

  it('works when there is no common parent', () => {
    const from = ['dist', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../../src/to/')
  })

  it('works when to is a parent of from', () => {
    const from = ['src', 'from']
    const to = ['src']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../')
  })

  it('works when to is a child of from', () => {
    const from = ['src']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./to/')
  })

  it('works when they are identical', () => {
    const from = ['src', 'from']
    const to = ['src', 'from']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./')
  })
})

describe('handlePackageJSON', () => {
  const uidl: ProjectUIDL = {
    name: 'test-project',
    globals: { settings: { title: 'Random', language: 'en' }, meta: [], assets: [] },
    root: component('random', elementNode('container')),
  }

  const dependencies = {
    'test-package': '^0.5.0',
    'another-test': '1.0.0',
  }

  it('creates one from scratch if template does not provide it', () => {
    const template: GeneratedFolder = {
      name: 'template',
      files: [],
      subFolders: [],
    }

    const result = handlePackageJSON(template, uidl, dependencies)
  })
})
