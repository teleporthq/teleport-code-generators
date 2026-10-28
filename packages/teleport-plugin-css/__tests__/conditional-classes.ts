import generate from '@babel/generator'
import * as types from '@babel/types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkType,
  ComponentStructure,
  FileType,
  HastNode,
  UIDLConditionExpressionEntry,
  UIDLPropDefinition,
  UIDLReferencedStyles,
} from '@teleporthq/teleport-types'
import { createCSSPlugin } from '../src'

/**
 * The component-variant recipe: one element with a base class and modifier
 * classes, each applied while a prop matches. The HTML export resolves every
 * instance at build time — the instance's value arrives as the prop's
 * defaultValue — and the JSX template (Next.js partials) decides at runtime.
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

const propReference = (id: string) => ({
  type: 'dynamic' as const,
  content: { referenceType: 'prop' as const, id },
})

const classWhenValue = (referenceId: string, propId: string, value: string) => ({
  type: 'style-map' as const,
  content: {
    mapType: 'project-referenced' as const,
    referenceId,
    condition: { reference: propReference(propId), value },
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
const anyOf = (propId: string, operands: unknown[]) =>
  classWhen(
    'btn-x',
    propId,
    operands.map((operand) => ({ operation: '===', operand } as UIDLConditionExpressionEntry)),
    'one'
  )
const between = (propId: string, low: number, high: number) =>
  classWhen(
    'btn-x',
    propId,
    [
      { operation: '>=', operand: low },
      { operation: '<=', operand: high },
    ],
    'all'
  )

const structureFor = (
  referencedStyles: UIDLReferencedStyles,
  propDefinitions: Record<string, UIDLPropDefinition>,
  button: HastNode | types.JSXElement
): ComponentStructure => {
  const uidl = component(
    'ActionButton',
    elementNode('button', {}, [], null, null, null, referencedStyles),
    propDefinitions
  )
  uidl.node.content.key = 'button'
  return {
    uidl,
    chunks: [
      {
        name: 'template',
        type: 'type' in button && button.type === 'JSXElement' ? ChunkType.AST : ChunkType.HAST,
        fileType: FileType.HTML,
        linkAfter: [],
        content: {},
        meta: { nodesLookup: { button }, dynamicRefPrefix: { prop: 'props' } },
      },
    ],
    dependencies: {},
    options: { projectStyleSet: { styleSetDefinitions, fileName: 'style', path: '' } },
  }
}

/** The classes one instance gets in the HTML export. */
const htmlClasses = async (
  referencedStyles: UIDLReferencedStyles,
  propDefinitions: Record<string, UIDLPropDefinition>
): Promise<string[]> => {
  const button: HastNode = { type: 'element', tagName: 'button', properties: {}, children: [] }
  await createCSSPlugin({
    templateChunkName: 'template',
    templateStyle: 'html',
    staticPropReferences: true,
  })(structureFor(referencedStyles, propDefinitions, button))
  return String(button.properties.class ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
}

const instanceOf = (definition: UIDLPropDefinition, value: unknown) => ({
  ...definition,
  defaultValue: value as UIDLPropDefinition['defaultValue'],
})

/** The runtime className expression of the JSX template. */
const jsxClassName = async (
  referencedStyles: UIDLReferencedStyles,
  propDefinitions: Record<string, UIDLPropDefinition>
) => {
  const button = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('button'), []),
    types.jsxClosingElement(types.jsxIdentifier('button')),
    []
  )
  await createCSSPlugin({
    templateChunkName: 'template',
    templateStyle: 'jsx',
    classAttributeName: 'className',
  })(structureFor(referencedStyles, propDefinitions, button))
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

