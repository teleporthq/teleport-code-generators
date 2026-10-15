import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/tests.json'
import {
  createHTMLProjectGenerator,
  pluginHomeReplace,
  pluginStateRuntime,
  ProjectPluginCloneGlobals,
} from '../../src'
import HTMLTemplate from '../../src/project-template'

/**
 * A home page the way the editor exports its interactive library pieces: a
 * Navigation component whose burger toggles its own menu, used twice (the
 * first instance holds slot content that reads the PAGE's state), a tab set
 * wired by the editor's click workflows with a state class on every trigger,
 * and a monthly / yearly price switch.
 */

const s = (content: unknown) => ({ type: 'static', content })
const state = (id: string) => ({ type: 'dynamic', content: { referenceType: 'state', id } })
const el = (elementType: string, content: Record<string, unknown> = {}) => ({
  type: 'element',
  content: { elementType, ...content },
})
const text = (id: string, label: string) =>
  el('text', { semanticType: 'span', attrs: { id: s(id) }, children: [s(label)] })
const when = (id: string, operation: string, operand: unknown, node: unknown) => ({
  type: 'conditional',
  content: { reference: state(id), node, condition: { conditions: [{ operation, operand }] } },
})
const styles = (map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).map(([key, value]) => [key, s(value)]))

const NAVIGATION = {
  name: 'Navigation',
  stateDefinitions: { menuOpen: { type: 'boolean', defaultValue: false } },
  node: el('container', {
    name: 'bar',
    style: styles({ display: 'flex', gap: '16px', padding: '16px', alignItems: 'center' }),
    children: [
      el('container', {
        name: 'burger',
        attrs: { id: s('burger'), 'aria-label': s('Menu') },
        style: styles({ width: '48px', height: '48px', background: '#ddd' }),
        events: { click: [{ type: 'stateChange', modifies: 'menuOpen', newState: '$toggle' }] },
        children: [
          when('menuOpen', '===', false, text('burger-open', 'Open')),
          when('menuOpen', '===', true, text('burger-close', 'Close')),
        ],
      }),
      when(
        'menuOpen',
        '===',
        true,
        el('container', {
          name: 'menu',
          attrs: { id: s('menu') },
          style: styles({ display: 'flex', gap: '8px' }),
          children: [text('menu-home', 'Home'), text('menu-about', 'About')],
        })
      ),
      { type: 'slot', content: {} },
    ],
  }),
}

const TAB_ACTIVE = 'tab-active'

const tabTrigger = (index: number) =>
  el('container', {
    name: `tab-trigger-${index}`,
    attrs: { id: s(`tab-${index}`), 'data-tab-index': s(String(index)) },
    style: styles({ padding: '12px 24px', cursor: 'pointer' }),
    referencedStyles: {
      [`active-${index}`]: {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: TAB_ACTIVE,
          condition: {
            reference: state('activeTabIndex'),
            expression: { conditions: [{ operation: '=', operand: index }] },
          },
        },
      },
    },
    children: [s(`Tab ${index + 1}`)],
  })

const tabPanel = (index: number) =>
  when(
    'activeTabIndex',
    '=',
    index,
    el('container', {
      name: `tab-panel-${index}`,
      attrs: { id: s(`panel-${index}`) },
      style: styles({ display: 'flex', padding: '24px', minHeight: '120px' }),
      children: [s(`Panel ${index + 1}`)],
    })
  )

const tabWorkflow = (index: number) => ({
  id: `switch-tab-${index}`,
  name: `Switch to Tabs Tab ${index + 1}`,
  trigger: {
    nodeId: `trigger-${index}`,
    type: 'event-element-clicked',
    scope: 'element',
    config: { nodeId: `doc-${index}`, elementHtmlId: `tab-${index}`, preventDefault: false },
  },
  nodes: [
    {
      id: `set-${index}`,
      type: 'state-update-local-state',
      label: 'Set Local State',
      config: { property: 'activeTabIndex', value: index },
      executionEnv: 'client',
      stepNumber: 1,
    },
  ],
  edges: [{ id: `edge-${index}`, source: `trigger-${index}`, target: `set-${index}` }],
  errorHandler: {
    nodeId: `error-${index}`,
    type: 'event-workflow-error',
    config: { isErrorHandler: true },
    executionEnv: 'client',
  },
  usedInNodes: { [`doc-${index}`]: true },
})

const HOME_CHILDREN = [
  el('component', {
    semanticType: 'Navigation',
    dependency: { type: 'local' },
    children: [when('yearly', '===', true, text('slot-badge', 'Yearly billing'))],
  }),
  el('component', { semanticType: 'Navigation', dependency: { type: 'local' } }),
  el('container', {
    name: 'tabs',
    attrs: { id: s('tabs') },
    style: styles({ display: 'flex' }),
    children: [0, 1, 2].map(tabTrigger),
  }),
  ...[0, 1, 2].map(tabPanel),
  el('button', {
    name: 'billing-switch',
    attrs: { id: s('billing-switch') },
    events: { click: [{ type: 'stateChange', modifies: 'yearly', newState: '$toggle' }] },
    children: [s('Bill yearly')],
  }),
  when('yearly', '===', false, text('price-monthly', '$19 / month')),
  when('yearly', '===', true, text('price-yearly', '$190 / year')),
]

const sample = () => JSON.parse(JSON.stringify(uidlSample))

export const plainSite = (): ProjectUIDL => sample()

export const stateSite = (): ProjectUIDL => {
  const uidl = sample()
  uidl.root.styleSetDefinitions = {
    ...(uidl.root.styleSetDefinitions || {}),
    [TAB_ACTIVE]: {
      type: 'reusable-project-style-map',
      content: styles({ color: '#c00', borderBottom: '2px solid #c00' }),
    },
  }
  uidl.components.Navigation = NAVIGATION
  uidl.workflows = {
    workflows: Object.fromEntries(
      [0, 1, 2].map((index) => [`switch-tab-${index}`, tabWorkflow(index)])
    ),
  }
  const homeRoute = uidl.root.stateDefinitions.route.values.find(
    (route: { value: string }) => route.value === uidl.root.stateDefinitions.route.defaultValue
  )
  homeRoute.pageOptions = {
    ...(homeRoute.pageOptions || {}),
    stateDefinitions: {
      activeTabIndex: { type: 'number', defaultValue: 0 },
      yearly: { type: 'boolean', defaultValue: false },
    },
  }
  uidl.root.node.content.children[0].content.node.content.children = HOME_CHILDREN
  return uidl
}

export const generateSite = async (
  uidl: ProjectUIDL,
  { strictHtmlWhitespaceSensitivity = false } = {}
): Promise<GeneratedFolder> => {
  if (strictHtmlWhitespaceSensitivity) {
    // custom head code that ends in a script makes Prettier close the head as `</head\n  >`
    uidl.globals.customCode = { head: '<script>\n  window.tqHeadReady = true\n</script>' }
  }
  const generator = createHTMLProjectGenerator()
  generator.addPlugin(pluginHomeReplace)
  generator.addPlugin(new ProjectPluginCloneGlobals({ strictHtmlWhitespaceSensitivity }))
  generator.addPlugin(pluginStateRuntime)
  return generator.generateProject(
    uidl as unknown as Record<string, unknown>,
    HTMLTemplate,
    {},
    strictHtmlWhitespaceSensitivity
  )
}

export const fileOf = (folder: GeneratedFolder, name: string, fileType: string) =>
  folder.files.find((file) => file.name === name && file.fileType === fileType)?.content ?? ''
