import { PostProcessor, FileType } from '@teleporthq/teleport-types'
import {
  removeLastEmptyLine,
  addSpacesToEachLine,
} from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

export const createPostProcessor = () => {
  const processor: PostProcessor = (codeChunks) => {
    let jsCode
    let cssCode
    let htmlCode

    if (codeChunks[FileType.HTML]) {
      htmlCode = removeLastEmptyLine(codeChunks[FileType.HTML])
    } else {
      throw new Error('No code chunk of type HTML found, vue file concatenation aborded')
    }

    if (codeChunks[FileType.JS]) {
      jsCode = removeLastEmptyLine(codeChunks[FileType.JS])
    } else {
      throw new Error('No code chunk of type JS found, vue file concatenation aborded')
    }

    // if no CSS, skip the <style></style>
    if (codeChunks[FileType.CSS]) {
      cssCode = removeLastEmptyLine(codeChunks[FileType.CSS])
    }

    const formattedHTMLCode = addSpacesToEachLine(' '.repeat(2), htmlCode)
    const vueCode = buildVueFile(formattedHTMLCode, jsCode, cssCode)

    return {
      [FileType.VUE]: vueCode,
    }
  }

  return processor
}

export default createPostProcessor()

export const buildVueFile = (htmlCode: string, jsCode: string, cssCode: string) => {
  let code = `<template>
${htmlCode}
</template>

<script>
${jsCode}
</script>
`

  if (cssCode) {
    code += `
<style scoped>
${cssCode}
</style>
`
  }

  return code
}
