import {
  ComponentStructure,
  FileType,
  GeneratorOptions,
  HastNode,
  UIDLConditionalExpression,
  UIDLElement,
  UIDLStateDefinition,
  UIDLWorkflow,
} from '@teleporthq/teleport-types'
import { StateBindings } from '@teleporthq/teleport-shared'
import { HASTBuilders } from '@teleporthq/teleport-plugin-common'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createHTMLBasePlugin } from '../src'
import {
  BindingContext,
  bindElement,
  compileCondition,
  createStateScope,
} from '../src/state-bindings'

const STATES: Record<string, UIDLStateDefinition> = {
  menuOpen: { type: 'boolean', defaultValue: false },
  activeTabIndex: { type: 'number', defaultValue: 0 },
  plan: { type: 'string', defaultValue: 'monthly' },
  count: { type: 'number', defaultValue: 2 },
  cart: { type: 'object', defaultValue: { count: 0 } },
}

const context = (): BindingContext => ({
  scope: createStateScope('Page', STATES),
  props: {
    limit: { type: 'number', defaultValue: 3 },
    label: { type: 'string', defaultValue: "it's" },
    product: { type: 'object', defaultValue: { stock: 5 } },
  },
})

const stateRef = (id: string, refPath?: string[]) => ({
  type: 'dynamic' as const,
  content: { referenceType: 'state' as const, id, ...(refPath ? { refPath } : {}) },
})
const propRef = (id: string) => ({
  type: 'dynamic' as const,
  content: { referenceType: 'prop' as const, id },
})

const printed = (
  reference: ReturnType<typeof stateRef> | ReturnType<typeof propRef> | undefined,
  condition: UIDLConditionalExpression
) => {
  const expression = compileCondition({ reference, condition }, context())
  return expression ? StateBindings.printExpression(expression) : null
}

