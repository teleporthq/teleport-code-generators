import processor from '../src'

describe('vue file concat', () => {
  it('returns a single vue code chunk', async () => {
    const inputChunks = {
      html: `<div><span>Format me!</span></div>
`,
      js: `export default {}
`,
      css: `.button { margin: 10px; }
`,
    }

    const result = await processor(inputChunks)

    expect(result.html).toBeUndefined()
    expect(result.js).toBeUndefined()
    expect(result.css).toBeUndefined()
    expect(result.vue).toBe(`<template>
  <div><span>Format me!</span></div>
</template>

<script>
export default {}
</script>

<style>
.button { margin: 10px; }
</style>
`)
  })

  it('skips the style section if it doesn`t exist', async () => {
    const inputChunks = {
      html: `<div><span>Format me!</span></div>
`,
      js: `export default {}
`,
    }

    const result = await processor(inputChunks)

    expect(result.html).toBeUndefined()
    expect(result.js).toBeUndefined()
    expect(result.css).toBeUndefined()
    expect(result.vue).toBe(`<template>
  <div><span>Format me!</span></div>
</template>

<script>
export default {}
</script>
`)
  })

  it('throws an error if no HTML chunk is provided', async () => {
    const inputChunks = {
      js: `export default {}
`,
    }

    expect(processor(inputChunks)).rejects.toThrowError('HTML')
  })

  it('throws an error if no HTML chunk is provided', () => {
    const inputChunks = {
      html: `<div><span>Format me!</span></div>
`,
    }

    expect(processor(inputChunks)).rejects.toThrowError('JS')
  })
})
