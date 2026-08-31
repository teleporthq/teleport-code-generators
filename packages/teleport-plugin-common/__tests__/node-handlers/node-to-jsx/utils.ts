import generate from '@babel/generator'
import * as types from '@babel/types'
import {
  createBinaryExpression,
  createConditionIdentifier,
  createStateChangeStatement,
  createDynamicValueExpression,
  makeControlUncontrolledWhenNoChangeHandler,
} from '../../../src/node-handlers/node-to-jsx/utils'
import { UIDLStateDefinition, UIDLStateModifierEvent } from '@teleporthq/teleport-types'
import { dynamicNode } from '@teleporthq/teleport-uidl-builders'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'

describe('createBinaryExpression', () => {
  it('varName === true -> varName', () => {
    const condition = { operation: '===', operand: true }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'boolean',
    }

    expect(createBinaryExpression(condition, conditionIdentifier)).toEqual({
      type: 'Identifier',
      name: 'isVisible',
    })
  })

  it('varName === false -> !varName', () => {
    const condition = { operation: '===', operand: false }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'boolean',
    }

    expect(createBinaryExpression(condition, conditionIdentifier)).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })

  it('varName === text -> varName === text', () => {
    const condition = { operation: '===', operand: 'text' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '===',
      left: { type: 'Identifier', name: 'isVisible' },
      right: { type: 'StringLiteral', value: 'text' },
    })
  })

  it('varName === undefined -> !varName', () => {
    const condition = { operation: '===' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })

  it('varName == text -> varName === text', () => {
    const condition = { operation: '==,', operand: 'text' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '===',
      left: { type: 'Identifier', name: 'isVisible' },
      right: { type: 'StringLiteral', value: 'text' },
    })
  })

  it('varName === undefined -> !varName', () => {
    const condition = { operation: '!' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })

  // A rendering condition exists to HIDE a node — it must never be able to throw.
  // The bound value is nullish far more often than it looks (an optional CMS
  // column, a category with no image, an unhydrated state), and a bare
  // `x.length` / `x.includes(...)` took whole pages down with
  // "Cannot read properties of null (reading 'length')".
  describe('collection operators are null-safe', () => {
    const codeOf = (
      condition: { operation: string; operand?: string; containsField?: string },
      type = 'array'
    ) => generate(createBinaryExpression(condition, { key: 'imageUrl', type }) as types.Node).code

    it('isNotEmpty / isEmpty coerce a nullish value to an empty collection', () => {
      expect(codeOf({ operation: 'isNotEmpty' })).toBe('(imageUrl || []).length > 0')
      expect(codeOf({ operation: 'isEmpty' })).toBe('(imageUrl || []).length === 0')
    })

    it('objects go through Object.keys on a non-null target', () => {
      expect(codeOf({ operation: 'isNotEmpty' }, 'object')).toBe(
        'Object.keys(imageUrl || {}).length > 0'
      )
    })

    it('length comparisons guard the same way', () => {
      expect(codeOf({ operation: 'lengthGreaterThan', operand: '2' })).toBe(
        '(imageUrl || []).length > 2'
      )
    })

    it('contains / notContains guard the receiver of includes()', () => {
      expect(codeOf({ operation: 'contains', operand: 'a' })).toBe('(imageUrl || []).includes("a")')
      expect(codeOf({ operation: 'notContains', operand: 'a' })).toBe(
        '!(imageUrl || []).includes("a")'
      )
    })

    it('hasKey passes a non-null receiver to hasOwnProperty', () => {
      expect(codeOf({ operation: 'hasKey', operand: 'a' }, 'object')).toBe(
        'Object.prototype.hasOwnProperty.call(imageUrl || {}, "a")'
      )
    })

    it('a non-empty string still reads as non-empty (string semantics preserved)', () => {
      // eslint-disable-next-line no-eval
      const evaluate = (expr: string, imageUrl: unknown) =>
        // tslint:disable-next-line function-constructor
        new Function('imageUrl', `return ${expr}`)(imageUrl)

      const expression = codeOf({ operation: 'isNotEmpty' })
      expect(evaluate(expression, 'https://cdn/x.png')).toBe(true)
      expect(evaluate(expression, '')).toBe(false)
      expect(evaluate(expression, null)).toBe(false)
      expect(evaluate(expression, undefined)).toBe(false)
    })
  })
})

