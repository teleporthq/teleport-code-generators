import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as types from '@babel/types'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * A navigation element the editor's Instant search plugin adopted as the button
 * that opens the search modal, as it leaves the editor and as the Next.js
 * generator publishes it.
 *
 * What the editor exports for such an element (the GUI side is proven in
 * `teleport-gui/.../domain-to-uidl/__tests__/adopted-navigation-element-export.spec.ts`):
 *
 *   - the element keeps its own link ability and its own look, and gains
 *     `data-tq-search-control`, `aria-haspopup`, `aria-label`, `role`, `tabindex`;
 *   - a click workflow whose trigger carries `preventDefault` + `stopPropagation`
 *     and the element's html id, ending in `general-emit-custom-event`
 *     `tq-search-open`;
 *   - a wrapping form gets the same through an `event-element-event` `submit`;
 *   - a search input carries `readonly` as the boolean `true`;
 *   - the element's own workflows are paused, so they are not in the UIDL at all.
 *
 * Published, that must still be a working button. Everything below fails
 * silently in a browser, so it is read off the generated component:
 *
 *   1. the click listener sits on the element that RECEIVES the click. A link
 *      ability becomes `<Link><a>` (or `<a>` for a url): Next's legacy Link takes
 *      its click handler from the inner `<a>`, calls it first and navigates only
 *      when the event was not default-prevented, so the id and the handler must
 *      both be on that `<a>`, never on the `<Link>`;
 *   2. that handler cancels the link or the submit (`preventDefault`) and stops
 *      the event bubbling to a linked card (`stopPropagation`) BEFORE it runs
 *      the workflow, and only when the trigger asked for it;
 *   3. a boolean `readonly` is printed as the bare `readOnly`: `readOnly=""`
 *      would be read as false by React and leave the field editable;
 *   4. `<label for>` still points at its input.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const OPEN_EVENT = 'tq-search-open'
const FORM_ID = 'nav-search-form'
const INPUT_ID = 'nav-search-input'
const LABEL_ID = 'nav-search-label'
const CONTROL_ATTRS = {
  'data-tq-search-control': 'adopted',
  'aria-haspopup': 'dialog',
  'aria-label': 'Search',
}

type Uidl = Record<string, any> // tslint:disable-line:no-any

const staticValue = (content: unknown) => ({ type: 'static', content })
const element = (content: Uidl) => ({ type: 'element', content })
const attrsOf = (attrs: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(attrs).map(([name, value]) => [name, staticValue(value)]))

const NAVLINK = { type: 'navlink', content: { routeName: 'about' } }

interface ControlShape {
  /** The control's published html id. */
  id: string
  /** The element tree as the editor exports it. */
  node: Uidl
  /** The link ability makes it a Next `<Link>`; a url link is a plain `<a>`. */
  viaNextLink: boolean
  /** Whether its click workflow asks to cancel the link and stop bubbling. */
  cancelsClick: boolean
}

