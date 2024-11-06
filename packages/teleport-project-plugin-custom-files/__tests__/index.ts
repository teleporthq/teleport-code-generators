import {
  ProjectPluginStructure,
  InMemoryFileRecord,
  ProjectStrategy,
} from '@teleporthq/teleport-types'
import { component, elementNode, project } from '@teleporthq/teleport-uidl-builders'
import { ProjectPluginCustomFiles } from '../src'
import {
  createNextProjectGenerator,
  NextProjectMapping,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import projectUIDL from '../../../examples/uidl-samples/tests.json'

describe('Plugin to add custom files at the end of project generation', () => {
  const customFiles = [
    {
      name: 'config',
      fileType: 'json',
      content: `{ name: 'teleportHQ' }`,
      path: [''],
    },
    {
      name: 'package',
      fileType: 'json',
      content: `{ name: 'teleportHQ' }`,
      path: [''],
    },
    {
      name: 'component',
      fileType: 'js',
      path: ['pages', 'custom-folder'],
      content: `const Welcome = () => {
    return <div>Welcome component</div>
}

export default Welcome`,
    },
  ]

  it('adds files without crashing', async () => {
    const structure: ProjectPluginStructure = {
      files: new Map<string, InMemoryFileRecord>(),
      uidl: project(
        'teleport-project-template',
        component(
          'Root',
          elementNode('Router', {}, []),
          { route: { type: 'string', defaultValue: 'Home' } },
          {}
        ),
        [component('Sample', elementNode('container'), {}, {})]
      ),
      dependencies: {},
      devDependencies: {},
      template: {
        name: 'teleport-project-template',
        files: [],
        subFolders: [],
      },
      strategy: {} as ProjectStrategy,
      rootFolder: { name: 'root', files: [], subFolders: [] },
    }

    const plugin = new ProjectPluginCustomFiles(customFiles)
    const { files } = await plugin.runAfter(structure)

    expect(files).toBeDefined()
    expect(files.get('').files.length).toBe(2)
    expect(files.get('pages-custom-folder').files.length).toBe(1)
  })

  it('adds files and merges them with the generated project', async () => {
    const generator = createNextProjectGenerator()
    generator.addMapping(NextProjectMapping)
    generator.addPlugin(new ProjectPluginCustomFiles(customFiles))

    const { files, subFolders } = await generator.generateProject(projectUIDL, NextTemplate)

    const pagesFolder = subFolders.find((file) => file.name === 'pages')
    const customFolder = pagesFolder.subFolders.find((file) => file.name === 'custom-folder')

    expect(files.length).toBe(3)
    expect(pagesFolder).toBeDefined()
    expect(customFolder).toBeDefined()
    expect(customFolder.files.length).toBe(1)
    expect(customFolder.files[0]?.name).toBe('component')
  })
})
