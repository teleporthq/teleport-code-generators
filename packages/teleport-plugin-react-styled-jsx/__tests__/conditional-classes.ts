import generate from '@babel/generator'
import * as types from '@babel/types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkType,
  ComponentStructure,
  FileType,
  UIDLConditionExpressionEntry,
  UIDLPropDefinition,
  UIDLReferencedStyles,
} from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src'

/**
 * The component-variant recipe as the Next.js export writes it: one element
 * with a base class and modifier classes, each applied while a prop matches.
 * The generated `className` is evaluated against the props an instance ends
 * up with, so each case asserts the classes a visitor's browser would see.
 */
const projectClass = { type: 'reusable-project-style-map' as const, content: {} }
const styleSetDefinitions = Object.fromEntries(
  ['btn', 'btn-primary', 'btn-secondary', 'btn-outline', 'btn-link', 'btn-full', 'btn-x'].map(
    (name) => [name, projectClass]
  )
)

const classWhen = (
  referenceId: string,
  propId: string,
  conditions: UIDLConditionExpressionEntry[],
  matchingCriteria?: string
) => ({
  type: 'style-map' as const,
  content: {
    mapType: 'project-referenced' as const,
    referenceId,
    condition: {
      reference: {
        type: 'dynamic' as const,
        content: { referenceType: 'prop' as const, id: propId },
      },
      expression: { conditions, ...(matchingCriteria ? { matchingCriteria } : {}) },
    },
  },
})

const fourLooks: UIDLReferencedStyles = {
  base: { type: 'style-map', content: { mapType: 'project-referenced', referenceId: 'btn' } },
  ...Object.fromEntries(
    ['primary', 'secondary', 'outline', 'link'].map((look) => [
      look,
      classWhen(`btn-${look}`, 'buttonType', [{ operation: '===', operand: look }]),
    ])
  ),
}

const generateClassName = async (
  referencedStyles: UIDLReferencedStyles,
  propDefinitions: Record<string, UIDLPropDefinition>
) => {
  const button = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('button'), []),
    types.jsxClosingElement(types.jsxIdentifier('button')),
    []
  )
  const uidl = component(
    'ActionButton',
    elementNode('button', {}, [], null, null, null, referencedStyles),
    propDefinitions
  )
  uidl.node.content.key = 'button'
  const structure: ComponentStructure = {
    uidl,
    chunks: [
      {
        name: 'jsx-component',
        type: ChunkType.AST,
        fileType: FileType.JS,
        linkAfter: [],
        content: {},
        meta: { nodesLookup: { button }, dynamicRefPrefix: { prop: 'props' } },
      },
    ],
    dependencies: {},
    options: { projectStyleSet: { styleSetDefinitions, fileName: '', path: '' } },
  }

  await createReactStyledJSXPlugin()(structure)

  const classAttribute = button.openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === 'className'
  ) as types.JSXAttribute
  const value = classAttribute.value
  const code = generate(value.type === 'JSXExpressionContainer' ? value.expression : value).code
  const classesFor = (props: Record<string, unknown>): string[] =>
    // tslint:disable-next-line function-constructor
    String(new Function('props', `return ${code}`)(props))
      .split(/\s+/)
      .filter(Boolean)
      .sort()
  return { code, classesFor }
}

describe('Conditional project classes on a prop (Next.js export)', () => {
  const buttonType: UIDLPropDefinition = { type: 'string', defaultValue: 'primary' }

  it('gives each look exactly its own modifier next to the base class', async () => {
    const { classesFor } = await generateClassName(fourLooks, { buttonType })

    expect(classesFor({ buttonType: 'primary' })).toEqual(['btn', 'btn-primary'])
    expect(classesFor({ buttonType: 'secondary' })).toEqual(['btn', 'btn-secondary'])
    expect(classesFor({ buttonType: 'outline' })).toEqual(['btn', 'btn-outline'])
    expect(classesFor({ buttonType: 'link' })).toEqual(['btn', 'btn-link'])
  })

  it('switches a boolean variant on true and off on false', async () => {
    const { classesFor } = await generateClassName(
      { full: classWhen('btn-full', 'fullWidth', [{ operation: '===', operand: true }]) },
      { fullWidth: { type: 'boolean', defaultValue: false } }
    )

    expect(classesFor({ fullWidth: true })).toEqual(['btn-full'])
    expect(classesFor({ fullWidth: false })).toEqual([])
  })

  it('applies a class when ANY rule matches under matchingCriteria "one"', async () => {
    const { classesFor } = await generateClassName(
      {
        x: classWhen(
          'btn-x',
          'buttonType',
          [
            { operation: '===', operand: 'secondary' },
            { operation: '===', operand: 'outline' },
          ],
          'one'
        ),
      },
      { buttonType }
    )

    expect(classesFor({ buttonType: 'secondary' })).toEqual(['btn-x'])
    expect(classesFor({ buttonType: 'outline' })).toEqual(['btn-x'])
    expect(classesFor({ buttonType: 'primary' })).toEqual([])
  })

  it('applies a class only when EVERY rule matches under matchingCriteria "all"', async () => {
    const { classesFor } = await generateClassName(
      {
        x: classWhen(
          'btn-x',
          'size',
          [
            { operation: '>=', operand: 2 },
            { operation: '<=', operand: 4 },
          ],
          'all'
        ),
      },
      { size: { type: 'number', defaultValue: 3 } }
    )

    expect(classesFor({ size: 3 })).toEqual(['btn-x'])
    expect(classesFor({ size: 9 })).toEqual([])
    expect(classesFor({ size: 1 })).toEqual([])
  })

  it('compares a number prop with a number when the rule stores the value as text', async () => {
    const { code, classesFor } = await generateClassName(
      { x: classWhen('btn-x', 'size', [{ operation: '===', operand: '2' }]) },
      { size: { type: 'number', defaultValue: 2 } }
    )

    expect(code).toContain('props?.size === 2')
    expect(classesFor({ size: 2 })).toEqual(['btn-x'])
    expect(classesFor({ size: 5 })).toEqual([])
  })

  it('leaves the class off, without failing, when its condition reads a deleted prop', async () => {
    const { code, classesFor } = await generateClassName(
      {
        ...fourLooks,
        x: classWhen('btn-x', 'removedProp', [{ operation: '===', operand: 'x' }]),
      },
      { buttonType }
    )

    expect(code).not.toContain('btn-x')
    expect(classesFor({ buttonType: 'outline' })).toEqual(['btn', 'btn-outline'])
  })

  it('leaves the class off, without failing, when its condition has no rule', async () => {
    const { code, classesFor } = await generateClassName(
      { ...fourLooks, x: classWhen('btn-x', 'buttonType', []) },
      { buttonType }
    )

    expect(code).not.toContain('btn-x')
    expect(classesFor({ buttonType: 'link' })).toEqual(['btn', 'btn-link'])
  })
})
