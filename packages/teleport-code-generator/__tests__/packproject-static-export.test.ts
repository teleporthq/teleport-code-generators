import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ProjectType, PublisherType, ProjectUIDL } from '@teleporthq/teleport-types'
import { plainSite } from '../../teleport-project-generator-html/__tests__/_helpers/state-site'
import { packProject } from '../src/index'

/**
 * The published site's age gate and popups run on head scripts and workflows
 * the Next.js export alone has. A download of another kind (HTML, React, …)
 * goes through `packProject`: the gate must still let a visitor in, and a
 * popup that could never open is left out.
 */
const outputPath = join(__dirname, 'packproject-static-export-tmp')

afterAll(() => {
  rmSync(outputPath, { recursive: true, force: true })
})

const s = (content: unknown) => ({ type: 'static', content })
const state = (id: string) => ({ type: 'dynamic', content: { referenceType: 'state', id } })
const el = (elementType: string, content: Record<string, unknown> = {}) => ({
  type: 'element',
  content: { elementType, ...content },
})
const when = (id: string, operand: unknown, node: unknown) => ({
  type: 'conditional',
  content: {
    reference: state(id),
    node,
    condition: { conditions: [{ operation: '===', operand }] },
  },
})

/** The editor's Age Gate component: open by default, closed by the site. */
const AGE_GATE = {
  name: 'AgeGate',
  stateDefinitions: { isAgeGateOpen: { type: 'boolean', defaultValue: true } },
  node: el('container', {
    children: [
      when(
        'isAgeGateOpen',
        true,
        el('container', {
          attrs: { 'data-tq-age-gate': s('true') },
          children: [
            el('button', {
              attrs: { id: s('age-gate-confirm'), 'data-tq-age-gate-confirm': s('true') },
              children: [s('I am 18 or older')],
            }),
          ],
        })
      ),
    ],
  }),
}

/** A popup the editor put at the end of every page: drawn only while open. */
const POPUP = {
  name: 'WelcomePopup',
  stateDefinitions: { isOpen: { type: 'boolean', defaultValue: false } },
  node: el('container', {
    children: [
      when(
        'isOpen',
        true,
        el('container', {
          attrs: { 'data-tq-popup-root': s('popup-1') },
          children: [s('Get 10% off')],
        })
      ),
    ],
  }),
}

const gatedSite = (): ProjectUIDL => {
  const uidl = plainSite() as any
  uidl.components.AgeGate = AGE_GATE
  uidl.components.WelcomePopup = POPUP
  uidl.root.node.content.children.forEach((page: any) => {
    page.content.node.content.children.push(
      el('component', { semanticType: 'WelcomePopup', dependency: { type: 'local' } }),
      el('component', { semanticType: 'AgeGate', dependency: { type: 'local' } })
    )
  })
  uidl.popups = {
    popups: [
      {
        id: 'popup-1',
        componentName: 'WelcomePopup',
        purpose: 'discount',
        layout: 'center',
        trigger: { desktop: 'load', phone: 'load', delaySeconds: 0, scrollPercent: 0 },
        frequency: { kind: 'days', days: 7 },
        pages: { mode: 'all', paths: [] },
        audience: 'everyone',
      },
    ],
    excludedPaths: [],
  }
  uidl.plugins = {
    accessRules: {
      settings: { ageGateEnabled: true, minimumAge: 18, ageGateScope: 'site' },
      data: { gate: 'component', gatedPaths: [], unavailablePaths: [] },
    },
  }
  return uidl
}

const download = async (projectType: ProjectType, projectSlug: string) => {
  const { success } = await packProject(gatedSite(), {
    projectType,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath, projectSlug },
  })
  expect(success).toBeTruthy()
  return join(outputPath, projectSlug)
}

// The HTML export's formatter re-indents the head's style and script, so only
// their contents are compared.
const GATE_STYLE = 'html[data-tq-age-gate="hidden"] [data-tq-age-gate]{display:none!important}'

describe('packProject, a download other than Next.js: the age gate and popups', () => {
  it('HTML: every page carries the gate’s script, which answers its button; no popup is left in', async () => {
    const root = await download(ProjectType.HTML, 'gated-html-site')
    for (const page of ['index.html', 'about.html']) {
      const html = readFileSync(join(root, page), 'utf8')
      expect(html).toContain(GATE_STYLE)
      expect(html).toContain('"confirm":"data-tq-age-gate-confirm"')
      expect(html).toContain('data-tq-age-gate-confirm="true"')
      expect(html).not.toContain('data-tq-popup-root')
    }
  })

  it('React: the app’s page carries the gate’s script; no popup is left in', async () => {
    const root = await download(ProjectType.REACT, 'gated-react-site')
    const index = readFileSync(join(root, 'public', 'index.html'), 'utf8')
    expect(index).toContain(GATE_STYLE)
    expect(index).toContain('"confirm":"data-tq-age-gate-confirm"')
    const home = readFileSync(join(root, 'src', 'views', 'home.js'), 'utf8')
    expect(home).toContain('<AgeGate')
    expect(home).not.toContain('WelcomePopup')
  })
})
