import * as fs from 'fs'
import * as path from 'path'
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import projectTemplate from '../src/project-template'
import { NextProjectMapping } from '../src/next-project-mapping'
import { NextRichTextEditorProjectPlugin } from '../src/rich-text-editor/project-plugin'

/*
  Dependency ranges written into every exported package.json. The ranges are
  the security floor: a revert to the old values reopens published advisories
  (katex < 0.18.2 prototype pollution, nodemailer <= 10.1.3 address-parser DoS /
  header injection) and an unpinned `latest` lets a compromised release flow
  straight into every new install.
*/
describe('generated package.json dependency versions', () => {
  const template = JSON.parse(
    projectTemplate.files.find((file) => file.name === 'package')!.content
  )

  it('pins @teleporthq/react-components in the template instead of "latest"', () => {
    expect(template.dependencies['@teleporthq/react-components']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('never maps a component to an unpinned @teleporthq/react-components', () => {
    const versions = Object.values(NextProjectMapping.elements || {})
      .map((element: any) => element.dependency)
      .filter((dep: any) => dep && dep.path === '@teleporthq/react-components')
      .map((dep: any) => dep.version)

    expect(versions.length).toBeGreaterThan(0)
    versions.forEach((version) =>
      expect(version).toBe(template.dependencies['@teleporthq/react-components'])
    )
  })

  it('asks for a katex release past the prototype-pollution advisory', async () => {
    const files = new Map()
    files.set('_app', {
      path: ['pages'],
      files: [
        {
          name: '_app',
          fileType: FileType.JS,
          content: 'const A = () => null\nexport default A\n',
        },
      ],
    })
    const structure = (await new NextRichTextEditorProjectPlugin().runAfter({
      uidl: {
        name: 'p',
        globals: { settings: { title: 't', language: 'en' }, assets: [] },
        root: { node: { type: 'element', content: { elementType: 'container', children: [] } } },
        components: {
          c: {
            node: {
              type: 'element',
              content: {
                elementType: 'container',
                children: [
                  {
                    type: 'element',
                    content: {
                      elementType: 'RichTextEditor',
                      semanticType: 'rich-text-editor-node',
                      children: [],
                      attrs: {
                        quillTheme: { type: 'static', content: 'snow' },
                        quillFormats: { type: 'raw', content: JSON.stringify(['bold', 'formula']) },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      files,
      dependencies: {},
      devDependencies: {},
      template: { files: [], subFolders: [] },
    } as unknown as ProjectPluginStructure)) as ProjectPluginStructure

    expect(structure.dependencies.katex).toBe('^0.19.1')
  })

  it('declares a Node engine floor that nodemailer 10 can run on', () => {
    expect(template.engines.node).toBe('>=20.x')
  })

  it('asks for a nodemailer release past the address-parser / header advisories', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/ecommerce/project-plugin.ts'),
      'utf8'
    )
    expect(source).toContain("dependencies.nodemailer = '^10.2.1'")
  })
})