// The shapes an existing search or cart-like control takes in a header, each
// with the link ability it already had.
const CONTROL_SHAPES: ControlShape[] = [
  {
    id: 'nav-box',
    viaNextLink: true,
    cancelsClick: true,
    node: element({
      elementType: 'container',
      semanticType: 'div',
      abilities: { link: NAVLINK },
      attrs: attrsOf({ id: 'nav-box', ...CONTROL_ATTRS, role: 'button', tabindex: '0' }),
      children: [],
    }),
  },
  {
    id: 'nav-span',
    viaNextLink: true,
    cancelsClick: true,
    node: element({
      elementType: 'text',
      semanticType: 'span',
      abilities: { link: NAVLINK },
      attrs: attrsOf({ id: 'nav-span', ...CONTROL_ATTRS, role: 'button', tabindex: '0' }),
      children: [staticValue('Search')],
    }),
  },
  {
    id: 'nav-button',
    viaNextLink: true,
    cancelsClick: true,
    node: element({
      elementType: 'button',
      abilities: { link: NAVLINK },
      attrs: attrsOf({ id: 'nav-button', ...CONTROL_ATTRS }),
      children: [staticValue('Search')],
    }),
  },
  {
    id: 'nav-bare',
    viaNextLink: true,
    cancelsClick: true,
    node: element({
      elementType: 'container',
      semanticType: 'div',
      abilities: { link: NAVLINK },
      attrs: attrsOf({ id: 'nav-bare', 'data-tq-search-control': 'adopted' }),
      children: [staticValue('Search')],
    }),
  },
  {
    id: 'nav-navlink',
    viaNextLink: true,
    cancelsClick: true,
    node: element({
      elementType: 'navlink',
      attrs: attrsOf({ id: 'nav-navlink', transitionTo: '/about', ...CONTROL_ATTRS }),
      children: [staticValue('Search')],
    }),
  },
  {
    id: 'nav-url',
    viaNextLink: false,
    cancelsClick: true,
    node: element({
      elementType: 'container',
      semanticType: 'div',
      style: { padding: staticValue('8px') },
      abilities: { link: { type: 'url', content: { url: staticValue('/shop'), newTab: false } } },
      attrs: attrsOf({ id: 'nav-url', ...CONTROL_ATTRS, role: 'button' }),
      children: [staticValue('Search')],
    }),
  },
  // Control: a linked element whose workflow does NOT ask to cancel the click
  // must not get the cancelling lines, or every assertion above would hold for
  // any handler the generator writes.
  {
    id: 'nav-plain',
    viaNextLink: true,
    cancelsClick: false,
    node: element({
      elementType: 'text',
      semanticType: 'span',
      abilities: { link: NAVLINK },
      attrs: attrsOf({ id: 'nav-plain' }),
      children: [staticValue('Plain')],
    }),
  },
]

const emitOpenWorkflow = (
  id: string,
  trigger: { type: string; config: Uidl },
  htmlId: string
): Uidl => ({
  id,
  name: id,
  trigger: {
    nodeId: `${id}-trigger`,
    type: trigger.type,
    config: { nodeId: `${id}-doc-node`, ...trigger.config, elementHtmlId: htmlId },
    scope: 'element',
  },
  nodes: [
    {
      id: `${id}-emit`,
      type: 'general-emit-custom-event',
      label: 'Emit Custom Event',
      config: { eventName: OPEN_EVENT, scope: 'global' },
      executionEnv: 'client',
      stepNumber: 1,
    },
  ],
  edges: [{ id: `${id}-edge`, source: `${id}-trigger`, target: `${id}-emit` }],
  usedInNodes: {},
})

const navigationComponent = (): Uidl => ({
  name: 'Navigation',
  propDefinitions: {},
  stateDefinitions: {},
  node: element({
    elementType: 'container',
    semanticType: 'div',
    style: { display: staticValue('contents') },
    children: [
      ...CONTROL_SHAPES.map((shape) => shape.node),
      element({
        elementType: 'form',
        semanticType: 'form',
        attrs: attrsOf({ id: FORM_ID }),
        children: [
          element({
            elementType: 'text',
            semanticType: 'label',
            attrs: attrsOf({ id: LABEL_ID, for: INPUT_ID }),
            children: [staticValue('Search the shop')],
          }),
          element({
            elementType: 'textinput',
            attrs: {
              ...attrsOf({ id: INPUT_ID, type: 'search', name: 'q', ...CONTROL_ATTRS }),
              // What the editor exports for an adopted input: the boolean.
              readonly: staticValue(true),
            },
            children: [],
          }),
        ],
      }),
    ],
  }),
})

const buildUidl = (): Record<string, unknown> => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as Uidl
  uidl.components.Navigation = navigationComponent()

  const indexPage = uidl.root.node.content.children.find(
    (child: Uidl) => child.type === 'conditional' && child.content.value === 'index'
  )
  indexPage.content.node.content.children.push(
    element({
      elementType: 'component',
      semanticType: 'Navigation',
      name: 'navigation',
      dependency: { type: 'local' },
    })
  )

  const workflows: Record<string, Uidl> = {}
  for (const shape of CONTROL_SHAPES) {
    workflows[`click-${shape.id}`] = emitOpenWorkflow(
      `click-${shape.id}`,
      {
        type: 'event-element-clicked',
        config: shape.cancelsClick ? { preventDefault: true, stopPropagation: true } : {},
      },
      shape.id
    )
  }
  workflows.submit = emitOpenWorkflow(
    'submit',
    {
      type: 'event-element-event',
      config: { eventType: 'submit', preventDefault: true, stopPropagation: true },
    },
    FORM_ID
  )
  uidl.workflows = { workflows, customNodes: {} }

  return uidl
}

