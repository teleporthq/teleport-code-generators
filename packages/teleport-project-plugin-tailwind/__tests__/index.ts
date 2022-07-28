import {
  FileType,
  InMemoryFileRecord,
  ProjectPluginStructure,
  ProjectStrategy,
  ProjectType,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import { ProjectPluginTailwind } from '../src'
import projectUIDL from '../../../examples/test-samples/project-sample.json'
import { NextTemplate } from '@teleporthq/teleport-project-generator-next'

describe('Plugins adds tailwind as devDependnecy when used with Next', () => {
  const structure: ProjectPluginStructure = {
    files: new Map<string, InMemoryFileRecord>(),
    uidl: projectUIDL as unknown as ProjectUIDL,
    dependencies: {},
    devDependencies: {},
    template: NextTemplate,
    strategy: {} as ProjectStrategy,
    rootFolder: { name: 'root', files: [], subFolders: [] },
  }

  it('Adds deps and changes config, when project has missing project-style sheet', async () => {
    structure.files.set('_app', {
      files: [
        {
          name: '_app',
          fileType: FileType.JS,
          content: ``,
        },
      ],
      path: [''],
    })
    const plugin = new ProjectPluginTailwind({
      framework: ProjectType.NEXT,
    })
    const { files } = await plugin.runAfter(structure)
    const appFile = files.get('_app').files[0]

    expect(appFile).toBeDefined()
    expect(appFile.content).toContain(`import "./global.css"`)
    expect(files.size).toBe(3)
    expect(files.get('tailwindGlobal')).toBeDefined()
    expect(files.get('tailwindConfig')).toBeDefined()
  })

  it('Adds deps and changes config, when the project styles are present', async () => {
    structure.files.delete('_app')
    structure.files.set('projectStyleSheet', {
      files: [
        {
          name: 'style',
          fileType: FileType.CSS,
          content: ``,
        },
      ],
      path: [''],
    })

    const plugin = new ProjectPluginTailwind({
      framework: ProjectType.NEXT,
    })
    const { files } = await plugin.runAfter(structure)

    const styleFile = files.get('projectStyleSheet')
    expect(styleFile).toBeDefined()
    expect(files.size).toBe(3)
  })
})
