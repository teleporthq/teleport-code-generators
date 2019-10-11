import { createImportPlugin } from '../src/'
import { componentDependency } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'

describe('plugin-import-statements', () => {
  const plugin = createImportPlugin({
    importLibsChunkName: 'test-lib',
    importLocalsChunkName: 'test-local',
    importPackagesChunkName: 'test-pack',
  })

  it('creates 3 AST chunks from the different types of dependencies', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      uidl: null,
      options: {},
      dependencies: {
        package: componentDependency('package', 'npm-package', '1.0.0'),
        library: componentDependency('library', 'project-lib', '2.0.0'),
        local: componentDependency('local', '../../components/local'),
      },
    }

    const { chunks } = await plugin(structure)
    expect(chunks.length).toBe(3)
    expect(chunks[0].name).toBe('test-lib')
    expect(chunks[1].name).toBe('test-pack')
    expect(chunks[2].name).toBe('test-local')
  })

  // We need this functionality for the linkAfter field to work
  it('pushes chunks for imports even when no statement is needed', async () => {
    const structure: ComponentStructure = {
      chunks: [],
      options: {},
      uidl: null,
      dependencies: {
        local: componentDependency('local', '../../components/local'),
      },
    }

    const { chunks } = await plugin(structure)
    expect(chunks.length).toBe(3)
  })
})
