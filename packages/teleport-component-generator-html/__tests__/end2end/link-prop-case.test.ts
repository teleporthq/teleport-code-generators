import { ComponentUIDL, FileType } from '@teleporthq/teleport-types'
import { createHTMLComponentGenerator } from '../../src'

/*
  The parser camel-cases every prop key (`Redirect` -> `redirect`), so every
  reference to a prop has to be camel-cased with it. A link ability that is
  itself a dynamic prop reference used to keep its raw id, and the HTML export
  died with "Definition for Redirect is missing from { ..., redirect }".
*/
const uidlWithCapitalisedLinkProp = (): ComponentUIDL =>
  ({
    name: 'Card',
    propDefinitions: {
      Redirect: {
        type: 'link',
        defaultValue: { url: 'https://medium.com', newTab: true },
      },
    },
    node: {
      type: 'element',
      content: {
        elementType: 'container',
        abilities: {
          link: {
            type: 'dynamic',
            content: { referenceType: 'prop', id: 'Redirect' },
          },
        },
        children: [{ type: 'static', content: 'Read more' }],
      },
    },
  } as unknown as ComponentUIDL)

describe('HTML Component Generator - link ability bound to a capitalised prop', () => {
  it('generates the component instead of throwing on the prop key casing', async () => {
    const generator = createHTMLComponentGenerator()
    const { files } = await generator.generateComponent(uidlWithCapitalisedLinkProp())
    const htmlFile = files.find((file) => file.fileType === FileType.HTML)

    // Resolved as a link-type prop: the resolver found `redirect` and wrapped the node.
    expect(htmlFile?.content).toContain('<a data-thq-link-wrapper="true" class="card-prop-link">')
  })
})
