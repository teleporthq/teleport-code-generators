import processor from '../src'

describe('prettier html', () => {
  it('formats only the html chunk', async () => {
    const inputChunks = {
      html: `<div><span >Format me!</span> 
  </div>`,
      js: `import React from "react"; import {Link} from "react-router"`,
    }

    const result = await processor(inputChunks)

    expect(result.html).toBe('<div><span>Format me!</span></div>\n')
    expect(result.js).toBe(inputChunks.js)
  })

  it('skips formatting if no html chunk is found', async () => {
    const inputChunks = {
      css: '.test { margin: 10px; }',
      js: `import React from "react"; import {Link} from "react-router"`,
    }

    const result = await processor(inputChunks)

    expect(result.css).toBe(inputChunks.css)
    expect(result.js).toBe(inputChunks.js)
  })
})
