import processor from '../src'

describe('prettier ts', () => {
  it('formats only the ts chunk', () => {
    const inputChunks = {
      html: `<div><span >Format me!</span>  </div>`,
      ts: `import React from "react"; import {Link} from "react-router"`,
    }

    const result = processor(inputChunks)

    expect(result.html).toBe(inputChunks.html)
    expect(result.ts).toBe(`import React from 'react'
import { Link } from 'react-router'
`)
  })

  it('skips formatting if no ts chunk is found', () => {
    const inputChunks = {
      css: '.test { margin: 10px; }',
      html: `<div><span >Format me!</span>  </div>`,
    }

    const result = processor(inputChunks)

    expect(result.css).toBe(inputChunks.css)
    expect(result.html).toBe(inputChunks.html)
  })
})
