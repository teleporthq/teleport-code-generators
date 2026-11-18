import {
  createCSSClass,
  createCSSClassWithSelector,
  createCSSClassWithMediaQuery,
  generateMediaStyle,
  generateStylesFromStyleSetDefinitions,
} from '../../src/builders/style-builders'

describe('CSS Class Generation', () => {
  it('with empty styles', () => {
    expect(createCSSClass('name', {})).toEqual('')
  })

  it('with static styles', () => {
    const result = createCSSClass('name', {
      someKey: 'value',
      otherKey: 'otherValue',
    })
    expect(result).toEqual(`.name {
  some-key: value;
  other-key: otherValue;
}`)
  })

  it('with subselectors', () => {
    const result = createCSSClassWithSelector('name', '& h1 > h2 .ab.cd #id', {
      someKey: 'value',
      otherKey: 'otherValue',
    })
    expect(result).toEqual(`.name h1 > h2 .ab.cd #id {
  some-key: value;
  other-key: otherValue;
}`)
  })

  it('attaches an ATTRIBUTE subselector with no separating space', () => {
    // ⛔ THE SELECTED-PAGE CONTRACT. A numbered pagination strip repeats one
    // authored node per visible page, so the copies cannot differ in the
    // document. Both runtimes instead mark the showing page with
    // `aria-current="page"` (`numbered-pagination.ts` here, `element-node.tsx`
    // in the canvas editor), and the LOOK is a compound project class whose
    // subselector is that attribute.
    //
    // A space before the bracket would turn this into a DESCENDANT selector —
    // `.thq-page-number [aria-current='page']` matches something INSIDE the
    // button, never the button — and the selected page would silently render
    // identically to every other one. Which is exactly the bug the marker was
    // added to fix.
    const result = createCSSClassWithSelector('thq-page-number', "&[aria-current='page']", {
      background: '#2563eb',
      fontWeight: '600',
    })
    expect(result).toEqual(`.thq-page-number[aria-current='page'] {
  background: #2563eb;
  font-weight: 600;
}`)
  })
})

describe('commas inside brackets or quotes survive selector nesting', () => {
  const styles = { color: 'red' }

  it('keeps a selector list inside :is() as authored', () => {
    expect(createCSSClassWithSelector('root', '& > a:is(.x, .y)', styles))
      .toEqual(`.root > a:is(.x, .y) {
  color: red;
}`)
  })

  it('keeps a selector list inside :not() followed by a state', () => {
    expect(createCSSClassWithSelector('root', '&:not(.a, .b):hover', styles))
      .toEqual(`.root:not(.a, .b):hover {
  color: red;
}`)
  })

  it('keeps a comma inside a quoted attribute value', () => {
    expect(createCSSClassWithSelector('root', '&[data-x="a, b"]', styles))
      .toEqual(`.root[data-x="a, b"] {
  color: red;
}`)
  })

  it('keeps commas in nested brackets, after an escaped quote and after an escaped bracket', () => {
    expect(
      createCSSClassWithSelector('root', '& a:is(.x, :not(.y, .z))[title="a\\", b"]', styles)
    ).toContain('.root a:is(.x, :not(.y, .z))[title="a\\", b"] {')
    expect(createCSSClassWithSelector('root', '& .a\\(b, .c', styles)).toContain(
      '.root .a\\(b, .root .c {'
    )
  })

  it('still gives every piece of a top-level list the parent', () => {
    expect(createCSSClassWithSelector('root', '& h1, h2', styles)).toEqual(`.root h1, .root h2 {
  color: red;
}`)
  })

  it('splits a mixed selector only on its top-level comma', () => {
    expect(createCSSClassWithSelector('root', '& h1, & h2:is(.a, .b)', styles))
      .toEqual(`.root h1, .root h2:is(.a, .b) {
  color: red;
}`)
  })

  it('leaves a selector that already holds the placeholder character untouched', () => {
    const result = createCSSClassWithSelector('root', '& a[title="\uE0C1"]:is(.x, .y)', styles)
    expect(result).toContain('\uE0C1')
    expect(result).toContain('.root a[title="\uE0C1"]:is(.x, .root .y) {')
  })

  it('never rewrites a declaration value that holds the placeholder character', () => {
    const result = createCSSClassWithSelector('root', '&::before', { content: '"\uE0C1"' })
    expect(result).toContain('content: "\uE0C1";')
  })

  it('keeps them inside a media query', () => {
    const result = createCSSClassWithMediaQuery('max-width: 767px', {
      root: { '& > a:is(.x, .y)': styles } as unknown as Record<string, string | number>,
      plain: styles,
    })
    expect(result).toContain('@media(max-width: 767px)')
    expect(result).toContain('.root > a:is(.x, .y) {')
    expect(result).toContain('.plain {')
    expect(result).not.toContain('.root .y')
  })

  it('keeps them through a project style sheet: base rule, state and screen size', () => {
    const cssMap: string[] = []
    const mediaStylesMap: Parameters<typeof generateMediaStyle>[0] = {}
    generateStylesFromStyleSetDefinitions(
      {
        links: {
          type: 'reusable-project-style-map',
          className: 'links',
          subselectors: ' > a:is(.a, .b)',
          content: { color: { type: 'static', content: 'red' } },
          conditions: [
            {
              type: 'element-state',
              meta: { state: 'hover' },
              content: { color: { type: 'static', content: 'blue' } },
            },
            {
              type: 'screen-size',
              meta: { maxWidth: 767 },
              content: { color: { type: 'static', content: 'green' } },
            },
          ],
        },
      },
      cssMap,
      mediaStylesMap,
      (name) => name
    )
    const css = [...cssMap, ...generateMediaStyle(mediaStylesMap)].join('\n')

    expect(css).toContain('.links > a:is(.a, .b) {')
    expect(css).toContain('.links > a:is(.a, .b):hover {')
    expect(css).toMatch(/@media\(max-width: 767px\) \{\s+\.links > a:is\(\.a, \.b\) \{/)
    expect(css).not.toContain('.links .b')
  })
})
