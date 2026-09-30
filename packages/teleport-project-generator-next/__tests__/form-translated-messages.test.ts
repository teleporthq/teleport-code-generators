import { GeneratedFolder, ProjectUIDL, UIDLFormDefinition } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const FORM_ID = 'contact-form'
const ALERT_KEY = 'form-alert-success_ab12cd'
const FIELD_MESSAGE_KEY = 'data-error-message_ef34gh'

const formElement = {
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
            'data-error-message': {
              type: 'dynamic',
              content: {
                referenceType: 'locale',
                id: FIELD_MESSAGE_KEY,
                fallback: 'Use your work email',
              },
            },
          },
        },
      },
    ],
  },
}

interface SampleOptions {
  translated?: boolean
  redirect?: boolean
  languages?: Record<string, string>
}

const formDefinition = ({ translated, redirect }: SampleOptions): UIDLFormDefinition => ({
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
    onSuccess: redirect
      ? { action: 'redirect-page', details: { url: { type: 'static', content: '/thanks' } } }
      : { action: 'clear-form-and-alert' },
    onError: { action: 'clear-form-and-alert' },
  },
  messages: {
    success: { type: 'static', content: 'Thanks!' },
    error: { type: 'static', content: 'Try again.' },
    ...(translated ? { translationKeys: { success: ALERT_KEY } } : {}),
  },
})

const buildUidl = (sample: SampleOptions): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(formElement)
  uidl.forms = {
    items: { [FORM_ID]: formDefinition(sample) },
    formsServerUrl: { type: 'env', content: 'NEXT_PUBLIC_FORMS_SERVER_URL' },
  } as ProjectUIDL['forms']
  uidl.internationalization = {
    main: { name: 'English', locale: 'en' },
    languages: sample.languages ?? { en: 'English', es: 'Spanish' },
    translations: {
      en: {
        [ALERT_KEY]: { type: 'static', content: 'Thanks!' },
        [FIELD_MESSAGE_KEY]: { type: 'static', content: 'Use your work email' },
      },
      es: {
        [ALERT_KEY]: { type: 'static', content: '¡Gracias!' },
        [FIELD_MESSAGE_KEY]: { type: 'static', content: 'Usa tu correo de trabajo' },
      },
    },
  } as ProjectUIDL['internationalization']
  return uidl
}

const indexPageOf = (folder: GeneratedFolder) =>
  folder.subFolders.find((sub) => sub.name === 'pages')?.files.find((file) => file.name === 'index')
    ?.content ?? ''

describe('Next forms: messages in the visitor language', () => {
  const generator = createNextProjectGenerator()

  it("reads a translated alert and a field's message from the locale files", async () => {
    const page = indexPageOf(
      await generator.generateProject(buildUidl({ translated: true }), template)
    )

    expect(page).toContain(`window.alert(translate.raw('${ALERT_KEY}'))`)
    expect(page).toContain("window.alert('Try again.')")
    expect(page).toContain(`data-error-message={translate.raw('${FIELD_MESSAGE_KEY}')}`)
    expect(page).toContain('const translate = useTranslations()')
    expect(page.match(/const translate = useTranslations\(\)/g)).toHaveLength(1)
    expect(page).toContain("from 'next-intl'")
  })

  it('keeps a plain alert text when the alert has no translation key', async () => {
    const page = indexPageOf(await generator.generateProject(buildUidl({}), template))
    expect(page).toContain("window.alert('Thanks!')")
    expect(page).not.toContain(`translate.raw('${ALERT_KEY}')`)
  })

  it('opens the page a form redirects to in the visitor language', async () => {
    const page = indexPageOf(
      await generator.generateProject(buildUidl({ redirect: true }), template)
    )

    expect(page).toContain("router.push('/thanks')")
    expect(page).not.toContain("window.location.href = '/thanks'")
    expect(page.match(/const router = useRouter\(\)/g)).toHaveLength(1)
    expect(page).toContain("from 'next/router'")
  })

  it('keeps a plain redirect on a site with one language', async () => {
    const page = indexPageOf(
      await generator.generateProject(
        buildUidl({ redirect: true, languages: { en: 'English' } }),
        template
      )
    )

    expect(page).toContain("window.location.href = '/thanks'")
    expect(page).not.toContain("router.push('/thanks')")
  })
})
