import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSampleWithMultiplePagesWithSameName from './project-with-same-page-names-in-diff-routes.json'
import template from './template-definition.json'
import { createNextProjectGenerator } from '../../src'

/**
 * A CONDITIONALLY-APPLIED project class must publish.
 *
 * The editor imports generated markup like
 * `class="pill {{ state.x === 'A' ? 'active' : '' }}"` as a marker class with
 * EMPTY content (the styles live on compound `.pill.active` rules) applied
 * through a conditional `project-referenced` style. The publish pipeline then
 * validates that every `project-referenced` referenceId is a key of
 * `root.styleSetDefinitions` — so a project whose marker class is missing from
 * the definitions fails with "<id> is missing from the styleSetDefinitions"
 * once per referencing element, and the app never generates.
 *
 * These two tests pin both halves: the exact validation failure when the
 * definition is absent, and a full Next.js generation when it is present —
 * empty content included, because empty is what the marker class legitimately
 * is.
 */
describe('project-referenced style with a condition', () => {
  const generator = createNextProjectGenerator()

  const buildUidl = (withActiveDefinition: boolean): ProjectUIDL => {
    const uidl = JSON.parse(JSON.stringify(uidlSampleWithMultiplePagesWithSameName)) as ProjectUIDL

    if (withActiveDefinition) {
      uidl.root.styleSetDefinitions.active = {
        type: 'reusable-project-style-map',
        content: {},
      }
    }

    // The Home page container gains a filter pill: one unconditional
    // project-referenced class and one applied under a condition — the exact
    // pair the editor emits for a state-toggled class token.
    const homeRoute = uidl.root.node.content.children.find(
      (child) => child.type === 'conditional' && child.content.value === 'Home'
    )
    if (homeRoute?.type !== 'conditional' || homeRoute.content.node.type !== 'element') {
      throw new Error('fixture drifted: Home route not found')
    }
    homeRoute.content.node.content.children.push({
      type: 'element',
      content: {
        elementType: 'container',
        semanticType: 'div',
        name: 'filter-pill',
        referencedStyles: {
          'ref-plain': {
            type: 'style-map',
            content: { mapType: 'project-referenced', referenceId: 'Content' },
          },
          'ref-active': {
            type: 'style-map',
            content: {
              mapType: 'project-referenced',
              referenceId: 'active',
              condition: {
                reference: { type: 'dynamic', content: { referenceType: 'local', id: 'item' } },
                expression: {
                  conditions: [{ operation: '===', operand: 'All' }],
                  matchingCriteria: 'all',
                },
              },
            },
          },
        },
        abilities: {},
        style: {},
        children: [{ type: 'static', content: 'All' }],
        attrs: {},
        events: {},
      },
    })
    return uidl
  }

  it('fails validation with the publish error when the definition is missing', async () => {
    await expect(generator.generateProject(buildUidl(false), template)).rejects.toThrow(
      /active is missing from the styleSetDefinitions/
    )
  })

  it('generates the Next.js project when the marker class is defined, even with empty content', async () => {
    const outputFolder: GeneratedFolder = await generator.generateProject(buildUidl(true), template)

    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')

    const pagesFolder = outputFolder.subFolders.find((folder) => folder.name === 'pages')
    expect(pagesFolder).toBeDefined()
    const homePage = pagesFolder?.files.find((file) => file.name === 'index')
    expect(homePage).toBeDefined()
    // The conditional application generates as a runtime className toggle and
    // the unconditional project class rides beside it — the live behaviour the
    // marker class exists for.
    expect(homePage?.content).toContain("? 'active' : ''")
    expect(homePage?.content).toContain('Content ')
  })
})
