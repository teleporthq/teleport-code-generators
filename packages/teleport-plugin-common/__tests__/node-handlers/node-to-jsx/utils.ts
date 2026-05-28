import generate from '@babel/generator'
import {
  createBinaryExpression,
  createConditionIdentifier,
  createStateChangeStatement,
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
