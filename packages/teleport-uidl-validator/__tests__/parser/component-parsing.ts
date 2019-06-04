// @ts-ignore
import componentInputJSON from './component-with-primitive-values.json'
// @ts-ignore
import componentResultJSON from './component-with-proper-values.json'

import { parseComponentJSON, parseProjectJSON } from '../../src/parser'

describe('parseComponentJSON', () => {
  it('transforms primitive component values', () => {
    const componentResult = parseComponentJSON(componentInputJSON)
    expect(componentResult).toEqual(componentResultJSON)
  })
})

describe('parseProjectJSON', () => {
  it('transforms primitive project values', () => {
    const componentResult = parseProjectJSON({
      root: componentInputJSON,
      components: {
        test: componentInputJSON,
      },
    })
    expect(componentResult).toEqual({
      root: componentResultJSON,
      components: {
        test: componentResultJSON,
      },
    })
  })
})
