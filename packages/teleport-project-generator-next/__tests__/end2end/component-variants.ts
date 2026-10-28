import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as types from '@babel/types'
import {
  GeneratedFolder,
  ProjectUIDL,
  UIDLConditionalNode,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/uidl-samples/component-variants.json'
import template from './template-definition.json'
import { createNextProjectGenerator } from '../../src'

/**
 * A button component with four looks: `btn` always, plus `btn-<look>` while
 * the `buttonType` prop (default "primary") names it, and `btn-full` while the
 * boolean `fullWidth` prop is true. The Next.js export decides at runtime, so
 * the test reads the generated component's `className` and `defaultProps`,
 * then evaluates the class list each placed instance renders with.
 */
const nodesOfType = <T extends types.Node>(root: types.Node, type: T['type']): T[] => {
  const found: T[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object' || typeof (value as types.Node).type !== 'string') {
      return
    }
    if ((value as types.Node).type === type) {
      found.push(value as T)
    }
    Object.entries(value).forEach(([key, child]) => {
      if (key !== 'loc' && !key.endsWith('Comments')) {
        visit(child)
      }
    })
  }
  visit(root)
  return found
}

// tslint:disable-next-line function-constructor
const evaluate = (code: string, props: Record<string, unknown> = {}) =>
  new Function('props', `return (${code})`)(props)

const sourceOf = (folder: GeneratedFolder, folderName: string, fileName: string) => {
  const file = folder.subFolders
    .find((subFolder) => subFolder.name === folderName)
    ?.files.find((candidate) => candidate.name === fileName && candidate.fileType === 'js')
  if (!file) {
    throw new Error(`${folderName}/${fileName}.js was not generated`)
  }
  return parse(file.content, { sourceType: 'module', plugins: ['jsx'] })
}

const classesByLabel = async (uidl: ProjectUIDL): Promise<Record<string, string>> => {
  const output = await createNextProjectGenerator().generateProject(uidl, template)
  const component = sourceOf(output, 'components', 'action-button')
  const page = sourceOf(output, 'pages', 'index')

  const className = nodesOfType<types.JSXAttribute>(component, 'JSXAttribute').find(
    (attribute) => attribute.name.name === 'className'
  )
  const classExpression = generate(
    (className.value as types.JSXExpressionContainer).expression as types.Expression
  ).code
  const defaultProps = nodesOfType<types.AssignmentExpression>(
    component,
    'AssignmentExpression'
  ).find((assignment) => generate(assignment.left).code === 'ActionButton.defaultProps')
  const defaults = evaluate(generate(defaultProps.right).code)

  const instances = nodesOfType<types.JSXOpeningElement>(page, 'JSXOpeningElement').filter(
    (element) => generate(element.name).code === 'ActionButton'
  )
  return Object.fromEntries(
    instances.map((instance) => {
      const props: Record<string, unknown> = { ...defaults }
      instance.attributes.forEach((attribute) => {
        if (attribute.type !== 'JSXAttribute') {
          return
        }
        const { value } = attribute
        props[String(attribute.name.name)] =
          value === null
            ? true
            : value.type === 'StringLiteral'
            ? value.value
            : evaluate(generate((value as types.JSXExpressionContainer).expression).code)
      })
      const classes = String(evaluate(classExpression, props)).split(/\s+/).filter(Boolean)
      return [String(props.label), classes.join(' ')]
    })
  )
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

const classWhen = (referenceId: string, propId: string, operands: string[]) => ({
  type: 'style-map' as const,
  content: {
    mapType: 'project-referenced' as const,
    referenceId,
    condition: {
      reference: {
        type: 'dynamic' as const,
        content: { referenceType: 'prop' as const, id: propId },
      },
      expression: { conditions: operands.map((operand) => ({ operation: '===', operand })) },
    },
  },
})

describe('Component variants in the Next.js export', () => {
  it('renders every instance with the base class and exactly its own look', async () => {
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

  it('still generates, with the class left off, when a class condition is dangling', async () => {
    const uidl = fixture()
    const button = uidl.components.ActionButton.node.content
    const dangling = (referenceId: string, propId: string, operands: string[]) => ({
      type: 'style-map' as const,
      content: {
        mapType: 'project-referenced' as const,
        referenceId,
        condition: {
          reference: {
            type: 'dynamic' as const,
            content: { referenceType: 'prop' as const, id: propId },
          },
          expression: { conditions: operands.map((operand) => ({ operation: '===', operand })) },
        },
      },
    })
    button.referencedStyles.deletedProp = dangling('btn-link', 'removedProp', ['x'])
    button.referencedStyles.noRule = dangling('btn-full', 'buttonType', [])

    const classes = await classesByLabel(uidl)

    expect(classes.Outline).toBe('btn btn-outline')
    expect(classes['Full width']).toBe('btn btn-outline btn-full')
    expect(classes.Unset).toBe('btn btn-primary')
  })

  it('applies a class on a number prop whose default and rule both store the number as text', async () => {
    const uidl = fixture()
    uidl.root.styleSetDefinitions['btn-size-two'] = uidl.root.styleSetDefinitions['btn-full']
    const actionButton = uidl.components.ActionButton
    actionButton.propDefinitions.size = { type: 'number', defaultValue: '2' }
    actionButton.node.content.referencedStyles.sizeTwo = classWhen('btn-size-two', 'size', ['2'])
    placeButton(uidl, 'sizeThreeButton', { size: 3, label: 'Size three' })

    const classes = await classesByLabel(uidl)
    expect(classes.Primary).toBe('btn btn-primary btn-size-two')
    expect(classes['Size three']).toBe('btn btn-primary')
  })
})
