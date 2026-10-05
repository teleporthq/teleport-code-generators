// Packs the state fixture through the REAL download entry point (packProject, built dist).
// node pack-site.cjs <out-dir> — writes the static HTML site to <out-dir>/site.
// Then: node verify-site.cjs <out-dir>/site (needs the sibling teleport-gui checkout for Playwright).
const path = require('path')
const fs = require('fs')
const CG = path.resolve(__dirname, '../../../..')
const { packProject } = require(CG + '/packages/teleport-code-generator/dist/cjs/index.js')
const { ProjectType, PublisherType } = require(CG + '/packages/teleport-types/dist/cjs/index.js')
const uidl = JSON.parse(fs.readFileSync(CG + '/examples/uidl-samples/tests.json', 'utf8'))

const s = (content) => ({ type: 'static', content })
const styles = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, s(v)]))
const state = (id) => ({ type: 'dynamic', content: { referenceType: 'state', id } })
const el = (elementType, content = {}) => ({
  type: 'element',
  content: { elementType, ...content },
})
const text = (id, label, style = {}) =>
  el('text', {
    semanticType: 'span',
    attrs: { id: s(id) },
    style: styles(style),
    children: [s(label)],
  })
const when = (id, operation, operand, node) => ({
  type: 'conditional',
  content: { reference: state(id), node, condition: { conditions: [{ operation, operand }] } },
})

// The editor's library switch: a boolean state, a $toggle click, `=== true` / `=== false` branches.
uidl.components.Navigation = {
  name: 'Navigation',
  stateDefinitions: { menuOpen: { type: 'boolean', defaultValue: false } },
  node: el('container', {
    name: 'bar',
    style: styles({
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '16px',
      background: '#eef',
    }),
    children: [
      el('container', {
        name: 'burger',
        attrs: { id: s('burger'), 'aria-label': s('Menu') },
        style: styles({ width: '64px', height: '40px', background: '#ccd', cursor: 'pointer' }),
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
          style: styles({ display: 'flex', gap: '12px', padding: '8px', background: '#fff' }),
          children: [text('menu-home', 'Home'), text('menu-about', 'About')],
        })
      ),
      { type: 'slot', content: {} },
    ],
  }),
}

// The editor's tabs: a number state, a click workflow per trigger, a state class on every trigger.
uidl.root.styleSetDefinitions = {
  ...(uidl.root.styleSetDefinitions || {}),
  'tab-active': {
    type: 'reusable-project-style-map',
    content: styles({ color: 'rgb(204, 0, 0)', borderBottom: '2px solid rgb(204, 0, 0)' }),
  },
}
const tabTrigger = (index) =>
  el('container', {
    name: `tab-trigger-${index}`,
    attrs: { id: s(`tab-${index}`), 'data-tab-index': s(String(index)) },
    style: styles({
      padding: '12px 24px',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
    }),
    referencedStyles: {
      [`active-${index}`]: {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: 'tab-active',
          condition: {
            reference: state('activeTabIndex'),
            expression: { conditions: [{ operation: '=', operand: index }] },
          },
        },
      },
    },
    children: [s(`Tab ${index + 1}`)],
  })
const tabPanel = (index) =>
  when(
    'activeTabIndex',
    '=',
    index,
    el('container', {
      name: `tab-panel-${index}`,
      attrs: { id: s(`panel-${index}`) },
      style: styles({
        display: 'flex',
        padding: '24px',
        minHeight: `${120 + index * 40}px`,
        background: '#f6f6f6',
      }),
      children: [s(`Panel ${index + 1}`)],
    })
  )
uidl.workflows = {
  workflows: Object.fromEntries(
    [0, 1, 2].map((index) => [
      `switch-tab-${index}`,
      {
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
        usedInNodes: { [`doc-${index}`]: true },
      },
    ])
  ),
}

const home = uidl.root.node.content.children[0]
home.content.node.content.children = [
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
    style: styles({ margin: '16px', padding: '8px 16px' }),
    events: { click: [{ type: 'stateChange', modifies: 'yearly', newState: '$toggle' }] },
    children: [s('Bill yearly')],
  }),
  when('yearly', '===', false, text('price-monthly', '$19 / month', { fontSize: '32px' })),
  when('yearly', '===', true, text('price-yearly', '$190 / year', { fontSize: '32px' })),
]
home.content.node.content.style = {
  ...(home.content.node.content.style || {}),
  alignItems: s('stretch'),
}
const homeRoute = uidl.root.stateDefinitions.route.values.find(
  (route) => route.value === uidl.root.stateDefinitions.route.defaultValue
)
homeRoute.pageOptions = {
  ...(homeRoute.pageOptions || {}),
  stateDefinitions: {
    activeTabIndex: { type: 'number', defaultValue: 0 },
    yearly: { type: 'boolean', defaultValue: false },
  },
}
;(async () => {
  const outputPath = process.argv[2]
  const result = await packProject(uidl, {
    projectType: ProjectType.HTML,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath, projectSlug: 'site' },
  })
  console.log('packProject success:', result.success)
  console.log(fs.readdirSync(path.join(outputPath, 'site')).join(' '))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