describe('Conditional project classes on a prop, HTML export', () => {
  const buttonType: UIDLPropDefinition = { type: 'string', defaultValue: 'primary' }
  const size: UIDLPropDefinition = { type: 'number', defaultValue: 3 }

  it('resolves each look to exactly its own modifier next to the base class', async () => {
    for (const look of ['primary', 'secondary', 'outline', 'link']) {
      expect(await htmlClasses(fourLooks, { buttonType: instanceOf(buttonType, look) })).toEqual([
        'btn',
        `btn-${look}`,
      ])
    }
  })

  it('switches a boolean variant on true and off on false', async () => {
    const full = { full: classWhen('btn-full', 'fullWidth', [{ operation: '===', operand: true }]) }
    const fullWidth: UIDLPropDefinition = { type: 'boolean', defaultValue: false }

    expect(await htmlClasses(full, { fullWidth: instanceOf(fullWidth, true) })).toEqual([
      'btn-full',
    ])
    expect(await htmlClasses(full, { fullWidth })).toEqual([])
  })

  it('applies a class when ANY rule matches under matchingCriteria "one"', async () => {
    const x = { x: anyOf('buttonType', ['secondary', 'outline']) }

    expect(await htmlClasses(x, { buttonType: instanceOf(buttonType, 'outline') })).toEqual([
      'btn-x',
    ])
    expect(await htmlClasses(x, { buttonType: instanceOf(buttonType, 'secondary') })).toEqual([
      'btn-x',
    ])
    expect(await htmlClasses(x, { buttonType })).toEqual([])
  })

  it('applies a class only when EVERY rule matches under matchingCriteria "all"', async () => {
    const x = { x: between('size', 2, 4) }

    expect(await htmlClasses(x, { size })).toEqual(['btn-x'])
    expect(await htmlClasses(x, { size: instanceOf(size, 9) })).toEqual([])
  })

  it('leaves every modifier off for an unset instance of a prop without a default', async () => {
    const noDefault: UIDLPropDefinition = { type: 'string' }

    expect(await htmlClasses(fourLooks, { buttonType: noDefault })).toEqual(['btn'])
    expect(await htmlClasses(fourLooks, { buttonType: instanceOf(noDefault, 'link') })).toEqual([
      'btn',
      'btn-link',
    ])
  })

  it('compares values that contain double quotes', async () => {
    const quoted = {
      x: classWhen('btn-x', 'buttonType', [{ operation: '===', operand: 'say "hi"' }]),
    }

    expect(await htmlClasses(quoted, { buttonType: instanceOf(buttonType, 'say "hi"') })).toEqual([
      'btn-x',
    ])
    expect(
      await htmlClasses(quoted, { buttonType: instanceOf(buttonType, 'he said "no"') })
    ).toEqual([])
  })

  it('compares a number prop with a number when the rule stores the value as text', async () => {
    const x = { x: classWhen('btn-x', 'size', [{ operation: '===', operand: '2' }]) }

    expect(await htmlClasses(x, { size: instanceOf(size, 2) })).toEqual(['btn-x'])
    expect(await htmlClasses(x, { size: instanceOf(size, 5) })).toEqual([])
  })

  it('leaves the class off, without failing, when its condition reads a deleted prop', async () => {
    const dangling = {
      ...fourLooks,
      x: classWhen('btn-x', 'removedProp', [{ operation: '===', operand: 'x' }]),
    }

    expect(await htmlClasses(dangling, { buttonType: instanceOf(buttonType, 'outline') })).toEqual([
      'btn',
      'btn-outline',
    ])
  })

  it('leaves the class off, without failing, when its condition has no rule', async () => {
    const empty = { ...fourLooks, x: classWhen('btn-x', 'buttonType', []) }

    expect(await htmlClasses(empty, { buttonType })).toEqual(['btn', 'btn-primary'])
  })

  it('applies a class whose condition names only the value it equals', async () => {
    const onlyValue = { x: classWhenValue('btn-x', 'buttonType', 'outline') }

    expect(await htmlClasses(onlyValue, { buttonType: instanceOf(buttonType, 'outline') })).toEqual(
      ['btn-x']
    )
    expect(await htmlClasses(onlyValue, { buttonType })).toEqual([])
  })

  it('compares with undefined an operand naming a value the build cannot read', async () => {
    const variant: UIDLPropDefinition = { type: 'string' }
    const unreadable = [
      propReference('variant'),
      propReference('removedProp'),
      { type: 'dynamic' as const, content: { referenceType: 'local' as const, id: 'item' } },
      { type: 'dynamic' as const, content: { referenceType: 'state' as const, id: 'removed' } },
    ]

    for (const operand of unreadable) {
      const differs = { x: classWhen('btn-x', 'buttonType', [{ operation: '!==', operand }]) }
      const equals = { x: classWhen('btn-x', 'buttonType', [{ operation: '===', operand }]) }

      expect(await htmlClasses(differs, { buttonType, variant })).toEqual(['btn-x'])
      expect(await htmlClasses(equals, { buttonType, variant })).toEqual([])
    }
  })

  it('reads isEmpty and isNotEmpty on the value itself', async () => {
    const label: UIDLPropDefinition = { type: 'string', defaultValue: 'Buy' }
    const filled = { x: classWhen('btn-x', 'label', [{ operation: 'isNotEmpty', operand: '' }]) }
    const empty = { x: classWhen('btn-x', 'label', [{ operation: 'isEmpty', operand: '' }]) }

    expect(await htmlClasses(filled, { label })).toEqual(['btn-x'])
    expect(await htmlClasses(filled, { label: instanceOf(label, '') })).toEqual([])
    expect(await htmlClasses(empty, { label })).toEqual([])
    expect(await htmlClasses(empty, { label: instanceOf(label, '') })).toEqual(['btn-x'])
  })

  it('counts the keys of an object prop for isEmpty, as the JSX template does', async () => {
    const options: UIDLPropDefinition = { type: 'object', defaultValue: { size: 'large' } }
    const filled = { x: classWhen('btn-x', 'options', [{ operation: 'isNotEmpty' }]) }

    expect(await htmlClasses(filled, { options })).toEqual(['btn-x'])
    expect(await htmlClasses(filled, { options: instanceOf(options, {}) })).toEqual([])
  })
})

