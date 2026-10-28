import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as types from '@babel/types'
import { GeneratedFolder, ProjectUIDL, UIDLFormDefinition } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * A navigation search form the editor's Instant search plugin adopted, when
 * the platform also STORES that form's submissions (the editor gives such a
 * form `data-form-id`, and the project's forms carry its definition).
 *
 * The plugin opens the search on the form's `submit` through a workflow whose
 * trigger asks for `preventDefault` + `stopPropagation`. The form submission
 * plugin runs before the workflow plugin, so the workflow's handler is
 * COMBINED with the form's own `handleFormSubmit_*` on the same `<form>` —
 * and the form's handler is called first. `stopPropagation` inside the second
 * call cannot stop the first: every Enter in the read-only field would post an
 * empty submission to the Forms API before the search opens.
 *
 * The editor therefore pauses the form's submission storage while the plugin
 * owns it (`adopt-chrome-trigger.ts`); the editor then exports no definition
 * for it (`formsToUIDL` skips `storeSubmissions === false`), and the form's
 * submit runs the workflow alone.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const OPEN_EVENT = 'tq-search-open'
const FORM_HTML_ID = 'nav-search-form'
const FORM_ID = 'nav-search-settings'
const SUBMIT_HANDLER = 'handleFormSubmit_nav_search_settings'

type Uidl = Record<string, any> // tslint:disable-line:no-any

const staticValue = (content: unknown) => ({ type: 'static', content })
const element = (content: Uidl) => ({ type: 'element', content })

const navigationComponent = (): Uidl => ({
  name: 'Navigation',
  propDefinitions: {},
  stateDefinitions: {},
  node: element({
    elementType: 'container',
    semanticType: 'div',
    children: [
      element({
        elementType: 'form',
        semanticType: 'form',
        attrs: {
          id: staticValue(FORM_HTML_ID),
          // What the editor adds to every form that has form settings.
          'data-form-id': staticValue(FORM_ID),
          'data-tq-search-control': staticValue('adopted'),
        },
        children: [
          element({
            elementType: 'textinput',
            attrs: {
              type: staticValue('search'),
              name: staticValue('q'),
              'aria-haspopup': staticValue('dialog'),
              readonly: staticValue(true),
            },
            children: [],
          }),
        ],
      }),
    ],
  }),
})

const formDefinition = (): UIDLFormDefinition => ({
  id: { type: 'static', content: FORM_ID },
  name: { type: 'static', content: 'Search' },
  formNodeId: { type: 'static', content: 'form-node' },
  fields: {
    q: {
      id: { type: 'static', content: 'q' },
      name: { type: 'static', content: 'q' },
      nodeId: { type: 'static', content: 'input-node' },
      type: 'textinput',
    },
  },
  behaviors: { onSuccess: { action: 'clear-form' }, onError: { action: 'clear-form' } },
})

const submitWorkflow = (): Uidl => ({
  id: 'open-search',
  name: 'Open the search',
  trigger: {
    nodeId: 'open-search-trigger',
    type: 'event-element-event',
    config: {
      nodeId: 'form-node',
      eventType: 'submit',
      preventDefault: true,
      stopPropagation: true,
      elementHtmlId: FORM_HTML_ID,
    },
    scope: 'element',
  },
  nodes: [
    {
      id: 'open-search-emit',
      type: 'general-emit-custom-event',
      label: 'Emit Custom Event',
      config: { eventName: OPEN_EVENT, scope: 'global' },
      executionEnv: 'client',
      stepNumber: 1,
    },
  ],
  edges: [{ id: 'open-search-edge', source: 'open-search-trigger', target: 'open-search-emit' }],
  usedInNodes: {},
})

/** The project as the editor exports it; `stored`: the form's submissions are stored. */
const buildUidl = (stored: boolean): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as Uidl
  uidl.components.Navigation = navigationComponent()
  const indexPage = uidl.root.node.content.children.find(
    (child: Uidl) => child.type === 'conditional' && child.content.value === 'index'
  )
  indexPage.content.node.content.children.push(
    element({
      elementType: 'component',
      semanticType: 'Navigation',
      name: 'navigation',
      dependency: { type: 'local' },
    })
  )
  uidl.workflows = { workflows: { 'open-search': submitWorkflow() }, customNodes: {} }
  uidl.forms = {
    // A form whose storage is off is not exported (`formsToUIDL`).
    items: stored ? { [FORM_ID]: formDefinition() } : {},
    formsServerUrl: { type: 'env', content: 'NEXT_PUBLIC_FORMS_SERVER_URL' },
  }
  return uidl as ProjectUIDL
}

const generateNavigation = async (stored: boolean): Promise<types.File> => {
  const folder = await createNextProjectGenerator().generateProject(buildUidl(stored), template)
  const file = folder.subFolders
    .find((sub) => sub.name === 'components')
    ?.files.find((entry) => entry.name === 'navigation')
  expect(file).toBeDefined()
  return parse(String(file?.content), { sourceType: 'module', plugins: ['jsx'] })
}

/** The printed `onSubmit` value(s) of the form whose html id is `FORM_HTML_ID`. */
const formOnSubmit = (ast: types.File): string[] => {
  const values: string[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      const attrs = path.node.attributes.filter((attr): attr is types.JSXAttribute =>
        types.isJSXAttribute(attr)
      )
      const id = attrs.find((attr) => types.isJSXIdentifier(attr.name, { name: 'id' }))
      if (!id || !types.isStringLiteral(id.value) || id.value.value !== FORM_HTML_ID) {
        return
      }
      for (const attr of attrs) {
        if (types.isJSXIdentifier(attr.name, { name: 'onSubmit' }) && attr.value) {
          values.push(generate(attr.value as never).code)
        }
      }
    },
  })
  return values
}

describe('an adopted navigation search form whose submissions the platform stores', () => {
  it('without the pause: the form handler posts the submission BEFORE the workflow can stop it', async () => {
    const [onSubmit, ...others] = formOnSubmit(await generateNavigation(true))
    expect(others).toEqual([])
    const formHandlerAt = onSubmit.indexOf(`${SUBMIT_HANDLER}(event)`)
    const workflowAt = onSubmit.indexOf(`elementTriggers['${FORM_HTML_ID}']['onSubmit'](event)`)
    // Both on the one <form>, the stored submission first.
    expect(formHandlerAt).toBeGreaterThan(-1)
    expect(workflowAt).toBeGreaterThan(formHandlerAt)
  })

  it('with the storage paused (no definition exported): the submit runs the workflow alone', async () => {
    // The form submission plugin warns about the form it has no definition for.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const ast = await generateNavigation(false)
      expect(formOnSubmit(ast)).toEqual([
        `{__wfRef.current.elementTriggers['${FORM_HTML_ID}']['onSubmit']}`,
      ])
      expect(generate(ast).code).not.toContain(SUBMIT_HANDLER)
    } finally {
      warn.mockRestore()
    }
  })
})
