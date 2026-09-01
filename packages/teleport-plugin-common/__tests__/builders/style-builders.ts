import { createCSSClass, createCSSClassWithSelector } from '../../src/builders/style-builders'

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
