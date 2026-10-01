import { GeneratedFolder, ProjectUIDL, UIDLFormDefinition } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const FORM_ID = 'contact-form'

const formElement = (fieldAttrs: Record<string, unknown>) => ({
  type: 'element',
  content: {
    elementType: 'form',
    name: 'contact',
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
            required: { type: 'static', content: true },
            ...fieldAttrs,
          },
        },
      },
    ],
  },
})

const formDefinition = (security?: UIDLFormDefinition['security']): UIDLFormDefinition => ({
  id: { type: 'static', content: FORM_ID },
  name: { type: 'static', content: 'Contact' },
  formNodeId: { type: 'static', content: 'form-node' },
  fields: {
    email: {
      id: { type: 'static', content: 'email' },
      name: { type: 'static', content: 'email' },
      nodeId: { type: 'static', content: 'email-node' },
      type: 'textinput',
    },
  },
  behaviors: {
    onSuccess: { action: 'clear-form' },
    onError: { action: 'clear-form' },
  },
  ...(security ? { security } : {}),
})

const buildUidl = (params: {
  fieldAttrs?: Record<string, unknown>
  security?: UIDLFormDefinition['security']
}): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(formElement(params.fieldAttrs ?? {}))
  uidl.forms = {
    items: { [FORM_ID]: formDefinition(params.security) },
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

describe('Next forms: captcha switch and field error messages', () => {
  const generator = createNextProjectGenerator()

  it('loads and runs reCAPTCHA for a form that keeps it on', async () => {
    const page = indexPageOf(await generator.generateProject(buildUidl({}), template))
    expect(page).toContain('recaptcha/enterprise.js')
    expect(page).toContain('captchaToken')
  })

  it('loads no captcha script and sends no token for a form that turned it off', async () => {
    const page = indexPageOf(
      await generator.generateProject(
        buildUidl({ security: { captchaEnabled: { type: 'static', content: false } } }),
        template
      )
    )
    expect(page).not.toContain('recaptcha')
    expect(page).not.toContain('captchaToken')
  })

  it("shows a field's own message instead of the browser's", async () => {
    const page = indexPageOf(
      await generator.generateProject(
        buildUidl({
          fieldAttrs: {
            'data-error-message': { type: 'static', content: 'Use your work email' },
          },
        }),
        template
      )
    )
    expect(page).toContain('data-error-message="Use your work email"')
    expect(page).toContain("addEventListener('invalid', showFieldErrorMessage, true)")
    expect(page).toContain('setCustomValidity(message)')
    expect(page).toContain("setCustomValidity('')")
  })

  it('adds nothing when no field has its own message', async () => {
    const page = indexPageOf(await generator.generateProject(buildUidl({}), template))
    expect(page).not.toContain('showFieldErrorMessage')
  })
})
