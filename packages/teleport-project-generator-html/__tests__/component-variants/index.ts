import {
  FileType,
  ProjectUIDL,
  UIDLConditionalNode,
  UIDLElementNode,
  UIDLElementNodeProjectReferencedStyle,
} from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/component-variants.json'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../../src'
import HTMLTemplate from '../../src/project-template'

/**
 * A button component with four looks: `btn` always, plus `btn-<look>` while
 * the `buttonType` prop (default "primary") names it, and `btn-full` while the
 * boolean `fullWidth` prop is true. The HTML export has no runtime props, so
 * every placed instance must leave the build with its own static class list.
 */
const homePage = async (uidl: ProjectUIDL): Promise<string> => {
  const generator = createHTMLProjectGenerator()
  generator.addPlugin(pluginHomeReplace)
  generator.addPlugin(pluginCloneGlobals)
  const { files } = await generator.generateProject(uidl, HTMLTemplate)
  return (
    files.find((file) => file.name === 'index' && file.fileType === FileType.HTML)?.content ?? ''
  )
}

const buttonsByLabel = async (uidl: ProjectUIDL): Promise<Record<string, string>> => {
  const page = await homePage(uidl)
  const button = /<button\b[^>]*>\s*<span>([^<]*)<\/span>([\s\S]*?)<\/button>/g
  const contents: Record<string, string> = {}
  for (let match = button.exec(page); match; match = button.exec(page)) {
    contents[match[1]] = match[2]
  }
  return contents
}

const classesByLabel = async (uidl: ProjectUIDL): Promise<Record<string, string>> => {
  const page = await homePage(uidl)
  const button = /<button\s+class="([^"]*)"[^>]*>\s*<span>([^<]*)<\/span>/g
  const classes: Record<string, string> = {}
  for (let match = button.exec(page); match; match = button.exec(page)) {
    classes[match[2]] = match[1].replace(/\s+/g, ' ')
  }
  return classes
}

const fixture = () => JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL

const homeOf = (uidl: ProjectUIDL) => {
  const home = (uidl.root.node.content.children[0] as UIDLConditionalNode).content.node
  if (home.type !== 'element') {
    throw new Error('fixture drifted: Home is not an element')
  }
  return home
}

const placeButton = (uidl: ProjectUIDL, key: string, attrs: Record<string, unknown>) =>
  homeOf(uidl).content.children.push({
    type: 'element',
    content: {
      elementType: 'ActionButton',
      semanticType: 'ActionButton',
      key,
      name: key,
      dependency: { type: 'local' },
      attrs: Object.fromEntries(
        Object.entries(attrs).map(([name, content]) => [name, { type: 'static', content }])
      ),
      children: [],
    },
  } as UIDLElementNode)

const classWhen = (
  referenceId: string,
  propId: string,
  operands: string[]
): UIDLElementNodeProjectReferencedStyle => ({
  type: 'style-map',
  content: {
    mapType: 'project-referenced',
    referenceId,
    condition: {
      reference: { type: 'dynamic', content: { referenceType: 'prop', id: propId } },
      expression: { conditions: operands.map((operand) => ({ operation: '===', operand })) },
    },
  },
})

describe('Component variants in the HTML export', () => {
  it('resolves every instance to the base class and exactly its own look', async () => {
    expect(await classesByLabel(fixture())).toEqual({
      Primary: 'btn btn-primary',
      Secondary: 'btn btn-secondary',
      Outline: 'btn btn-outline',
      Link: 'btn btn-link',
      Unset: 'btn btn-primary',
      'Full width': 'btn btn-outline btn-full',
      'Not full width': 'btn btn-primary',
    })
  })

  it('builds a look without a default, a look holding quotes, and dangling conditions', async () => {
    const uidl = fixture()
    const actionButton = uidl.components.ActionButton
    delete actionButton.propDefinitions.buttonType.defaultValue
    const { referencedStyles } = actionButton.node.content
    referencedStyles.quoted = classWhen('btn-full', 'buttonType', ['say "hi"'])
    referencedStyles.deletedProp = classWhen('btn-link', 'removedProp', ['x'])
    referencedStyles.noRule = classWhen('btn-secondary', 'buttonType', [])
    placeButton(uidl, 'quotedButton', { buttonType: 'say "hi"', label: 'Quoted' })

    expect(await classesByLabel(uidl)).toEqual({
      Primary: 'btn btn-primary',
      Secondary: 'btn btn-secondary',
      Outline: 'btn btn-outline',
      Link: 'btn btn-link',
      Unset: 'btn',
      'Full width': 'btn btn-outline btn-full',
      'Not full width': 'btn',
      Quoted: 'btn btn-full',
    })
  })

  it('shows an element bound to a number prop whose rule stores the number as text', async () => {
    const uidl = fixture()
    const actionButton = uidl.components.ActionButton
    actionButton.propDefinitions.count = { type: 'number', defaultValue: 0 }
    actionButton.node.content.children.push({
      type: 'conditional',
      content: {
        reference: { type: 'dynamic', content: { referenceType: 'prop', id: 'count' } },
        condition: { conditions: [{ operation: '===', operand: '2' }] },
        node: {
          type: 'element',
          content: {
            elementType: 'text',
            key: 'two-badge',
            children: [{ type: 'static', content: 'Two' }],
          },
        },
      },
    } as UIDLConditionalNode)
    placeButton(uidl, 'countTwoButton', { count: 2, label: 'Count two' })
    placeButton(uidl, 'countThreeButton', { count: 3, label: 'Count three' })

    const buttons = await buttonsByLabel(uidl)
    expect(buttons['Count two']).toContain('Two')
    expect(buttons['Count three']).not.toContain('Two')
    expect(buttons.Primary).not.toContain('Two')
  })

  it('applies a class on a number prop whose default and rule both store the number as text', async () => {
    const uidl = fixture()
    uidl.root.styleSetDefinitions['btn-size-two'] = uidl.root.styleSetDefinitions['btn-full']
    const actionButton = uidl.components.ActionButton
    actionButton.propDefinitions.size = { type: 'number', defaultValue: '2' }
    actionButton.node.content.referencedStyles.sizeTwo = classWhen('btn-size-two', 'size', ['2'])
    placeButton(uidl, 'sizeThreeButton', { size: 3, label: 'Size three' })
    placeButton(uidl, 'sizeTwoTextButton', { size: '2', label: 'Size two as text' })

    const classes = await classesByLabel(uidl)
    expect(classes.Primary).toBe('btn btn-primary btn-size-two')
    expect(classes['Size two as text']).toBe('btn btn-primary btn-size-two')
    expect(classes['Size three']).toBe('btn btn-primary')
  })
})
