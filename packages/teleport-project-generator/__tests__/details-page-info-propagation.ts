import { createPageUIDLs } from '../src/utils'
import { createStrategyWithCommonGenerator } from './mocks'
import {
  conditionalNode,
  dynamicNode,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-uidl-builders'
import { ProjectUIDL } from '@teleporthq/teleport-types'

// Regression guard: `detailsPageInfo` (the table-name metadata a page's
// route-level `pageOptions` carries for entity-bound details pages) must
// survive `createPageUIDL`'s output-options construction and land on the
// final page UIDL's `outputOptions`. Without it, downstream plugins (e.g.
// teleport-plugin-next-static-props' `pageHasSameTableMutationWorkflow`,
// which decides getServerSideProps vs. getStaticProps+ISR) have no way to
// correlate "the row this page reads" with "the table a same-page mutation
// workflow writes to" — silently disabling that entire fix.
describe('createPageUIDLs propagates detailsPageInfo to outputOptions', () => {
  const buildProjectUIDL = (): ProjectUIDL => {
    const routeRef = dynamicNode('state', 'route')

    const homeNode = conditionalNode(
      routeRef,
      elementNode('container', {}, [staticNode('Home')]),
      'home'
    )
    const detailsNode = conditionalNode(
      routeRef,
      elementNode('container', {}, [staticNode('Details')]),
      'edit-press-item/[id]'
    )

    return {
      name: 'testProject',
      globals: {
        settings: { language: 'en', title: 'Test Project' },
        meta: [],
        assets: [],
      },
      root: {
        name: 'App',
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: 'home',
            values: [
              {
                value: 'home',
                pageOptions: {
                  navLink: '/',
                  fileName: 'index',
                  componentName: 'Home',
                },
              },
              {
                value: 'edit-press-item/[id]',
                pageOptions: {
                  navLink: '/edit-press-item/[id]',
                  fileName: '[id]',
                  componentName: 'EditPressItem',
                  dynamicRouteAttribute: 'id',
                  initialPropsData: {
                    exposeAs: { name: 'pressItem', valuePath: [] },
                    resource: { id: 'fetch-press-item', params: {} },
                  },
                  detailsPageInfo: {
                    dataSourceId: 'ds-1',
                    dataSourceName: 'TeleportHQ database',
                    dataSourceType: 'teleport',
                    tableName: 'press_items',
                    differentiatorColumn: 'id',
                    featureIdentifier: 'pressItem',
                  },
                },
              },
            ],
          },
        },
        node: elementNode('Router', {}, [homeNode, detailsNode]),
      },
      components: {},
    } as unknown as ProjectUIDL
  }

  it('carries detailsPageInfo through onto the details page outputOptions', () => {
    const uidl = buildProjectUIDL()
    const strategy = createStrategyWithCommonGenerator()

    const pages = createPageUIDLs(uidl, strategy)
    expect(pages).toHaveLength(2)

    const detailsPage = pages.find((p) => p.name === 'EditPressItem')
    expect(detailsPage).toBeDefined()
    expect(detailsPage!.outputOptions?.dynamicRouteAttribute).toBe('id')
    expect(detailsPage!.outputOptions?.detailsPageInfo?.tableName).toBe('press_items')
    expect(detailsPage!.outputOptions?.detailsPageInfo?.differentiatorColumn).toBe('id')
    expect(detailsPage!.outputOptions?.initialPropsData).toBeDefined()
  })

  it('leaves detailsPageInfo undefined for a regular page that is not a details page', () => {
    const uidl = buildProjectUIDL()
    const strategy = createStrategyWithCommonGenerator()

    const pages = createPageUIDLs(uidl, strategy)
    const homePage = pages.find((p) => p.name === 'Home')

    expect(homePage).toBeDefined()
    expect(homePage!.outputOptions?.detailsPageInfo).toBeUndefined()
  })
})