describe('Conditional project classes on a prop, JSX template', () => {
  const buttonType: UIDLPropDefinition = { type: 'string', defaultValue: 'primary' }
  const size: UIDLPropDefinition = { type: 'number', defaultValue: 3 }

  it('gives each look exactly its own modifier next to the base class', async () => {
    const { classesFor } = await jsxClassName(fourLooks, { buttonType })

    for (const look of ['primary', 'secondary', 'outline', 'link']) {
      expect(classesFor({ buttonType: look })).toEqual(['btn', `btn-${look}`])
    }
  })

  it('chains every rule under matchingCriteria "one" and "all"', async () => {
    const one = await jsxClassName(
      { x: anyOf('buttonType', ['secondary', 'outline']) },
      {
        buttonType,
      }
    )
    const all = await jsxClassName({ x: between('size', 2, 4) }, { size })

    expect(one.classesFor({ buttonType: 'outline' })).toEqual(['btn-x'])
    expect(one.classesFor({ buttonType: 'primary' })).toEqual([])
    expect(all.classesFor({ size: 3 })).toEqual(['btn-x'])
    expect(all.classesFor({ size: 9 })).toEqual([])
  })

  it('compares a number prop with a number when the rule stores the value as text', async () => {
    const { classesFor } = await jsxClassName(
      { x: classWhen('btn-x', 'size', [{ operation: '===', operand: '2' }]) },
      { size }
    )

    expect(classesFor({ size: 2 })).toEqual(['btn-x'])
  })

  it('leaves a class off, without failing, when its condition is dangling', async () => {
    const { code, classesFor } = await jsxClassName(
      {
        ...fourLooks,
        x: classWhen('btn-x', 'removedProp', [{ operation: '===', operand: 'x' }]),
        y: classWhen('btn-full', 'buttonType', []),
      },
      { buttonType }
    )

    expect(code).not.toContain('btn-x')
    expect(code).not.toContain('btn-full')
    expect(classesFor({ buttonType: 'link' })).toEqual(['btn', 'btn-link'])
  })

  it('applies a class whose condition names only the value it equals', async () => {
    const { classesFor } = await jsxClassName(
      { x: classWhenValue('btn-x', 'buttonType', 'outline') },
      { buttonType }
    )

    expect(classesFor({ buttonType: 'outline' })).toEqual(['btn-x'])
    expect(classesFor({ buttonType: 'primary' })).toEqual([])
  })

  it('compares with undefined an operand naming a prop without a value', async () => {
    const { classesFor } = await jsxClassName(
      {
        x: classWhen('btn-x', 'buttonType', [
          { operation: '!==', operand: propReference('variant') },
        ]),
      },
      { buttonType, variant: { type: 'string' } }
    )

    expect(classesFor({ buttonType: 'primary' })).toEqual(['btn-x'])
  })

  it('reads isEmpty and isNotEmpty on the value itself', async () => {
    const label: UIDLPropDefinition = { type: 'string', defaultValue: 'Buy' }
    const filled = await jsxClassName(
      { x: classWhen('btn-x', 'label', [{ operation: 'isNotEmpty', operand: '' }]) },
      { label }
    )

    expect(filled.classesFor({ label: 'Buy' })).toEqual(['btn-x'])
    expect(filled.classesFor({ label: '' })).toEqual([])
  })
})
