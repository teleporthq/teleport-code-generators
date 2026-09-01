import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

/**
 * The unit tests in `controlled-select.ts` pin the rule; these run the real
 * plugin, because the defect was never in the rule — it was in WHERE the
 * decision got made.
 *
 * `makeControlUncontrolledWhenNoChangeHandler` demotes `value` → `defaultValue`
 * on a form control with no change handler, while the JSX is generated. Element
 * triggers are attached afterwards, by this plugin. So a `<select>` whose only
 * handler is a workflow was always demoted, and `defaultValue` is read once at
 * mount — state established after hydration (a `?sortBy=` deep link) never
 * reached the DOM. The products list shipped sorted correctly under a dropdown
 * reading "Name (A-Z)".
 */

const changeWorkflow = (elementHtmlId: string, property: string) => ({
  id: `wf-${property}`,
  name: 'Sort changed',
  trigger: {
    type: 'event-element-event',
    nodeId: 'trigger-change',
    scope: 'element',
    config: { elementHtmlId, eventType: 'change' },
  },
  nodes: [
    {
      id: 'update-1',
      type: 'state-update-local-state',
      config: {
        property,
        value: {
          type: 'workflowContext',
          nodeId: 'trigger-change',
          path: ['trigger-change', 'value'],
        },
      },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-change', target: 'update-1' }],
})

const runPlugin = async (
  componentSource: string,
  workflows: Record<string, unknown>
): Promise<string> => {
  const ast = parse(componentSource, { plugins: ['jsx'] })
  const chunk = {
    type: 'chunk-type-ast',
    name: 'jsx-component',
    content: ast.program.body[0],
  }
  const structure: any = {
    uidl: {
      name: 'ProductsList',
      outputOptions: { pageId: 'page-products', fileName: 'products' },
      stateDefinitions: {},
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    },
    chunks: [chunk],
    options: { workflows: { workflows, customNodes: {} } },
    dependencies: {},
  }
  await createNextWorkflowPlugin({ isPage: true })(structure)
  return generate(chunk.content as any).code
}

const SORT_SELECT = (extraAttrs = '') => `const ProductsList = (props) => {
  return (
    <select id="thq_sort" ${extraAttrs} defaultValue={sortBy}>
      <option value="name-asc">Name (A-Z)</option>
      <option value="price-asc">Price (low to high)</option>
    </select>
  )
}`

describe('a select made controlled by its workflow', () => {
  it('ships `value=`, not `defaultValue=`', async () => {
    const code = await runPlugin(SORT_SELECT(), {
      'wf-sortBy': changeWorkflow('thq_sort', 'sortBy'),
    })
    expect(code).toContain('value={sortBy}')
    expect(code).not.toContain('defaultValue={sortBy}')
    expect(code).toContain(`__wfRef.current.elementTriggers["thq_sort"]["onChange"]`)
  })

  it('keeps the options and the rest of the element intact', async () => {
    const code = await runPlugin(SORT_SELECT(), {
      'wf-sortBy': changeWorkflow('thq_sort', 'sortBy'),
    })
    expect(code).toContain('<option value="name-asc">')
    expect(code).toContain('<option value="price-asc">')
    expect(code).toContain('id="thq_sort"')
  })

  it('does not end up with both props when the JSX was already controlled', async () => {
    const code = await runPlugin(
      `const ProductsList = (props) => {
        return <select id="thq_sort" value={sortBy} defaultValue={sortBy} />
      }`,
      { 'wf-sortBy': changeWorkflow('thq_sort', 'sortBy') }
    )
    expect(code).toContain('value={sortBy}')
    expect(code).not.toContain('defaultValue')
  })
})

describe('what the plugin still leaves uncontrolled', () => {
  it('a select whose workflow writes some OTHER state', async () => {
    // Controlling it would freeze the dropdown — nothing moves `sortBy`, so
    // every selection would snap straight back.
    const code = await runPlugin(SORT_SELECT(), {
      'wf-other': changeWorkflow('thq_sort', 'somethingElse'),
    })
    expect(code).toContain('defaultValue={sortBy}')
    expect(code).not.toContain('value={sortBy}')
  })

  it('a select bound to an entity field rather than a state name', async () => {
    const code = await runPlugin(
      `const EditForm = (props) => {
        return <select id="thq_sort" defaultValue={props.item?.category} />
      }`,
      { 'wf-category': changeWorkflow('thq_sort', 'category') }
    )
    expect(code).toContain('defaultValue={props.item?.category}')
  })

  it('a text input, even when its workflow writes the bound state', async () => {
    // An input needs a SYNCHRONOUS write-back per keystroke; a workflow is an
    // async pipeline, and a controlled input whose state lags drops characters
    // and jumps the caret.
    const code = await runPlugin(
      `const Chat = (props) => {
        return <input type="text" id="thq_msg" defaultValue={chatInputValue} />
      }`,
      { 'wf-chat': changeWorkflow('thq_msg', 'chatInputValue') }
    )
    expect(code).toContain('defaultValue={chatInputValue}')
    expect(code).not.toContain('value={chatInputValue}')
  })

  it('a checkbox — a toggle that bounces back reads as broken', async () => {
    const code = await runPlugin(
      `const Form = (props) => {
        return <input type="checkbox" id="thq_agree" defaultChecked={agreed} />
      }`,
      { 'wf-agree': changeWorkflow('thq_agree', 'agreed') }
    )
    expect(code).toContain('defaultChecked={agreed}')
    expect(code).not.toContain('checked={agreed}')
  })

  it('a select whose workflow is triggered by a CLICK, not a change', async () => {
    const clickWorkflow = {
      ...changeWorkflow('thq_sort', 'sortBy'),
      trigger: {
        type: 'event-element-clicked',
        nodeId: 'trigger-click',
        scope: 'element',
        config: { elementHtmlId: 'thq_sort', eventType: 'click' },
      },
    }
    const code = await runPlugin(SORT_SELECT(), { 'wf-click': clickWorkflow })
    expect(code).toContain('defaultValue={sortBy}')
  })
})