describe('createConditionIdentifier', () => {
  const params: JSXGenerationParams = {
    propDefinitions: {
      title: {
        type: 'string',
      },
      fields: {
        type: 'object',
      },
    },
    stateDefinitions: {
      isActive: {
        type: 'boolean',
        defaultValue: false,
      },
    },
    globalStateDefinitions: {},
    dependencies: {},
    nodesLookup: {},
    windowImports: {},
    localeReferences: [],
    localeAttributeReferences: [],
    globalReferences: [],
    globalStateReferences: [],
    hoistedConstants: [],
  }

  const options: JSXGenerationOptions = {
    dynamicReferencePrefixMap: {
      prop: 'this.props',
      state: 'this',
      local: '',
    },
  }

  it('works with a prop reference', () => {
    const node = dynamicNode('prop', 'title')
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe('title')
    expect(result.prefix).toBe('this.props')
    expect(result.type).toBe('string')
  })

  it('works on member expressions', () => {
    const node = dynamicNode('prop', 'fields', ['title'])
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe("fields?.['title']")
    expect(result.prefix).toBe('this.props')
    expect(result.type).toBe('object')
  })

  it('works with a state reference', () => {
    const node = dynamicNode('state', 'isActive')
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe('isActive')
    expect(result.prefix).toBe('this')
    expect(result.type).toBe('boolean')
  })

  it('works with a local reference', () => {
    const node = dynamicNode('local', 'item', ['type'])
    const optionsWithLocalIdentifier = {
      ...options,
      localIdentifier: 'item',
    }
    const result = createConditionIdentifier(node, params, optionsWithLocalIdentifier)

    expect(result.key).toBe('type')
    expect(result.prefix).toBe('item')
    expect(result.type).toBe('string')
  })

  it('resolves a page-root local reference against the details-page exposeAs name', () => {
    const node = dynamicNode('local', 'id', ['id'])
    const detailsOptions = {
      ...options,
      dynamicReferencePrefixMap: {
        prop: 'props',
        state: '',
        local: '',
      },
      detailsPageExposeAsName: 'User',
    }
    const result = createConditionIdentifier(node, params, detailsOptions)

    expect(result.key).toBe('User.id')
    expect(result.prefix).toBe('props')
    expect(result.type).toBe('string')
  })

  it('keeps repeater semantics for local refs inside a loop', () => {
    const node = dynamicNode('local', 'item', ['type'])
    const detailsInsideLoopOptions = {
      ...options,
      localIdentifier: 'item',
      detailsPageExposeAsName: 'User',
    }
    const result = createConditionIdentifier(node, params, detailsInsideLoopOptions)

    expect(result.key).toBe('type')
    expect(result.prefix).toBe('item')
  })

  it('throws an error for unknown reference type', () => {
    const node = dynamicNode('locale', 'title')
    expect(() => createConditionIdentifier(node, params, options)).toThrowError()
  })
})

