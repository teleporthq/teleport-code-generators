import * as types from '@babel/types'
import {
  DEFAULT_RANGE_TEMPLATE,
  PAGINATION_CONTROL_ATTR,
  RANGE_TEMPLATE_ATTR,
  readJSXAttributeString,
} from './pagination-controls'

/**
 * The `range` control: a text element ("Showing 1–8 of 12") filled with the
 * live row range of the mapper it belongs to.
 *
 * The author's words stay theirs — they are read off `data-tq-range-template`
 * with `{from}`, `{to}` and `{total}` standing for the numbers — and the drawn
 * text is kept, verbatim, until the count endpoint has answered: `ds_N_total`
 * is `null` until then, and a range of `NaN` or `undefined` is worse than the
 * placeholder the designer chose.
 *
 *   buttons / numbered   from = total === 0 ? 0 : (page − 1) × perPage + 1
 *   infinite scroll      from = total === 0 ? 0 : 1
 *   both                 to   = min(page × perPage, total)
 *
 * In an appending list `page` is the number of pages loaded so far, so the
 * same `to` counts the rows on screen. Numbers go through
 * `toLocaleString("en-US")`, the way the canvas prints them.
 *
 * ⛔ The arithmetic must agree with the canvas renderer's
 * (`packages/renderer/src/node-types/array-mapper-pagination.ts`): a builder
 * styling "Showing 1–8 of 12" must see the same words on the published page.
 */

// tslint:disable:no-any

export interface RangeControlVars {
  /** `ds_N_total` — `null` until counted. */
  totalVar: string
  /** The page the list stands on: `ds_N_page`, or `ds_N_state.page` beside a search. */
  currentPageExpr: types.Expression
  perPage: number
  /** An appending list always shows from the first row. */
  infiniteScroll: boolean
}

const PLACEHOLDER = /\{(from|to|total)\}/g

const total = (vars: RangeControlVars): types.Identifier => types.identifier(vars.totalVar)

const page = (vars: RangeControlVars): types.Expression =>
  types.cloneNode(vars.currentPageExpr, true) as types.Expression

/** `total === 0 ? 0 : <firstRow>` */
const unlessEmpty = (vars: RangeControlVars, firstRow: types.Expression): types.Expression =>
  types.conditionalExpression(
    types.binaryExpression('===', total(vars), types.numericLiteral(0)),
    types.numericLiteral(0),
    firstRow
  )

const buildFrom = (vars: RangeControlVars): types.Expression =>
  unlessEmpty(
    vars,
    vars.infiniteScroll
      ? types.numericLiteral(1)
      : types.binaryExpression(
          '+',
          types.binaryExpression(
            '*',
            types.binaryExpression('-', page(vars), types.numericLiteral(1)),
            types.numericLiteral(vars.perPage)
          ),
          types.numericLiteral(1)
        )
  )

/** `Math.min(page * perPage, total)` */
const buildTo = (vars: RangeControlVars): types.Expression =>
  types.callExpression(types.memberExpression(types.identifier('Math'), types.identifier('min')), [
    types.binaryExpression('*', page(vars), types.numericLiteral(vars.perPage)),
    total(vars),
  ])

const buildNumber = (placeholder: string, vars: RangeControlVars): types.Expression => {
  const value =
    placeholder === 'from' ? buildFrom(vars) : placeholder === 'to' ? buildTo(vars) : total(vars)
  return types.callExpression(types.memberExpression(value, types.identifier('toLocaleString')), [
    types.stringLiteral('en-US'),
  ])
}

const templateElement = (text: string, tail: boolean): types.TemplateElement =>
  types.templateElement(
    { raw: text.replace(/\\|`|\$\{/g, (match) => `\\${match}`), cooked: text },
    tail
  )

/**
 * The JSX printer writes a brace inside a static attribute as `&#123;` /
 * `&#125;` so it is never read as an expression; the placeholders are braces,
 * so the template is read back through that escaping.
 */
const decodeBraces = (text: string): string =>
  text
    .replace(/&#123;|&#x7b;|&lbrace;/gi, '{')
    .replace(/&#125;|&#x7d;|&rbrace;/gi, '}')
    .replace(/&amp;/g, '&')

/** The author's template as a template literal, each placeholder a live number. */
const buildLiveText = (template: string, vars: RangeControlVars): types.TemplateLiteral => {
  const quasis: types.TemplateElement[] = []
  const expressions: types.Expression[] = []
  const placeholder = new RegExp(PLACEHOLDER.source, 'g')
  let last = 0
  let match = placeholder.exec(template)
  while (match) {
    quasis.push(templateElement(template.slice(last, match.index), false))
    expressions.push(buildNumber(match[1], vars))
    last = match.index + match[0].length
    match = placeholder.exec(template)
  }
  quasis.push(templateElement(template.slice(last), true))
  return types.templateLiteral(quasis, expressions)
}

/**
 * Every `range` control under a component body, in document order. The body is
 * a `BlockStatement`, so the walk has to cross statements, ternaries and the
 * `cond && <jsx/>` of a gated section, not only JSX children.
 */
export const findRangeControls = (root: any): any[] => {
  const found: any[] = []
  const traverse = (node: any): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (
      node.type === 'JSXElement' &&
      readJSXAttributeString(node, PAGINATION_CONTROL_ATTR) === 'range'
    ) {
      found.push(node)
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(traverse)
    }
    if (Array.isArray(node.body)) {
      node.body.forEach(traverse)
    } else {
      traverse(node.body)
    }
    traverse(node.consequent)
    traverse(node.alternate)
    traverse(node.left)
    traverse(node.right)
    traverse(node.test)
    traverse(node.expression)
    traverse(node.argument)
  }
  traverse(root)
  return found
}

/**
 * The element's own children as one expression, so they can be the fallback of
 * a ternary: plain text becomes a string, anything richer rides along in a
 * fragment.
 */
const drawnText = (children: any[]): types.Expression => {
  const texts: string[] = []
  for (const child of children) {
    if (child.type === 'JSXText') {
      texts.push(child.value)
    } else if (
      child.type === 'JSXExpressionContainer' &&
      child.expression?.type === 'StringLiteral'
    ) {
      texts.push(child.expression.value)
    } else {
      return types.jsxFragment(types.jsxOpeningFragment(), types.jsxClosingFragment(), children)
    }
  }
  return types.stringLiteral(texts.join('').replace(/\s+/g, ' ').trim())
}

/**
 * `{total === null ? <drawn text> : `<template with live numbers>`}` in place of
 * the element's children. The marker and template attributes stay on the
 * element, so the published DOM carries the same contract the canvas reads.
 */
export const wireRangeControl = (node: any, vars: RangeControlVars): void => {
  const template =
    decodeBraces(readJSXAttributeString(node, RANGE_TEMPLATE_ATTR)) || DEFAULT_RANGE_TEMPLATE
  const drawn = drawnText(Array.isArray(node.children) ? node.children : [])
  node.children = [
    types.jsxExpressionContainer(
      types.conditionalExpression(
        types.binaryExpression('===', total(vars), types.nullLiteral()),
        drawn,
        buildLiveText(template, vars)
      )
    ),
  ]
  if (node.openingElement) {
    node.openingElement.selfClosing = false
  }
  if (!node.closingElement && node.openingElement?.name) {
    node.closingElement = types.jsxClosingElement(types.cloneNode(node.openingElement.name, true))
  }
}