describe('State bindings: conditions', () => {
  it('writes the comparisons the JSX generators write', () => {
    expect(
      printed(stateRef('menuOpen'), { conditions: [{ operation: '===', operand: true }] })
    ).toBe('menuOpen')
    expect(
      printed(stateRef('menuOpen'), { conditions: [{ operation: '===', operand: false }] })
    ).toBe('!menuOpen')
    expect(printed(stateRef('menuOpen'), { conditions: [{ operation: '!' }] })).toBe('!menuOpen')
    // the editor's own spelling of equality
    expect(
      printed(stateRef('activeTabIndex'), { conditions: [{ operation: '=', operand: 2 }] })
    ).toBe('activeTabIndex === 2')
    expect(printed(stateRef('count'), { conditions: [{ operation: '!=', operand: 1 }] })).toBe(
      'count !== 1'
    )
    expect(printed(stateRef('count'), { conditions: [{ operation: '>=', operand: 1 }] })).toBe(
      'count >= 1'
    )
  })

  it('joins a flat chain by its matching criteria', () => {
    expect(
      printed(stateRef('count'), {
        matchingCriteria: 'all',
        conditions: [
          { operation: '>', operand: 0 },
          { operation: '<', operand: 10 },
        ],
      })
    ).toBe('count > 0 && count < 10')
    expect(
      printed(stateRef('plan'), {
        conditions: [
          { operation: '===', operand: 'monthly' },
          { operation: '===', operand: 'weekly' },
        ],
      })
    ).toBe(`plan === 'monthly' || plan === 'weekly'`)
  })

  it('keeps a group together and reads per-entry references', () => {
    expect(
      printed(stateRef('menuOpen'), {
        matchingCriteria: 'all',
        conditions: [
          { operation: '===', operand: true },
          {
            conditions: [
              { operation: '===', operand: 0, reference: stateRef('activeTabIndex') },
              { operation: '===', operand: 'yearly', reference: stateRef('plan') },
            ],
          },
        ],
      })
    ).toBe(`menuOpen && (activeTabIndex === 0 || plan === 'yearly')`)
  })

  it('writes a prop as the literal it is in a static page', () => {
    expect(
      printed(stateRef('count'), { conditions: [{ operation: '<', operand: propRef('limit') }] })
    ).toBe('count < 3')
    expect(
      printed(stateRef('count'), {
        conditions: [
          { operation: '<', operand: { type: 'expr', content: 'props.product?.stock' } },
        ],
      })
    ).toBe('count < 5')
    expect(
      printed(stateRef('plan'), { conditions: [{ operation: '===', operand: propRef('label') }] })
    ).toBe(`plan === 'it\\'s'`)
  })

  it('reads the iteration number of a repeated tab panel', () => {
    const expression = compileCondition(
      {
        reference: stateRef('activeTabIndex'),
        condition: {
          conditions: [{ operation: '=', operand: { type: 'expr', content: 'index' } }],
        },
      },
      { ...context(), repeater: { expressions: {}, currentIndex: 2 } }
    )
    expect(StateBindings.printExpression(expression)).toBe('activeTabIndex === 2')
  })

  it('leaves to the old first-load path what reads no state or what the runtime cannot run', () => {
    // a prop alone never changes
    expect(printed(propRef('limit'), { conditions: [{ operation: '>', operand: 1 }] })).toBeNull()
    // collections, object states, unknown states, other scopes' references
    expect(printed(stateRef('cart'), { conditions: [{ operation: 'isEmpty' }] })).toBeNull()
    expect(
      printed(stateRef('cart', ['count']), { conditions: [{ operation: '>', operand: 0 }] })
    ).toBeNull()
    expect(
      printed(stateRef('missing'), { conditions: [{ operation: '===', operand: 1 }] })
    ).toBeNull()
    expect(
      printed(
        {
          type: 'dynamic',
          content: { referenceType: 'global' as 'state', id: 'currentUser' },
        },
        { conditions: [{ operation: '===', operand: 1 }] }
      )
    ).toBeNull()
    expect(
      printed(stateRef('plan'), { conditions: [{ operation: 'startsWith', operand: 'm' }] })
    ).toBeNull()
    // one unreadable entry makes the whole condition unreadable
    expect(
      printed(stateRef('count'), {
        conditions: [
          { operation: '>', operand: 0 },
          { operation: 'contains', operand: 1 },
        ],
      })
    ).toBeNull()
  })
})

describe('State bindings: the expression language', () => {
  const { binary, literal, not, state, printExpression, evaluateExpression } = StateBindings

  it('prints parentheses only where precedence needs them', () => {
    expect(printExpression(binary('&&', binary('||', state('a'), state('b')), state('c')))).toBe(
      '(a || b) && c'
    )
    expect(printExpression(binary('||', binary('&&', state('a'), state('b')), state('c')))).toBe(
      'a && b || c'
    )
    expect(printExpression(not(binary('===', state('a'), literal(1))))).toBe('!(a === 1)')
    expect(printExpression(binary('-', state('a'), binary('-', state('b'), literal(1))))).toBe(
      'a - (b - 1)'
    )
    expect(printExpression(binary('===', state('a'), binary('+', state('b'), literal(-1))))).toBe(
      'a === b + -1'
    )
  })

  it('quotes strings so a quote or a backslash in them reads back', () => {
    expect(StateBindings.printValue(`She said "it's" \\o/`)).toBe(`'She said "it\\'s" \\\\o/'`)
    expect(StateBindings.escapeAttributeValue(`a && b === '"x" &amp'`)).toBe(
      `a && b === '&quot;x&quot; &amp;amp'`
    )
  })

  it('evaluates the way JavaScript does', () => {
    const values = { open: false, tab: 1, plan: 'yearly' }
    expect(evaluateExpression(not(state('open')), values)).toBe(true)
    expect(evaluateExpression(binary('===', state('tab'), literal(1)), values)).toBe(true)
    expect(evaluateExpression(binary('===', state('tab'), literal('1')), values)).toBe(false)
    expect(evaluateExpression(binary('+', state('tab'), literal(1)), values)).toBe(2)
    expect(
      evaluateExpression(
        binary('&&', state('open'), binary('===', state('plan'), literal('yearly'))),
        values
      )
    ).toBe(false)
    expect(evaluateExpression(state('missing'), values)).toBeUndefined()
  })
})