const parseModule = (code: string): types.File =>
  parse(code, { sourceType: 'module', plugins: ['jsx'] })

const attributeOf = (opening: types.JSXOpeningElement, name: string) =>
  opening.attributes.find(
    (attr): attr is types.JSXAttribute =>
      types.isJSXAttribute(attr) && types.isJSXIdentifier(attr.name) && attr.name.name === name
  )

const jsxName = (opening: types.JSXOpeningElement): string =>
  types.isJSXIdentifier(opening.name) ? opening.name.name : ''

interface FoundElement {
  opening: types.JSXOpeningElement
  /** The JSX element this one is a direct child of, when there is one. */
  parentOpening?: types.JSXOpeningElement
}

/** The JSX element whose static `id` attribute is `id`, with its JSX parent. */
const findById = (ast: types.File, id: string): FoundElement[] => {
  const found: FoundElement[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      const idAttr = attributeOf(path.node, 'id')
      if (idAttr && types.isStringLiteral(idAttr.value) && idAttr.value.value === id) {
        const parent = path.parentPath.parentPath?.node
        found.push({
          opening: path.node,
          parentOpening: types.isJSXElement(parent) ? parent.openingElement : undefined,
        })
      }
    },
  })
  return found
}

const printed = (node: types.Node): string => generate(node as never).code

/** The function the generated module registers as `elementTriggers['id'].onX`. */
const registeredHandler = (
  ast: types.File,
  id: string,
  reactProp: string
): types.FunctionExpression | undefined => {
  let handler: types.FunctionExpression | undefined
  traverse(ast, {
    AssignmentExpression(path) {
      const { left, right } = path.node
      if (
        !types.isMemberExpression(left) ||
        !types.isStringLiteral(left.property) ||
        left.property.value !== id ||
        !types.isObjectExpression(right)
      ) {
        return
      }
      for (const property of right.properties) {
        if (
          types.isObjectProperty(property) &&
          types.isIdentifier(property.key) &&
          property.key.name === reactProp &&
          types.isFunctionExpression(property.value)
        ) {
          handler = property.value
        }
      }
    },
  })
  return handler
}

/** `event.preventDefault()` style statements at the top of a handler, in order. */
const leadingEventCalls = (handler: types.FunctionExpression): string[] => {
  const calls: string[] = []
  for (const statement of handler.body.body) {
    const expression = types.isExpressionStatement(statement) ? statement.expression : undefined
    if (
      expression &&
      types.isCallExpression(expression) &&
      types.isMemberExpression(expression.callee) &&
      types.isIdentifier(expression.callee.object, { name: 'event' }) &&
      types.isIdentifier(expression.callee.property)
    ) {
      calls.push(expression.callee.property.name)
      continue
    }
    break
  }
  return calls
}

const bodyText = (handler: types.FunctionExpression): string => printed(handler.body)

