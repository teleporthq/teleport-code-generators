import * as types from '@babel/types'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'
import { UIDLAttributeValue, UIDLDependency, UIDLElementNode } from '@teleporthq/teleport-types'

const CALENDARKIT_DEPENDENCY: UIDLDependency = {
  type: 'package',
  path: 'calendarkit-basic',
  version: '1.1.0',
  meta: {
    namedImport: true,
  },
}

// Mirrors the post-resolver shape produced by the GUI's calendar-to-uidl
// mapper: elementType is the React component name, dependency is embedded.
const calendarNode = (
  attrs: Record<string, UIDLAttributeValue>,
  dependency: UIDLDependency = CALENDARKIT_DEPENDENCY,
  elementType = 'BasicScheduler'
): UIDLElementNode => ({
  type: 'element',
  content: {
    key: 'calendar',
    elementType,
    dependency,
    attrs,
    children: [],
  },
})

const buildParams = (): JSXGenerationParams => ({
  dependencies: {},
  propDefinitions: {},
  stateDefinitions: {},
  globalStateDefinitions: {},
  nodesLookup: {},
  windowImports: {},
  localeReferences: [],
  localeAttributeReferences: [],
  globalReferences: [],
  globalStateReferences: [],
  hoistedConstants: [],
})

const options: JSXGenerationOptions = {
  dynamicReferencePrefixMap: {
    prop: 'props',
    state: '',
    local: '',
  },
}

const getEventsAttr = (element: types.JSXElement): types.JSXAttribute | undefined =>
  element.openingElement.attributes.find(
    (attr): attr is types.JSXAttribute =>
      attr.type === 'JSXAttribute' &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name === 'events'
  )

// Asserts the `.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }))`
// wrapper and returns the expression being mapped over (the guard or the array).
const expectEventsReviver = (eventsAttr: types.JSXAttribute): types.Expression => {
  expect(eventsAttr.value?.type).toBe('JSXExpressionContainer')
  const expression = (eventsAttr.value as types.JSXExpressionContainer).expression

  expect(expression.type).toBe('CallExpression')
  const mapCall = expression as types.CallExpression
  expect(mapCall.callee.type).toBe('MemberExpression')
  const mapCallee = mapCall.callee as types.MemberExpression
  expect((mapCallee.property as types.Identifier).name).toBe('map')

  const arrow = mapCall.arguments[0] as types.ArrowFunctionExpression
  expect(arrow.type).toBe('ArrowFunctionExpression')
  const body = arrow.body as types.ObjectExpression
  expect(body.type).toBe('ObjectExpression')
  expect(body.properties[0].type).toBe('SpreadElement')

  const dateProps = body.properties.slice(1) as types.ObjectProperty[]
  const propNames = dateProps.map((prop) => (prop.key as types.Identifier).name)
  expect(propNames).toEqual(['start', 'end'])
  dateProps.forEach((prop) => {
    expect(prop.value.type).toBe('NewExpression')
    expect(((prop.value as types.NewExpression).callee as types.Identifier).name).toBe('Date')
  })

  return mapCallee.object as types.Expression
}

const expectArrayIsArrayGuard = (mapSource: types.Expression) => {
  expect(mapSource.type).toBe('ConditionalExpression')
  const guard = mapSource as types.ConditionalExpression
  expect(guard.test.type).toBe('CallExpression')
  const isArrayCall = guard.test as types.CallExpression
  const isArrayCallee = isArrayCall.callee as types.MemberExpression
  expect((isArrayCallee.object as types.Identifier).name).toBe('Array')
  expect((isArrayCallee.property as types.Identifier).name).toBe('isArray')
  expect(guard.alternate.type).toBe('ArrayExpression')
  expect((guard.alternate as types.ArrayExpression).elements.length).toBe(0)
}

describe('calendarkit-basic BasicScheduler events revival', () => {
  it('wraps a static events array with the Date revival map (no redundant guard)', () => {
    const node = calendarNode({
      view: { type: 'static', content: 'month' },
      events: {
        type: 'static',
        content: [
          { id: '1', title: 'Standup', start: '2026-06-10T09:00:00', end: '2026-06-10T09:30:00' },
        ],
      } as unknown as UIDLAttributeValue,
    })

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement
    const eventsAttr = getEventsAttr(result)

    expect(eventsAttr).toBeDefined()
    const mapSource = expectEventsReviver(eventsAttr as types.JSXAttribute)
    expect(mapSource.type).toBe('ArrayExpression')
  })

  it('wraps a dynamic state-bound events reference with the Array.isArray guard', () => {
    const node = calendarNode({
      events: {
        type: 'dynamic',
        content: { referenceType: 'state', id: 'calendarEvents' },
      },
    })

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement
    const eventsAttr = getEventsAttr(result)

    expect(eventsAttr).toBeDefined()
    const mapSource = expectEventsReviver(eventsAttr as types.JSXAttribute)
    expectArrayIsArrayGuard(mapSource)

    const guard = mapSource as types.ConditionalExpression
    const isArrayArg = (guard.test as types.CallExpression).arguments[0] as types.Identifier
    expect(isArrayArg.name).toBe('calendarEvents')
  })

  it('leaves the element untouched when events is missing — the library defaults to []', () => {
    const node = calendarNode({
      view: { type: 'static', content: 'week' },
    })

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement

    expect(getEventsAttr(result)).toBeUndefined()
  })

  it('does not touch events attrs on elements from other packages', () => {
    const node = calendarNode(
      {
        events: {
          type: 'dynamic',
          content: { referenceType: 'state', id: 'calendarEvents' },
        },
      },
      { type: 'package', path: 'some-other-lib', version: '1.0.0' },
      'OtherScheduler'
    )

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement
    const eventsAttr = getEventsAttr(result)

    expect(eventsAttr).toBeDefined()
    const expression = ((eventsAttr as types.JSXAttribute).value as types.JSXExpressionContainer)
      .expression
    expect(expression.type).not.toBe('CallExpression')
  })
})
