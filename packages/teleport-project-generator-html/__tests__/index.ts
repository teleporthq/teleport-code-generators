import {
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
import { pluginImageResolution } from '../src/plugin-image-resolution'

describe('Image Resolution project-plugin', () => {
  const files = new Map<string, InMemoryFileRecord>()
  it('resolves all local assets to be refered from public folder', async () => {
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
          path: ['public'],
        },
      } as ProjectStrategy,
      devDependencies: {},
      rootFolder: UIDLUtils.cloneObject(ProjectTemplate),
    }

    const result = await pluginImageResolution.runBefore(structrue)
    const { uidl } = result
    const rootNode = uidl.root.node.content

    /* Using assets on dom nodes like image tags */
    expect((rootNode.children[0] as UIDLElementNode).content.attrs?.src?.content).toBe(
      '../../public/playground_assets/kitten.png'
    )
    /* Using assets in style sheets */
    expect((rootNode.children[1] as UIDLElementNode).content.style?.backgroundImage?.content).toBe(
      'url("../../public/playground_assets/kitten.png")'
    )
    /* Using attrs while passing as a prop for a component call */
    expect((rootNode.children[2] as UIDLElementNode).content.attrs.image?.content).toBe(
      '../../public/playground_assets/kitten.png'
    )
    /* Using assets as defaultProp for component definition */
    expect(uidl.components.Home.propDefinitions.image.defaultValue).toBe(
      '../../public/playground_assets/kitten.png'
    )
    /* Using assets in global styleSetDefinitions */
    expect(uidl.root.styleSetDefinitions.bgImage.content.backgroundImage.content).toBe(
      'url("../../public/playground_assets/kitten.png")'
    )
    /* Using assets for component scoped styles */
    expect(uidl.components.Home.styleSetDefinitions.bgImageC.content.backgroundImage.content).toBe(
      'url("../../public/playground_assets/kitten.png")'
    )
    /* Using assets for media queries */
    expect(
      (
        uidl.components.Home.node.content.referencedStyles
          .primaryButton as UIDLElementNodeInlineReferencedStyle
      ).content?.styles.backgroundImage.content
    ).toBe('url("../../public/playground_assets/kitten.png")')
  })
})
