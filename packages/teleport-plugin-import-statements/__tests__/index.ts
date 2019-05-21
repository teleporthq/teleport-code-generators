import { createPlugin } from '../src/'
import { componentDependency } from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

describe('plugin-import-statements', () => {
  const plugin = createPlugin({
    importLibsChunkName: 'test-lib',
    importLocalsChunkName: 'test-local',
    importPackagesChunkName: 'test-pack',
  })

  it('creates 3 AST chunks from the different types of dependencies', async () => {
    const structure = {
      chunks: [],
      uidl: null,
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

  it('skips any package type not found', async () => {
    const structure = {
      chunks: [],
      uidl: null,
      dependencies: {
        local: componentDependency('local', '../../components/local'),
      },
    }

    const { chunks } = await plugin(structure)
    expect(chunks.length).toBe(1)
    expect(chunks[0].name).toBe('test-local')
  })
})
