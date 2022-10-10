import {
  FileType,
  InMemoryFileRecord,
  ProjectPluginStructure,
  ProjectStrategy,
  ProjectUIDL,
  UIDLElementNode,
  UIDLElementNodeInlineReferencedStyle,
} from '@teleporthq/teleport-types'
import { element, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import ProjectTemplate from '../src/project-template'
import { pluginImageResolver } from '../src/plugin-image-resolution'
import { htmlErrorPageMapping } from '../src/error-page-mapping'
import { createHTMLProjectGenerator } from '../src'
import fallbackUidlSample from '../../../examples/uidl-samples/project.json'
import uidlWithCompStyleOverrides from '../../../examples/test-samples/comp-style-overrides.json'

describe('Passes the rootClass which using the component', () => {
  it('run without crashing while using with HTML', async () => {
    const generator = createHTMLProjectGenerator()
    const result = await generator.generateProject(uidlWithCompStyleOverrides)

    const mainFile = result.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.HTML
    )
    const styleFile = result.files.find(
      (file) => file.name === 'landing-page' && file.fileType === FileType.CSS
    )

    expect(mainFile).toBeDefined()
    expect(mainFile.content).toContain(`place-card-root-class-name`)
    expect(styleFile.content).toContain(`place-card-root-class-name`)
  })
})

describe('Image Resolution project-plugin', () => {
  it('resolves all local assets to be refered from public folder', async () => {
    const files = new Map<string, InMemoryFileRecord>()
    const projectUIDL: ProjectUIDL = {
      name: 'teleport-html',
      globals: {
        settings: {
          title: 'teleport-html',
          language: 'en',
        },
        assets: [],
        meta: [],
      },
      root: {
        name: 'root',
        styleSetDefinitions: {
          bgImage: {
            type: 'reusable-project-style-map',
            content: {
              backgroundImage: staticNode('url("/playground_assets/kitten.png")'),
            },
          },
        },
        node: {
          type: 'element',
          content: element('div', {}, [
            elementNode('image', { src: staticNode('/playground_assets/kitten.png') }),
            elementNode('div', {}, [], null, {
              backgroundImage: staticNode('url("/playground_assets/kitten.png")'),
            }),
            {
              type: 'element',
              content: {
                semanticType: 'Home',
                ...element('component', { image: staticNode('/playground_assets/kitten.png') }),
              },
            },
          ]),
        },
      },
      components: {
        Home: {
          name: 'Home',
          styleSetDefinitions: {
            bgImageC: {
              type: 'reusable-project-style-map',
              content: {
                backgroundImage: staticNode('url("/playground_assets/kitten.png")'),
              },
            },
          },
          propDefinitions: {
            image: {
              type: 'string',
              defaultValue: '/playground_assets/kitten.png',
            },
          },
          node: elementNode('div', {}, [], { type: 'local' }, {}, null, {
            primaryButton: {
              type: 'style-map',
              content: {
                mapType: 'inlined',
                conditions: [{ maxWidth: 991, conditionType: 'screen-size' }],
                styles: {
                  backgroundImage: staticNode('url("/playground_assets/kitten.png")'),
                },
              },
            },
          }),
        },
      },
    }

    const structrue: ProjectPluginStructure = {
      uidl: projectUIDL,
      files,
      dependencies: {},
      template: ProjectTemplate,
      strategy: {
        id: 'teleport-project-html',
        pages: {
          path: ['src', 'pages'],
        },
        components: {
          path: ['src', 'components'],
        },
        static: {
          prefix: 'public',
          path: ['public'],
        },
      } as ProjectStrategy,
      devDependencies: {},
      rootFolder: UIDLUtils.cloneObject(ProjectTemplate),
    }

    const result = await pluginImageResolver.runBefore(structrue)
    const { uidl } = result
    const rootNode = uidl.root.node.content

    /* Using assets on dom nodes like image tags */
    /* Code generators take care of adding  */
    expect((rootNode.children[0] as UIDLElementNode).content.attrs?.src?.content).toBe(
      '/playground_assets/kitten.png'
    )
    /* Using assets in style sheets */
    expect((rootNode.children[1] as UIDLElementNode).content.style?.backgroundImage?.content).toBe(
      'url("/playground_assets/kitten.png")'
    )
    /* Using attrs while passing as a prop for a component call */
    expect((rootNode.children[2] as UIDLElementNode).content.attrs.image?.content).toBe(
      'public/playground_assets/kitten.png'
    )
    /* Using assets as defaultProp for component definition */
    expect(uidl.components.Home.propDefinitions.image.defaultValue).toBe(
      'public/playground_assets/kitten.png'
    )
    /* Using assets in global styleSetDefinitions */
    expect(uidl.root.styleSetDefinitions.bgImage.content.backgroundImage.content).toBe(
      'url("public/playground_assets/kitten.png")'
    )
    /* Using assets for component scoped styles */
    expect(uidl.components.Home.styleSetDefinitions.bgImageC.content.backgroundImage.content).toBe(
      'url("public/playground_assets/kitten.png")'
    )
    /* Using assets for media queries */
    expect(
      (
        uidl.components.Home.node.content.referencedStyles
          .primaryButton as UIDLElementNodeInlineReferencedStyle
      ).content?.styles.backgroundImage.content
    ).toBe('url("../../public/playground_assets/kitten.png")')
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(htmlErrorPageMapping)
    const { files } = await generator.generateProject(fallbackUidlSample, ProjectTemplate)
    const fallbackPage = files.find((file) => file.name === '404')

    expect(fallbackPage).toBeDefined()
  })
})
