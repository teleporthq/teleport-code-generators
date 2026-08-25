import { GeneratorOptions, UIDLElementNode } from '@teleporthq/teleport-types'
import { resolveHtmlNesting } from '../../src/resolvers/html-nesting'
import {
  component,
  element,
  optionsWithProjectStyles,
  referencingProjectStyle,
  staticStyleSet,
  tagsOf,
  text,
} from './mocks'

const NO_OPTIONS: GeneratorOptions = {}

// `console.warn` is the resolver's diagnostic channel; silence it so the suite
// output stays readable while still exercising the code path.
let warnSpy: jest.SpyInstance

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('resolveHtmlNesting — paragraph content', () => {
  it('retags a wrapper <div> reached through a framework component', () => {
    // The shape that shipped: <p>… <Link><a><div><span>Privacy Policy</span>.
    const wrapper = element('div', [element('span', [text('Privacy Policy')])])
    const paragraph = element('p', [
      element('span', [text('We promise only joy, no junk. See our ')]),
      element('Link', [element('a', [wrapper])]),
      element('span', [text('.')]),
    ])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.elementType).toBe('p')
    expect(wrapper.content.elementType).toBe('span')
    expect(tagsOf(paragraph)).toEqual(['p', 'span', 'Link', 'a', 'span', 'span', 'span'])
  })

  it('restates the block display the retagged wrapper loses with its tag', () => {
    const wrapper = element('div', [element('span', [text('Read more')])])
    const paragraph = element('p', [wrapper])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(wrapper.content.style).toEqual({ display: { type: 'static', content: 'block' } })
  })

  it('leaves the display alone when the node already declares one', () => {
    const wrapper = element('div', [], {
      style: { display: { type: 'static', content: 'flex' } },
    })
    const paragraph = element('p', [wrapper])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(wrapper.content.elementType).toBe('span')
    expect(wrapper.content.style.display).toEqual({ type: 'static', content: 'flex' })
  })

  it('leaves the display alone when a project class declares one', () => {
    const wrapper = element('div', [], referencingProjectStyle('card-row'))
    const paragraph = element('p', [wrapper])

    resolveHtmlNesting(
      component(paragraph),
      optionsWithProjectStyles({ 'card-row': staticStyleSet({ display: 'flex' }) })
    )

    expect(wrapper.content.elementType).toBe('span')
    expect(wrapper.content.style).toBeUndefined()
  })

  it('adds the display when the project class it references declares none', () => {
    const wrapper = element('div', [], referencingProjectStyle('card-row'))
    const paragraph = element('p', [wrapper])

    resolveHtmlNesting(
      component(paragraph),
      optionsWithProjectStyles({ 'card-row': staticStyleSet({ color: 'red' }) })
    )

    expect(wrapper.content.style).toEqual({ display: { type: 'static', content: 'block' } })
  })

  it('does not guess a display when the referenced style set cannot be read', () => {
    const wrapper = element('div', [], referencingProjectStyle('card-row'))
    const paragraph = element('p', [wrapper])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(wrapper.content.elementType).toBe('span')
    expect(wrapper.content.style).toBeUndefined()
  })

  it('retags every offending wrapper, however deep', () => {
    const outer = element('div', [])
    const inner = element('div', [])
    outer.content.children = [element('span', [inner])]
    const paragraph = element('p', [outer])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(outer.content.elementType).toBe('span')
    expect(inner.content.elementType).toBe('span')
  })

  it('demotes the paragraph when an offender carries meaning of its own', () => {
    const list = element('ul', [element('li', [text('One')])])
    const paragraph = element('p', [element('span', [text('Sizes:')]), list], {
      semanticType: 'p',
    })

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.elementType).toBe('div')
    expect(paragraph.content.semanticType).toBe('div')
    expect(list.content.elementType).toBe('ul')
  })

  it('restores the paragraph block margins the demotion drops', () => {
    const paragraph = element('p', [element('h3', [text('Heading')])])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.style).toEqual({
      marginTop: { type: 'static', content: '1em' },
      marginBottom: { type: 'static', content: '1em' },
    })
  })

  it('keeps the authored spacing instead of restoring the browser default', () => {
    const paragraph = element('p', [element('h3', [text('Heading')])], {
      ...referencingProjectStyle('newsletter-privacy'),
    })

    resolveHtmlNesting(
      component(paragraph),
      optionsWithProjectStyles({ 'newsletter-privacy': staticStyleSet({ margin: '0' }) })
    )

    expect(paragraph.content.elementType).toBe('div')
    expect(paragraph.content.style).toBeUndefined()
  })

  it('demotes rather than retags when the paragraph holds both kinds of offender', () => {
    const wrapper = element('div', [])
    const paragraph = element('p', [wrapper, element('table', [])])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.elementType).toBe('div')
    expect(wrapper.content.elementType).toBe('div')
  })

  it('repairs a nested paragraph on its own terms', () => {
    const wrapper = element('div', [])
    const inner = element('p', [wrapper])
    const outer = element('p', [inner])

    resolveHtmlNesting(component(outer), NO_OPTIONS)

    expect(outer.content.elementType).toBe('div')
    expect(inner.content.elementType).toBe('p')
    expect(wrapper.content.elementType).toBe('span')
  })

  it('leaves a paragraph whose content is already valid untouched', () => {
    const paragraph = element('p', [
      element('span', [text('See our ')]),
      element('a', [element('span', [text('terms')])]),
    ])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(tagsOf(paragraph)).toEqual(['p', 'span', 'a', 'span'])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ignores a wrapper that a <button> puts out of paragraph scope', () => {
    // `<p><button><div/></button></p>` parses as written — the parser only
    // closes a paragraph that is in BUTTON scope.
    const wrapper = element('div', [])
    const paragraph = element('p', [element('button', [wrapper])])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.elementType).toBe('p')
    expect(wrapper.content.elementType).toBe('div')
  })

  it('does not descend into <svg>, where the HTML content model does not apply', () => {
    const svgChild = element('title', [text('Arrow')])
    const paragraph = element('p', [element('svg', [svgChild])])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(paragraph.content.elementType).toBe('p')
    expect(svgChild.content.elementType).toBe('title')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('repairs render branches of a CMS repeater against the enclosing paragraph', () => {
    const listWrapper = element('div', [])
    const emptyWrapper = element('div', [])
    const paragraph: UIDLElementNode = element('p', [
      {
        type: 'cms-list-repeater',
        content: {
          nodes: { list: listWrapper, empty: emptyWrapper },
        },
      } as never,
    ])

    resolveHtmlNesting(component(paragraph), NO_OPTIONS)

    expect(listWrapper.content.elementType).toBe('span')
    expect(emptyWrapper.content.elementType).toBe('span')
  })

  it('inspects an element passed as an attribute on its own', () => {
    const wrapper = element('div', [])
    const slotParagraph = element('p', [wrapper])
    const host = element('p', [], { attrs: { renderItem: slotParagraph } })

    resolveHtmlNesting(component(host), NO_OPTIONS)

    // The attribute tree is repaired against ITS OWN paragraph, and the host
    // paragraph is not blamed for content it never renders inline.
    expect(wrapper.content.elementType).toBe('span')
    expect(slotParagraph.content.elementType).toBe('p')
    expect(host.content.elementType).toBe('p')
  })

  it('walks element trees held in prop definitions', () => {
    const wrapper = element('div', [])
    const paragraph = element('p', [wrapper])
    const uidl = component(element('div', []))
    uidl.propDefinitions = {
      header: { type: 'element', defaultValue: paragraph },
    } as never

    resolveHtmlNesting(uidl, NO_OPTIONS)

    expect(wrapper.content.elementType).toBe('span')
  })
})
