import { GeneratorOptions } from '@teleporthq/teleport-types'
import { resolveHtmlNesting } from '../../src/resolvers/html-nesting'
import { component, element, text } from './mocks'

const NO_OPTIONS: GeneratorOptions = {}

let warnSpy: jest.SpyInstance

const warnings = (): string[] => warnSpy.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('resolveHtmlNesting — nesting that has no lossless repair', () => {
  it('reports a nested anchor and leaves both in place', () => {
    const inner = element('a', [text('Details')])
    const outer = element('a', [element('div', [inner])])

    resolveHtmlNesting(component(outer, 'Product-Card'), NO_OPTIONS)

    expect(inner.content.elementType).toBe('a')
    expect(warnings()).toEqual([expect.stringContaining('<a> nested inside another <a>')])
    expect(warnings()[0]).toContain('Product-Card')
  })

  it('forgets an anchor once a scope boundary hides it from the parser', () => {
    const inner = element('a', [text('Details')])
    const outer = element('a', [element('table', [element('td', [inner])])])

    resolveHtmlNesting(component(outer), NO_OPTIONS)

    expect(warnings().filter((message) => message.includes('nested inside another <a>'))).toEqual(
      []
    )
  })

  it('reports a nested form', () => {
    const outer = element('form', [element('div', [element('form', [])])])

    resolveHtmlNesting(component(outer), NO_OPTIONS)

    expect(warnings()).toEqual([expect.stringContaining('<form> nested inside another <form>')])
  })

  it('reports content the parser would hoist out of a table', () => {
    const table = element('table', [element('div', [])])

    resolveHtmlNesting(component(table), NO_OPTIONS)

    expect(warnings()).toEqual([expect.stringContaining('<div> is not valid content for <table>')])
  })

  it('sees through a component wrapper when checking table content', () => {
    const table = element('table', [element('Repeater', [element('tr', [])])])

    resolveHtmlNesting(component(table), NO_OPTIONS)

    expect(warnings()).toEqual([expect.stringContaining('<tr> is not valid content for <table>')])
  })

  it('accepts a well-formed table', () => {
    const table = element('table', [
      element('tbody', [element('tr', [element('td', [text('7')])])]),
    ])

    resolveHtmlNesting(component(table), NO_OPTIONS)

    expect(warnings()).toEqual([])
  })

  it('reports a heading inside a heading', () => {
    const heading = element('h2', [element('h3', [text('Sub')])])

    resolveHtmlNesting(component(heading), NO_OPTIONS)

    expect(warnings()).toEqual([expect.stringContaining('<h3> nested inside <h2>')])
  })

  it('says nothing about markup that parses as written', () => {
    const section = element('section', [
      element('h2', [text('Title')]),
      element('p', [element('a', [element('span', [text('link')])])]),
      element('button', [element('span', [text('Buy')])]),
    ])

    resolveHtmlNesting(component(section), NO_OPTIONS)

    expect(warnings()).toEqual([])
  })
})
