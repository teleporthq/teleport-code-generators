import generator from '@babel/generator'
import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

// `initialPropsData.omitFields`: a column the page must not reveal (a private
// link only paying attendees get) is taken off the fetched row before the
// props are returned — everything in props ships in the page's HTML.

const RESOURCE_ID = 'fetch-calendar-event'

const makeStructure = (omitFields?: string[]): ComponentStructure =>
  ({
    uidl: {
      name: 'EventDetails',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: 'page-event-details',
        folderPath: ['events'],
        fileName: '[slug]',
        initialPropsData: {
          exposeAs: { name: 'calendarEvent', valuePath: ['data', '0'] },
          resource: { id: RESOURCE_ID, params: {} },
          ...(omitFields ? { omitFields } : {}),
        },
      },
    },
    chunks: [],
    dependencies: {},
    options: {
      skipI18n: true,
      resources: {
        items: { [RESOURCE_ID]: { id: RESOURCE_ID, name: 'calendar-event' } },
        path: ['utils', 'data-sources'],
      },
    },
  } as unknown as ComponentStructure)

const generate = async (structure: ComponentStructure): Promise<string> => {
  const result = await createStaticPropsPlugin()(structure)
  const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
  expect(chunk).toBeDefined()
  return generator(chunk?.content as types.Node).code
}

/** The emitted getStaticProps, run against a resource answering `row`. */
const run = async (code: string, row: Record<string, unknown>) => {
  const body = code.replace(/^export\s+/, '')
  const calendarEventResource = async () => ({ data: [row] })
  // tslint:disable-next-line:function-constructor
  const factory = new Function('calendarEventResource', `${body}\nreturn getStaticProps;`)
  return factory(calendarEventResource)({ params: { slug: 'wine' } })
}

describe('teleport-plugin-next-static-props: omitted fields', () => {
  it('takes the omitted fields off the row before the props are returned', async () => {
    const code = await generate(makeStructure(['online_url', 'onlineUrl']))
    expect(code).toContain('delete rowWithOmittedFields["online_url"]')
    expect(code).toContain('delete rowWithOmittedFields["onlineUrl"]')
    // Still one props return for the plugins that look for it.
    expect(code.match(/return \{\s*props/g) || []).toHaveLength(1)
  })

  it('emits nothing for a page that omits nothing', async () => {
    const code = await generate(makeStructure())
    expect(code).not.toContain('rowWithOmittedFields')
    const empty = await generate(makeStructure([]))
    expect(empty).not.toContain('rowWithOmittedFields')
  })

  it('leaves every other field of the row in the props', async () => {
    const code = await generate(makeStructure(['online_url']))
    const result = await run(code, { slug: 'wine', title: 'Wine', online_url: 'https://meet/x' })
    expect(result.props.calendarEvent).toEqual({ slug: 'wine', title: 'Wine' })
  })
})
