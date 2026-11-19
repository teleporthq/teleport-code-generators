import { createReactStyledJSXPlugin } from '../src'
import { staticNode, elementNode, component } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createComponentChunk } from './mocks'

/*
  styled-jsx stamps its scope hash on host DOM elements only. A component the
  generator ships itself (a `Tq…` widget, the rich text editor) hands the
  className it is given to its own root element, where a scoped rule can never
  match: the page asked for `min-height: 220px` on an editor and the editor
  stayed one line tall. Their rules leave as `:global(...)`.
*/
describe('classes of the components the generator ships', () => {
  /** Every template text of the generated chunk: the page's style sheet among them. */
  const templateTexts = (content: unknown): string => {
    const texts: string[] = []
    JSON.stringify(content, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.raw === 'string') {
        texts.push(value.raw)
      }
      return value
    })
    return texts.join('\n')
  }

  const stylesOf = async (elementType: string, dependencyType: 'local' | 'package') => {
    const node = elementNode('container', {}, [], undefined, { minHeight: staticNode('220px') })
    // As the resolver leaves a mapped element: its component's name and where it is imported from.
    node.content.elementType = elementType
    node.content.dependency =
      dependencyType === 'local'
        ? { type: 'local', path: '../components/shipped' }
        : { type: 'package', path: 'shipped', version: '1.0.0' }
    const uidl = component('NewTopic', node, {}, {})
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks } = await createReactStyledJSXPlugin()(structure)
    return templateTexts(chunks[0].content)
  }

  it.each(['RichTextEditor', 'TqDragArea'])('emits the rule of a %s as global', async (type) => {
    const styles = await stylesOf(type, 'local')
    expect(styles).toContain(':global(.container)')
    expect(styles).toContain('min-height: 220px')
  })

  it('keeps the rule of a project component, a host element and a package scoped', async () => {
    expect(await stylesOf('ForumReply', 'local')).not.toContain(':global(')
    expect(await stylesOf('RichTextEditorToolbar', 'local')).not.toContain(':global(')
    expect(await stylesOf('RichTextEditor', 'package')).not.toContain(':global(')
  })
})
