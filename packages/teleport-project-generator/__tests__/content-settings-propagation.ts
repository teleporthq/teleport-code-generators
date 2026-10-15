import { ProjectUIDL } from '@teleporthq/teleport-types'
import { createProjectGenerator } from '../src'
import { createStrategyWithCommonGenerator } from './mocks'
import projectUIDL from '../../../examples/test-samples/project-sample.json'

/**
 * Each content preset's settings reach the page generators on their own: a
 * Help Center needs no Blog. Passed only inside the Blog's condition, a
 * Help-Center-only project generated its help articles' transform with an
 * EMPTY taxonomy — every article lost its categories' ids, and the article
 * page's breadcrumbs showed "Help Center" and nothing after it.
 */

const helpCenterSettings = {
  categories: [{ id: 'guides', name: 'Guides', slug: 'guides', children: [] }],
}

const generatedWith = async (uidl: ProjectUIDL) => {
  const strategy = createStrategyWithCommonGenerator()
  const generator = createProjectGenerator(strategy)
  await generator.generateProject(uidl)
  return (generator.pageGenerator.generateComponent as jest.Mock).mock.calls.map(
    (call) => call[1] as Record<string, unknown>
  )
}

describe('content preset settings handed to the page generators', () => {
  it('include a Help Center’s on a project without a blog', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL)) as ProjectUIDL
    delete (uidl as { blogSettings?: unknown }).blogSettings
    uidl.helpCenterSettings = helpCenterSettings as never

    const pageOptions = await generatedWith(uidl)

    expect(pageOptions.length).toBeGreaterThan(0)
    for (const options of pageOptions) {
      expect(options.helpCenterSettings).toEqual(helpCenterSettings)
      expect(options).not.toHaveProperty('blogSettings')
    }
  })

  it('include both presets’ when the project has both', async () => {
    const uidl = JSON.parse(JSON.stringify(projectUIDL)) as ProjectUIDL
    const blogSettings = { categories: [] }
    uidl.blogSettings = blogSettings as never
    uidl.helpCenterSettings = helpCenterSettings as never

    const [options] = await generatedWith(uidl)

    expect(options.blogSettings).toEqual(blogSettings)
    expect(options.helpCenterSettings).toEqual(helpCenterSettings)
  })
})
