import { GeneratedFolder, ProjectUIDL, UIDLFormDefinition } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * A platform form rendered inside a rendering condition (a results step of a
 * multi-step page: `{activeStep === 7 && (<form data-form-id=…/>)}`) must
 * still receive the generated onSubmit handler. It did not: the handler was
 * declared but never attached, so a workflow's `form.requestSubmit()` posted
 * the form natively and reloaded the page, losing every state value.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
const FORM_ID = 'results-form'

const formElement = () => ({
  type: 'element',
  content: {
    elementType: 'form',
    name: 'results',
    attrs: { 'data-form-id': { type: 'static', content: FORM_ID } },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'textinput',
          name: 'email',
          attrs: {
            name: { type: 'static', content: 'email' },
            type: { type: 'static', content: 'email' },
          },
        },
      },
    ],
  },
})

const formDefinition = (): UIDLFormDefinition => ({
  id: { type: 'static', content: FORM_ID },
  name: { type: 'static', content: 'Results' },
  formNodeId: { type: 'static', content: 'form-node' },
  fields: {
    email: {
      id: { type: 'static', content: 'email' },
      name: { type: 'static', content: 'email' },
      nodeId: { type: 'static', content: 'email-node' },
      type: 'textinput',
    },
  },
  behaviors: { onSuccess: { action: 'clear-form' }, onError: { action: 'clear-form' } },
})

const buildUidl = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  const root = uidl.root as { stateDefinitions?: Record<string, unknown> }
  root.stateDefinitions = {
    ...(root.stateDefinitions || {}),
    activeStep: { type: 'number', defaultValue: 1 },
  }
  pageElement.children.push({
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'activeStep' } },
      value: 7,
      node: formElement(),
    },
  })
  uidl.forms = {
    items: { [FORM_ID]: formDefinition() },
    formsServerUrl: { type: 'env', content: 'NEXT_PUBLIC_FORMS_SERVER_URL' },
    globalConfig: {
      captchaProvider: 'recaptcha',
      defaultCaptchaPublicKey: { type: 'env', content: 'NEXT_PUBLIC_CAPTCHA_PUBLIC_KEY' },
    },
  } as ProjectUIDL['forms']
  return uidl
}

const indexPageOf = (folder: GeneratedFolder) =>
  folder.subFolders.find((sub) => sub.name === 'pages')?.files.find((file) => file.name === 'index')
    ?.content ?? ''

describe('Next forms: a form inside a rendering condition keeps its submit handler', () => {
  it('attaches onSubmit to the form rendered under `activeStep === 7`', async () => {
    const page = indexPageOf(
      await createNextProjectGenerator().generateProject(buildUidl(), template)
    )
    expect(page).toContain('activeStep === 7')
    expect(page).toContain(`data-form-id="${FORM_ID}"`)
    expect(page).toMatch(/onSubmit=\{handleFormSubmit_results_form\}/)
  })
})