describe('an adopted navigation element, published by the Next generator', () => {
  let navigation = ''
  let ast: types.File

  beforeAll(async () => {
    const outputFolder = await createNextProjectGenerator().generateProject(buildUidl(), template)
    const file = outputFolder.subFolders
      .find((sub) => sub.name === 'components')
      ?.files.find((entry) => entry.name === 'navigation')
    expect(file).toBeDefined()
    navigation = String(file?.content)
    ast = parseModule(navigation)
  })

  describe('a click on a linked control', () => {
    for (const shape of CONTROL_SHAPES) {
      describe(`${shape.id} (${shape.node.content.elementType})`, () => {
        it('has its id and its click handler on the one <a> that receives the click', () => {
          const matches = findById(ast, shape.id)
          // One element carries the id: the listener cannot find two.
          expect(matches).toHaveLength(1)

          const { opening, parentOpening } = matches[0]
          expect(jsxName(opening)).toBe('a')
          const onClick = attributeOf(opening, 'onClick')
          expect(onClick).toBeDefined()
          expect(printed(onClick!.value as types.Node)).toMatch(
            new RegExp(`elementTriggers\\[["']${shape.id}["']\\]\\[["']onClick["']\\]`)
          )

          if (shape.viaNextLink) {
            // Legacy next/link reads the click handler (and takes the id) from
            // the child <a>; on the <Link> itself it warns and the handler is
            // never called.
            expect(parentOpening && jsxName(parentOpening)).toBe('Link')
            expect(attributeOf(parentOpening!, 'onClick')).toBeUndefined()
            expect(attributeOf(parentOpening!, 'id')).toBeUndefined()
            expect(attributeOf(parentOpening!, 'href')).toBeDefined()
          } else {
            expect(attributeOf(opening, 'href')).toBeDefined()
          }
        })

        it(
          shape.cancelsClick
            ? 'cancels the link and stops the bubbling before it runs the workflow'
            : 'does not cancel the link when the trigger did not ask to',
          () => {
            const handler = registeredHandler(ast, shape.id, 'onClick')
            expect(handler).toBeDefined()
            const calls = leadingEventCalls(handler!)
            if (shape.cancelsClick) {
              expect(calls).toEqual(['preventDefault', 'stopPropagation'])
              // The workflow runs after both, in the same handler.
              expect(bodyText(handler!)).toContain('__execWf(')
              expect(bodyText(handler!).indexOf('stopPropagation')).toBeLessThan(
                bodyText(handler!).indexOf('__execWf(')
              )
            } else {
              expect(calls).toEqual([])
              expect(bodyText(handler!)).not.toContain('preventDefault')
              expect(bodyText(handler!)).not.toContain('stopPropagation')
            }
            expect(bodyText(handler!)).toContain(`elementId: '${shape.id}'`)
          }
        )
      })
    }

    it('keeps the control own link target next to the handler', () => {
      const [{ parentOpening }] = findById(ast, 'nav-box')
      const href = attributeOf(parentOpening!, 'href')
      expect(href && printed(href.value as types.Node)).toBe('"/about"')

      const [{ opening }] = findById(ast, 'nav-url')
      expect(printed(attributeOf(opening, 'href')!.value as types.Node)).toBe('"/shop"')
    })

    it('ships the workflow that tells the site to open the search', () => {
      expect(navigation).toContain(`eventName: '${OPEN_EVENT}'`)
      expect(navigation).toContain(`scope: 'global'`)
      expect(navigation).toContain('type: ' + `'general-emit-custom-event'`)
    })
  })

  describe('a submit of the search form', () => {
    it('has the submit handler on the <form> that owns the id', () => {
      const matches = findById(ast, FORM_ID)
      expect(matches).toHaveLength(1)
      const { opening } = matches[0]
      expect(jsxName(opening)).toBe('form')
      expect(printed(attributeOf(opening, 'onSubmit')!.value as types.Node)).toMatch(
        new RegExp(`elementTriggers\\[["']${FORM_ID}["']\\]\\[["']onSubmit["']\\]`)
      )
    })

    it('cancels the page reload and stops the bubbling before it runs the workflow', () => {
      const handler = registeredHandler(ast, FORM_ID, 'onSubmit')
      expect(handler).toBeDefined()
      expect(leadingEventCalls(handler!)).toEqual(['preventDefault', 'stopPropagation'])
      expect(bodyText(handler!)).toContain(`eventType: 'submit'`)
      expect(bodyText(handler!).indexOf('stopPropagation')).toBeLessThan(
        bodyText(handler!).indexOf('__execWf(')
      )
    })
  })

  describe('the search input', () => {
    it('prints a boolean readonly as the bare readOnly, never as a string', () => {
      const [{ opening }] = findById(ast, INPUT_ID)
      expect(jsxName(opening)).toBe('input')
      const readOnly = attributeOf(opening, 'readOnly')
      expect(readOnly).toBeDefined()
      // `<input readOnly />`: no value node at all, not `readOnly=""` or "true".
      expect(readOnly!.value).toBeNull()
      // The html spelling is not left beside it.
      expect(attributeOf(opening, 'readonly')).toBeUndefined()
    })

    it('keeps its own attributes and the label that points at it', () => {
      const [{ opening }] = findById(ast, INPUT_ID)
      expect(printed(attributeOf(opening, 'type')!.value as types.Node)).toBe('"search"')
      expect(printed(attributeOf(opening, 'aria-haspopup')!.value as types.Node)).toBe('"dialog"')

      const [{ opening: label }] = findById(ast, LABEL_ID)
      expect(jsxName(label)).toBe('label')
      expect(printed(attributeOf(label, 'htmlFor')!.value as types.Node)).toBe(`"${INPUT_ID}"`)
    })
  })
})