const hastOf = (tagName: string, properties: Record<string, string> = {}): HastNode => {
  const node = HASTBuilders.createHTMLNode(tagName)
  Object.assign(node.properties, properties)
  return node
}

const element = (content: Partial<UIDLElement>): UIDLElement => ({
  elementType: 'container',
  ...content,
})

describe('State bindings: clicks', () => {
  const clickOf = (
    events: UIDLElement['events'],
    hast = hastOf('div'),
    bindingContext = context()
  ) => {
    bindElement(element({ events }), hast, bindingContext, {} as GeneratorOptions)
    return hast
  }

  it('toggles, sets, increments and decrements', () => {
    expect(
      clickOf({ click: [{ type: 'stateChange', modifies: 'menuOpen', newState: '$toggle' }] })
        .properties['data-tq-on-click']
    ).toBe('menuOpen = !menuOpen')
    expect(
      clickOf({ click: [{ type: 'stateChange', modifies: 'plan', newState: 'yearly' }] })
        .properties['data-tq-on-click']
    ).toBe(`plan = 'yearly'`)
    expect(
      clickOf({
        click: [
          { type: 'stateChange', modifies: 'count', newState: { type: '$increment' } },
          {
            type: 'stateChange',
            modifies: 'activeTabIndex',
            newState: { type: '$decrement', delta: 2 },
          },
        ],
      }).properties['data-tq-on-click']
    ).toBe('count = count + 1; activeTabIndex = activeTabIndex - 2')
  })

  it('coerces a literal to the type the state declares, as the workflow runtime does', () => {
    expect(
      clickOf({ click: [{ type: 'stateChange', modifies: 'menuOpen', newState: 'true' }] })
        .properties['data-tq-on-click']
    ).toBe('menuOpen = true')
    expect(
      clickOf({ click: [{ type: 'stateChange', modifies: 'activeTabIndex', newState: '2' }] })
        .properties['data-tq-on-click']
    ).toBe('activeTabIndex = 2')
  })

  it('skips what the runtime cannot do, and keeps the rest of the click', () => {
    const hast = clickOf({
      click: [
        { type: 'stateChange', modifies: 'activeTabIndex', newState: '$toggle' },
        {
          type: 'stateChange',
          modifies: 'cart',
          newState: { type: '$patch', path: 'count', value: 1 },
        },
        { type: 'stateChange', modifies: 'missing', newState: true },
        { type: 'propCall', calls: 'onClose' },
        { type: 'stateChange', modifies: 'menuOpen', newState: false },
      ],
    })
    expect(hast.properties['data-tq-on-click']).toBe('menuOpen = false')
    expect(
      clickOf({ change: [{ type: 'stateChange', modifies: 'menuOpen', newState: '$toggle' }] })
        .properties
    ).toEqual({})
  })

  it('a clickable div is reached with Tab and read as a button; a real button needs nothing', () => {
    const toggle = {
      click: [{ type: 'stateChange' as const, modifies: 'menuOpen', newState: '$toggle' }],
    }
    expect(clickOf(toggle).properties).toMatchObject({ role: 'button', tabindex: '0' })
    expect(clickOf(toggle, hastOf('button')).properties).not.toHaveProperty('role')
    expect(clickOf(toggle, hastOf('a', { href: 'about.html' })).properties).not.toHaveProperty(
      'tabindex'
    )
    expect(clickOf(toggle, hastOf('div', { role: 'tab' })).properties.role).toBe('tab')
  })

  it('marks the states a click uses on its scope', () => {
    const bindingContext = context()
    clickOf(
      { click: [{ type: 'stateChange', modifies: 'menuOpen', newState: '$toggle' }] },
      hastOf('div'),
      bindingContext
    )
    expect(Array.from(bindingContext.scope.used)).toEqual(['menuOpen'])
  })
})

