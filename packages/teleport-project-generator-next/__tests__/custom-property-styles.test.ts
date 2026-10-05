import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/** Slider arrows and bullets are styled through Swiper's CSS variables written as element styles. */
describe('custom-property element styles', () => {
  it('ships --swiper-* variables as written', async () => {
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    const indexPage = (uidl.root.node.content.children || []).find(
      (child) =>
        child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
    )
    const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
      .content.node.content
    pageElement.children.push({
      type: 'element',
      content: {
        elementType: 'container',
        attrs: { 'data-thq': { type: 'static', content: 'slider-button-next' } },
        style: {
          '--swiper-navigation-color': { type: 'static', content: '#ff0000' },
          '--swiper-navigation-size': { type: 'static', content: '24px' },
        },
        children: [],
      },
    })
    const output = await createNextProjectGenerator().generateProject(uidl, template)
    const page = output.subFolders
      .find((s) => s.name === 'pages')
      ?.files.find((f) => f.name === 'index')
    expect(page?.content).toContain('--swiper-navigation-color: #ff0000')
    expect(page?.content).toContain('--swiper-navigation-size: 24px')
  })
})
