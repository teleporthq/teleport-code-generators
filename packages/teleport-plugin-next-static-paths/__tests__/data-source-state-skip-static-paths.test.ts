import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPathsPlugin } from '../src/index'

// A page that seeds a state from a data source renders per request (its
// getStaticProps is turned into getServerSideProps at the end of the page
// pipeline), and Next.js refuses getStaticPaths beside getServerSideProps. The
// plugin must therefore stay out of such a dynamic page — and only of such a
// page: a state resolved in the browser keeps the page statically generated.

const DS_ID = 'ds-1'

const makeStructure = (query: string): ComponentStructure =>
  ({
    uidl: {
      name: 'Profile',
      node: { type: 'element', content: { elementType: 'container' } },
      stateDefinitions: {
        rows: {
          type: 'array',
          defaultValue: [],
          dataSourceBinding: { dataSourceId: DS_ID, refPath: ['profiles'] },
          query,
        },
      },
      outputOptions: { folderPath: ['profile'], fileName: '[id]' },
    },
    chunks: [{ name: 'jsx-component' }],
    dependencies: {},
    options: {
      dataSources: { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } },
      resources: { items: {}, path: ['utils', 'data-sources'] },
    },
  } as unknown as ComponentStructure)

describe('teleport-plugin-next-static-paths: data-source state skip', () => {
  const plugin = createStaticPathsPlugin()

  it('emits no getStaticPaths for a dynamic page that seeds a state from a data source', async () => {
    const result = await plugin(makeStructure('SELECT * FROM profiles LIMIT 5'))

    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeUndefined()
    expect(result.chunks.find((chunk) => chunk.name === 'getStaticProps')).toBeUndefined()
  })

  it('still emits the fallback getStaticPaths when the state is only resolved in the browser', async () => {
    const result = await plugin(
      makeStructure("SELECT * FROM profiles WHERE user_id = '{{Current User.id}}'")
    )

    expect(result.chunks.find((chunk) => chunk.name === 'getStaticPaths')).toBeDefined()
  })
})
