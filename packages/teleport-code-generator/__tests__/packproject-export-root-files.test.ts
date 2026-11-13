import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { ProjectType, ProjectUIDL, PublisherType } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import htmlUidlSample from '../../../examples/uidl-samples/tests.json'
import { packProject } from '../src/index'

/*
  What every downloaded project carries at its root, whichever format was
  chosen: a note telling its owner how to maintain the code, and a
  package.json that neither signs the project in TeleportHQ's name nor asks
  for a version nobody chose.
*/

const outputPath = join(__dirname, 'packproject-export-root-files-tmp')
const FLOATING_VERSION = /^(latest|next|\*|)$/
const UNPINNED_GIT = /^(github:|git\+|git:\/\/)(?!.*#[0-9a-f]{40}$)/

const PROJECT_TYPES = [
  ProjectType.NEXT,
  ProjectType.REACT,
  ProjectType.VUE,
  ProjectType.NUXT,
  ProjectType.ANGULAR,
  ProjectType.HTML,
]

afterAll(() => {
  rmSync(outputPath, { recursive: true, force: true })
})

describe('root files of a packed project', () => {
  PROJECT_TYPES.forEach((projectType) => {
    it(`${projectType}: a maintenance note and a package.json with chosen versions only`, async () => {
      const projectSlug = `root-files-${projectType.toLowerCase()}`
      const sample = projectType === ProjectType.HTML ? htmlUidlSample : uidlSample
      const uidl = JSON.parse(JSON.stringify(sample)) as ProjectUIDL

      const { success } = await packProject(uidl, {
        projectType,
        publisher: PublisherType.DISK,
        publishOptions: { outputPath, projectSlug },
      })
      expect(success).toBe(true)

      const projectPath = join(outputPath, projectSlug)
      const notePath = join(projectPath, 'MAINTENANCE.md')
      expect(existsSync(notePath)).toBe(true)
      expect(readFileSync(notePath, 'utf8')).toContain('`npm audit`')
      expect(existsSync(join(projectPath, 'README.md'))).toBe(false)

      const packageJSON = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf8'))
      expect(packageJSON.author).toBeUndefined()
      expect(packageJSON.license).toBeUndefined()
      // An app is not an npm package: without `private`, Yarn warns about the
      // missing licence on every command and a stray `npm publish` would go out.
      expect(packageJSON.private).toBe(true)

      const requested: Record<string, string> = {
        ...packageJSON.dependencies,
        ...packageJSON.devDependencies,
      }
      const unchosen = Object.keys(requested).filter(
        (name) => FLOATING_VERSION.test(requested[name]) || UNPINNED_GIT.test(requested[name])
      )
      expect(Object.keys(requested).length).toBeGreaterThan(0)
      expect(unchosen).toEqual([])
    })
  })
})