const tabWorkflow = (
  index: number,
  overrides: { nodes?: UIDLWorkflow['nodes']; selectedPages?: Array<{ id: string }> } = {}
): UIDLWorkflow => ({
  id: `switch-${index}`,
  name: `Switch to Tab ${index + 1}`,
  trigger: {
    nodeId: `trigger-${index}`,
    type: 'event-element-clicked',
    scope: 'element',
    config: {
      nodeId: `doc-node-${index}`,
      elementHtmlId: `tab-${index}`,
      preventDefault: false,
      ...(overrides.selectedPages ? { selectedPages: overrides.selectedPages } : {}),
    },
  },
  nodes: overrides.nodes ?? [
    {
      id: `set-${index}`,
      type: 'state-update-local-state',
      label: 'Set',
      config: { property: 'activeTabIndex', value: index },
      executionEnv: 'client',
      stepNumber: 1,
    },
  ],
  edges: [],
  usedInNodes: {},
})

describe('State bindings: tab workflows', () => {
  const triggerOf = (
    workflows: UIDLWorkflow[],
    id: string,
    hast = hastOf('div', { id }),
    bindingContext = context()
  ) => {
    bindElement(element({ attrs: { id: staticNode(id) } }), hast, bindingContext, {
      workflows: {
        workflows: Object.fromEntries(workflows.map((workflow) => [workflow.id, workflow])),
      },
    } as GeneratorOptions)
    return hast.properties['data-tq-on-click']
  }

  it("compiles the editor's tab switch into the trigger's click", () => {
    const workflows = [0, 1, 2].map((index) => tabWorkflow(index))
    expect(triggerOf(workflows, 'tab-0')).toBe('activeTabIndex = 0')
    expect(triggerOf(workflows, 'tab-2')).toBe('activeTabIndex = 2')
    expect(triggerOf(workflows, 'elsewhere')).toBeUndefined()
  })

  it("a dynamic tab switch reads the clicked trigger's data-tab-index", () => {
    const dynamic = tabWorkflow(0, {
      nodes: [
        {
          id: 'set',
          type: 'state-update-local-state',
          label: 'Switch to Tab',
          config: {
            property: 'activeTabIndex',
            value: { type: 'workflowContext', nodeId: 'trigger-0', path: ['dataTabIndex'] },
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
      ],
    })
    expect(
      triggerOf([dynamic], 'tab-0', hastOf('div', { id: 'tab-0', 'data-tab-index': '4' }))
    ).toBe('activeTabIndex = 4')
    expect(triggerOf([dynamic], 'tab-0', hastOf('div', { id: 'tab-0' }))).toBeUndefined()
  })

  it('runs batch updates and chained steps in order', () => {
    const chained = tabWorkflow(1, {
      nodes: [
        {
          id: 'second',
          type: 'state-batch-update',
          label: 'Batch',
          config: {
            updates: [
              { key: 'menuOpen', value: 'false' },
              { key: 'plan', value: 'yearly' },
            ],
          },
          executionEnv: 'client',
          stepNumber: 2,
        },
        {
          id: 'first',
          type: 'state-update-local-state',
          label: 'Set',
          config: { property: 'activeTabIndex', value: '1' },
          executionEnv: 'client',
          stepNumber: 1,
        },
      ],
    })
    expect(triggerOf([chained], 'tab-1')).toBe(
      `activeTabIndex = 1; menuOpen = false; plan = 'yearly'`
    )
  })

  it('skips a workflow that does anything else, branches, or belongs to another page', () => {
    const fetching = tabWorkflow(0, {
      nodes: [
        { ...tabWorkflow(0).nodes[0] },
        {
          id: 'fetch',
          type: 'data-fetch',
          label: 'Fetch',
          config: {},
          executionEnv: 'server',
          stepNumber: 2,
        },
      ],
    })
    expect(triggerOf([fetching], 'tab-0')).toBeUndefined()

    const branching = tabWorkflow(0, {
      nodes: [
        { ...tabWorkflow(0).nodes[0], id: 'a' },
        { ...tabWorkflow(0).nodes[0], id: 'b', config: { property: 'menuOpen', value: true } },
      ],
    })
    expect(triggerOf([branching], 'tab-0')).toBeUndefined()

    const otherPage = tabWorkflow(0, { selectedPages: [{ id: 'about' }] })
    const onThisPage = tabWorkflow(0, { selectedPages: [{ id: 'home' }] })
    const pageContext = { ...context(), scope: createStateScope('Home', STATES, 'home') }
    expect(
      triggerOf([otherPage], 'tab-0', hastOf('div', { id: 'tab-0' }), pageContext)
    ).toBeUndefined()
    expect(triggerOf([onThisPage], 'tab-0', hastOf('div', { id: 'tab-0' }), pageContext)).toBe(
      'activeTabIndex = 0'
    )
  })

  it('a state class follows its condition, and only for a class the project defines', () => {
    const tab = hastOf('div')
    const active = (referenceId: string, operand: number) => ({
      type: 'style-map' as const,
      content: {
        mapType: 'project-referenced' as const,
        referenceId,
        condition: {
          reference: stateRef('activeTabIndex'),
          expression: { conditions: [{ operation: '=', operand }] },
        },
      },
    })
    bindElement(
      element({ referencedStyles: { a: active('tab-active', 1), b: active('not-a-class', 1) } }),
      tab,
      context(),
      {
        projectStyleSet: {
          styleSetDefinitions: {
            'tab-active': { type: 'reusable-project-style-map', content: {} },
          },
          fileName: 'style',
          path: '',
        },
      } as GeneratorOptions
    )
    expect(tab.properties['data-tq-class']).toBe('tab-active: activeTabIndex === 1')
  })
})

describe('State bindings in a generated component', () => {
  const generate = async (node: ReturnType<typeof elementNode>) => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const structure: ComponentStructure = {
      chunks: [],
      options: { extractedResources: {} },
      uidl: component('Test', node, {}, STATES),
      dependencies: {},
    }
    const { chunks } = await htmlComponentPlugin(structure)
    return chunks.find((chunk) => chunk.fileType === FileType.HTML)?.content as HastNode
  }
  it('a condition the runtime cannot run is still resolved once, as before', async () => {
    const root = await generate(
      elementNode('container', {}, [
        {
          type: 'conditional',
          content: {
            reference: stateRef('cart', ['count']),
            node: elementNode('text', { id: staticNode('empty') }, [staticNode('Empty')]),
            condition: { conditions: [{ operation: '===', operand: 0 }] },
          },
        },
        {
          type: 'conditional',
          content: {
            reference: stateRef('plan'),
            node: elementNode('text', { id: staticNode('starts') }, [staticNode('Starts')]),
            condition: { conditions: [{ operation: 'startsWith', operand: 'month' }] },
          },
        },
      ])
    )
    const markup = JSON.stringify(root)
    expect(markup).not.toContain('data-tq-')
    expect(markup).not.toContain('"hidden"')
    expect(markup).toContain('"id":"empty"')
    expect(markup).not.toContain('"id":"starts"')
    expect(root.properties).toEqual({})
  })

  it('the component root carries the store of the states its bindings read', async () => {
    const root = await generate(
      elementNode('container', {}, [
        {
          type: 'conditional',
          content: {
            reference: stateRef('menuOpen'),
            node: elementNode('text', {}, [staticNode('Menu')]),
            condition: { conditions: [{ operation: '===', operand: true }] },
          },
        },
      ])
    )
    expect(root.properties).toEqual({
      'data-tq-scope': 'Test',
      'data-tq-state': 'menuOpen = false',
    })
    const menu = (root.children[0] as HastNode).children[0] as HastNode
    expect(menu.properties).toMatchObject({ 'data-tq-if': 'menuOpen', hidden: true })
  })

  it('a text branch gets an element of its own to hide', async () => {
    const root = await generate(
      elementNode('container', {}, [
        {
          type: 'conditional',
          content: {
            reference: stateRef('plan'),
            node: staticNode('Billed yearly'),
            condition: { conditions: [{ operation: '===', operand: 'yearly' }] },
          },
        },
      ])
    )
    const wrapper = (root.children[0] as HastNode).children[0] as HastNode
    expect(wrapper.tagName).toBe('span')
    expect(wrapper.properties).toEqual({
      'data-tq-if': `plan === 'yearly'`,
      hidden: true,
      style: 'display: contents',
    })
  })

  it('repeated tabs: each trigger sets its own index and each panel tests its own', async () => {
    const { htmlComponentPlugin } = createHTMLBasePlugin()
    const index = { type: 'expr' as const, content: 'index' }
    const repeater = {
      type: 'cms-list-repeater' as const,
      content: {
        elementType: 'cms-list-repeater',
        name: 'tabs',
        key: 'tabs',
        renderPropIdentifier: 'tab',
        source: JSON.stringify([{ label: 'A' }, { label: 'B' }, { label: 'C' }]),
        nodes: {
          list: elementNode('container', {}, [
            elementNode('container', { id: staticNode('tab-trigger'), 'data-tab-index': index }, [
              staticNode('Tab'),
            ]),
            {
              type: 'conditional' as const,
              content: {
                reference: stateRef('activeTabIndex'),
                condition: { conditions: [{ operation: '=', operand: index }] },
                node: elementNode('container', { id: staticNode('tab-panel') }, [
                  staticNode('Panel'),
                ]),
              },
            },
          ]),
        },
      },
    }
    const switchTab = tabWorkflow(0, {
      nodes: [
        {
          id: 'set',
          type: 'state-update-local-state',
          label: 'Switch to Tab',
          config: {
            property: 'activeTabIndex',
            value: { type: 'workflowContext', nodeId: 'trigger-0', path: ['dataTabIndex'] },
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
      ],
    })
    switchTab.trigger.config.elementHtmlId = 'tab-trigger'
    const { chunks } = await htmlComponentPlugin({
      chunks: [],
      options: {
        extractedResources: {},
        workflows: { workflows: { [switchTab.id]: switchTab } },
      },
      uidl: component(
        'Test',
        elementNode('container', {}, [repeater as unknown as ReturnType<typeof elementNode>]),
        {},
        STATES
      ),
      dependencies: {},
    })
    const found: HastNode[] = []
    const walk = (node: HastNode) => {
      if (node.properties?.id) {
        found.push(node)
      }
      ;(node.children || []).forEach((child) => walk(child as HastNode))
    }
    walk(chunks.find((chunk) => chunk.fileType === FileType.HTML)?.content as HastNode)

    expect(
      found
        .filter((node) => node.properties.id === 'tab-trigger')
        .map((node) => [node.properties['data-tab-index'], node.properties['data-tq-on-click']])
    ).toEqual([
      ['0', 'activeTabIndex = 0'],
      ['1', 'activeTabIndex = 1'],
      ['2', 'activeTabIndex = 2'],
    ])
    expect(
      found
        .filter((node) => node.properties.id === 'tab-panel')
        .map((node) => [node.properties['data-tq-if'], Boolean(node.properties.hidden)])
    ).toEqual([
      ['activeTabIndex === 0', false],
      ['activeTabIndex === 1', true],
      ['activeTabIndex === 2', true],
    ])
  })

  it('a condition around a condition joins it on the same element', async () => {
    const root = await generate(
      elementNode('container', {}, [
        {
          type: 'conditional',
          content: {
            reference: stateRef('activeTabIndex'),
            condition: { conditions: [{ operation: '===', operand: 0 }] },
            node: {
              type: 'conditional',
              content: {
                reference: stateRef('menuOpen'),
                condition: { conditions: [{ operation: '===', operand: true }] },
                node: elementNode('text', {}, [staticNode('Both')]),
              },
            },
          },
        },
      ])
    )
    const both = (root.children[0] as HastNode).children[0] as HastNode
    expect(both.properties).toEqual({
      'data-tq-if': 'activeTabIndex === 0 && menuOpen',
      hidden: true,
    })
  })
})
