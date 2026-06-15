import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

// The production template (react ^17) — the same one the GUI publish path feeds
// into packProject.
const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const FORM_ID = '45f85562-a6f3-4b24-926a-baaf801ae016'
const FORM_NODE_ID = 'form-node-1'

const FORM_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'form',
    name: 'quote-form',
    attrs: {
      'data-form-id': { type: 'static', content: FORM_ID },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'input',
          name: 'email',
          attrs: {
            name: { type: 'static', content: 'email' },
            type: { type: 'static', content: 'email' },
          },
          children: [],
        },
      },
      {
        type: 'element',
        content: {
          elementType: 'button',
          name: 'submit',
          attrs: {
            name: { type: 'static', content: 'button' },
            type: { type: 'static', content: 'submit' },
          },
          children: [],
        },
      },
    ],
  },
}

const buildFormsBlock = (formsServerUrl: {
  type: 'env' | 'static'
  content: string
}): ProjectUIDL['forms'] =>
  ({
    items: {
      [FORM_ID]: {
        id: { type: 'static', content: FORM_ID },
        name: { type: 'static', content: 'Quote Form' },
        formNodeId: { type: 'static', content: FORM_NODE_ID },
        fields: {
          'quote-email': {
            id: { type: 'static', content: 'quote-email' },
            name: { type: 'static', content: 'email' },
            nodeId: { type: 'static', content: 'quote-email' },
            type: 'textinput',
            required: { type: 'static', content: true },
          },
          'btn-submit': {
            id: { type: 'static', content: 'btn-submit' },
            name: { type: 'static', content: 'button' },
            nodeId: { type: 'static', content: 'btn-submit' },
            type: 'button',
            required: { type: 'static', content: false },
          },
        },
        behaviors: {
          onSuccess: { action: 'clear-form-and-alert' },
          onError: { action: 'clear-form-and-alert' },
          onLimit: { action: 'clear-form-and-alert' },
        },
        messages: {
          success: { type: 'static', content: 'Thank you for your submission!' },
          error: { type: 'static', content: 'There was an error submitting your form.' },
          limit: { type: 'static', content: 'This form is no longer accepting submissions.' },
        },
      },
    },
    formsServerUrl,
  } as unknown as ProjectUIDL['forms'])

const buildUidlWithForm = (formsServerUrl: {
  type: 'env' | 'static'
  content: string
}): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(FORM_ELEMENT_NODE)
  uidl.forms = buildFormsBlock(formsServerUrl)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator form submission endpoint', () => {
  const generator = createNextProjectGenerator()

  it('targets the canonical /submissions/submit/<formId> route for an env-configured base', async () => {
    const outputFolder = await generator.generateProject(
      buildUidlWithForm({ type: 'env', content: 'NEXT_PUBLIC_FORMS_SERVER_URL' }),
      template
    )

    const indexPage = findFile(outputFolder, 'pages', 'index')
    const content = indexPage?.content || ''

    // The submit handler must exist and POST to the worker's real public route.
    expect(content).toContain('process.env.NEXT_PUBLIC_FORMS_SERVER_URL')
    expect(content).toContain(`/submissions/submit/${FORM_ID}`)

    // The base URL is normalized so the path is appended exactly once regardless
    // of whether the env value already includes it (the generated regex escapes
    // the slashes: /\/submissions\/submit$/).
    expect(content).toContain('submissions\\/submit$')
    expect(content).toContain('.replace(')

    // Regression guard: the old bug appended only `/<formId>` to the base.
    expect(content).not.toContain(`\${process.env.NEXT_PUBLIC_FORMS_SERVER_URL}/${FORM_ID}`)
  })

  it('normalizes a static base URL that already includes the submit path', async () => {
    const outputFolder = await generator.generateProject(
      buildUidlWithForm({
        type: 'static',
        content: 'https://forms.example.com/submissions/submit/',
      }),
      template
    )

    const content = findFile(outputFolder, 'pages', 'index')?.content || ''

    // Exactly one submit path segment — no duplication, no trailing slash.
    expect(content).toContain(`https://forms.example.com/submissions/submit/${FORM_ID}`)
    expect(content).not.toContain('/submissions/submit/submissions/submit/')
  })

  it('appends the submit path to a bare static base origin', async () => {
    const outputFolder = await generator.generateProject(
      buildUidlWithForm({ type: 'static', content: 'https://forms.example.com' }),
      template
    )

    const content = findFile(outputFolder, 'pages', 'index')?.content || ''
    expect(content).toContain(`https://forms.example.com/submissions/submit/${FORM_ID}`)
  })
})