describe('createStateChangeStatement — plan v14 type-aware emitter', () => {
  // We render each AST back to source so the assertions read like the code
  // the React component would actually contain.
  const render = (stmt: ReturnType<typeof createStateChangeStatement>): string => {
    if (!stmt) {
      return ''
    }
    return generate(stmt).code.replace(/[\s;]+$/g, '')
  }

  const hooksOptions: JSXGenerationOptions = {
    stateHandling: 'hooks',
    dynamicReferencePrefixMap: { prop: '', state: '', local: '' },
  }

  const stateDefs = (
    overrides: Record<string, UIDLStateDefinition>
  ): Record<string, UIDLStateDefinition> => ({
    isOpen: { type: 'boolean', defaultValue: false },
    activeStep: { type: 'number', defaultValue: 1 },
    quizAnswers: { type: 'object', defaultValue: {} },
    tags: { type: 'array', defaultValue: [] },
    selectedSkinType: { type: 'string', defaultValue: '' },
    ...overrides,
  })

  it('toggles a boolean state with !x (existing behaviour preserved)', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'isOpen',
      newState: '$toggle',
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setIsOpen(!isOpen)')
  })

  it('refuses to toggle a numeric state (no setter emitted)', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: '$toggle',
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('refuses to toggle an object state (no setter emitted)', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'quizAnswers',
      newState: '$toggle',
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('refuses to overwrite object state with a primitive', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'quizAnswers',
      newState: 'oily',
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('writes a literal value to a numeric state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: 2,
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setActiveStep(2)')
  })

  it('writes a literal value to a string state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'selectedSkinType',
      newState: 'Oily',
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setSelectedSkinType("Oily")')
  })

  it('emits a functional setter for $increment on numeric state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: { type: '$increment' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setActiveStep(prev => prev + 1)')
  })

  it('emits a functional setter for $decrement with custom delta', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: { type: '$decrement', delta: 2 },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setActiveStep(prev => prev - 2)')
  })

  it('honors negative delta on $increment as a decrement', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: { type: '$increment', delta: -2 },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setActiveStep(prev => prev - 2)')
  })

  it('refuses $increment on non-numeric state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'selectedSkinType',
      newState: { type: '$increment' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('emits a $patch setter for an object state with a path', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'quizAnswers',
      newState: { type: '$patch', path: 'skinType', value: 'Oily' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setQuizAnswers(prev => ({\n  ...prev,\n  skinType: "Oily"\n}))')
  })

  it('refuses $patch when the state is not declared as object', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'activeStep',
      newState: { type: '$patch', path: 'foo', value: 'bar' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('emits an $append setter for an array state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'tags',
      newState: { type: '$append', value: 'sale' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(render(stmt)).toBe('setTags(prev => [...prev, "sale"])')
  })

  it('refuses $append when the state is not declared as array', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'quizAnswers',
      newState: { type: '$append', value: 'x' },
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })

  it('refuses a stateChange targeting an undeclared state', () => {
    const event: UIDLStateModifierEvent = {
      type: 'stateChange',
      modifies: 'doesNotExist',
      newState: 1,
    }
    const stmt = createStateChangeStatement(event, stateDefs({}), hooksOptions)
    expect(stmt).toBeNull()
  })
})

describe('makeControlUncontrolledWhenNoChangeHandler', () => {
  const attr = (name: string, value?: string): types.JSXAttribute =>
    types.jsxAttribute(
      types.jsxIdentifier(name),
      value === undefined ? null : types.jsxExpressionContainer(types.identifier(value))
    )

  const buildTag = (name: string, attrs: types.JSXAttribute[]): types.JSXElement => {
    const opening = types.jsxOpeningElement(types.jsxIdentifier(name), attrs, true)
    return types.jsxElement(opening, null, [], true)
  }

  const attrNames = (tag: types.JSXElement): string[] =>
    tag.openingElement.attributes
      .filter((a): a is types.JSXAttribute => a.type === 'JSXAttribute')
      .map((a) => (a.name.type === 'JSXIdentifier' ? a.name.name : ''))

  it('converts value -> defaultValue on an input with no onChange (frozen edit field)', () => {
    const tag = buildTag('input', [attr('value', 'props.titleItem?.title')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('defaultValue')
    expect(attrNames(tag)).not.toContain('value')
    // the bound expression is preserved
    expect(generate(tag).code).toContain('defaultValue={props.titleItem?.title}')
  })

  it('leaves value untouched when an onChange handler is present (controlled)', () => {
    const tag = buildTag('input', [attr('value', 'title'), attr('onChange', 'handler')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('value')
    expect(attrNames(tag)).not.toContain('defaultValue')
  })

  it('leaves readOnly display inputs untouched', () => {
    const tag = buildTag('input', [attr('value', 'x'), attr('readOnly')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('value')
    expect(attrNames(tag)).not.toContain('defaultValue')
  })

  it('leaves disabled inputs untouched', () => {
    const tag = buildTag('input', [attr('value', 'x'), attr('disabled')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('value')
  })

  it('converts checked -> defaultChecked on a checkbox with no onChange', () => {
    const tag = buildTag('input', [attr('type', undefined), attr('checked', 'isSeries')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('defaultChecked')
    expect(attrNames(tag)).not.toContain('checked')
  })

  it('converts value on textarea and select', () => {
    const ta = buildTag('textarea', [attr('value', 'overview')])
    makeControlUncontrolledWhenNoChangeHandler(ta, 'textarea')
    expect(attrNames(ta)).toContain('defaultValue')

    const sel = buildTag('select', [attr('value', 'genre')])
    makeControlUncontrolledWhenNoChangeHandler(sel, 'select')
    expect(attrNames(sel)).toContain('defaultValue')
  })

  it('ignores non-form elements (a div keeps value)', () => {
    const tag = buildTag('div', [attr('value', 'x')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'div')
    expect(attrNames(tag)).toContain('value')
    expect(attrNames(tag)).not.toContain('defaultValue')
  })

  // A `type="..."` attribute carries a StringLiteral value, not an expression.
  const typeAttr = (value: string): types.JSXAttribute =>
    types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral(value))

  it('formats a datetime-local prefill to YYYY-MM-DDTHH:mm so the value is not rejected', () => {
    const tag = buildTag('input', [
      typeAttr('datetime-local'),
      attr('value', 'props.eventItem?.start_time'),
    ])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('defaultValue')
    expect(generate(tag).code).toContain(
      'defaultValue={String(props.eventItem?.start_time || "").slice(0, 16)}'
    )
  })

  it('formats a date prefill to YYYY-MM-DD', () => {
    const tag = buildTag('input', [typeAttr('date'), attr('value', 'props.item?.day')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(generate(tag).code).toContain(
      'defaultValue={String(props.item?.day || "").slice(0, 10)}'
    )
  })

  it('formats a month prefill to YYYY-MM', () => {
    const tag = buildTag('input', [typeAttr('month'), attr('value', 'props.item?.period')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(generate(tag).code).toContain(
      'defaultValue={String(props.item?.period || "").slice(0, 7)}'
    )
  })

  it('formats a time prefill to HH:mm, stripping any leading date', () => {
    const tag = buildTag('input', [typeAttr('time'), attr('value', 'props.item?.opens_at')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    const code = generate(tag).code
    expect(code).toContain('.replace(')
    expect(code).toContain('.slice(0, 5)')
  })

  it('does NOT reformat a plain text input (only date/time types are wrapped)', () => {
    const tag = buildTag('input', [typeAttr('text'), attr('value', 'props.item?.title')])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(generate(tag).code).toContain('defaultValue={props.item?.title}')
  })

  it('leaves a controlled datetime-local (with onChange) untouched — no wrap, keeps value', () => {
    const tag = buildTag('input', [
      typeAttr('datetime-local'),
      attr('value', 'props.item?.start_time'),
      attr('onChange', 'handler'),
    ])
    makeControlUncontrolledWhenNoChangeHandler(tag, 'input')
    expect(attrNames(tag)).toContain('value')
    expect(attrNames(tag)).not.toContain('defaultValue')
  })
})

describe('createDynamicValueExpression — ctx reference (never emits an undeclared identifier)', () => {
  const ctxRef = (refPath: string[], fallbackValue?: unknown) =>
    ({
      type: 'dynamic',
      content: { referenceType: 'ctx', id: 'TQ_q-GFGA6h4I', refPath, fallbackValue },
    } as any)

  const code = (node: ReturnType<typeof createDynamicValueExpression>) => generate(node).code

  it('resolves an unresolvable ctx ref on a details page to props.<exposeAs>.<refPath>', () => {
    const opts = {
      dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' },
      detailsPageExposeAsName: 'webinar',
    } as any
    // run 1b6eb5ba: the countdown target — must be props.webinar?.scheduled_at,
    // NOT the undeclared identifier `tQQGFGA6h4I`.
    expect(code(createDynamicValueExpression(ctxRef(['scheduled_at'], '2026-12-31'), opts))).toBe(
      'props.webinar?.scheduled_at'
    )
  })

  it('falls back to the declared fallbackValue literal when no context/exposeAs resolves', () => {
    const opts = { dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' } } as any
    expect(code(createDynamicValueExpression(ctxRef(['scheduled_at'], '2026-12-31'), opts))).toBe(
      '"2026-12-31"'
    )
  })

  it('falls back to undefined (never a bare identifier) with no exposeAs and no fallbackValue', () => {
    const opts = { dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' } } as any
    expect(code(createDynamicValueExpression(ctxRef(['scheduled_at']), opts))).toBe('undefined')
  })

  it('still resolves via the ctx render-prop prefix when one is configured', () => {
    const opts = { dynamicReferencePrefixMap: { ctx: 'row', prop: 'props' } } as any
    expect(code(createDynamicValueExpression(ctxRef(['scheduled_at']), opts))).toBe(
      'row?.scheduled_at'
    )
  })
})
