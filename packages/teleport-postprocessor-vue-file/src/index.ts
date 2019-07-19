import { PostProcessingFunction } from '@teleporthq/teleport-types'
import {
  removeLastEmptyLine,
  addSpacesToEachLine,
} from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

const processor: PostProcessingFunction = (codeChunks) => {
  let jsCode
  let cssCode
  let htmlCode

  if (codeChunks[FILE_TYPE.HTML]) {
    htmlCode = removeLastEmptyLine(codeChunks[FILE_TYPE.HTML])
  } else {
    throw new Error('No code chunk of type HTML found, vue file concatenation aborded')
  }

  if (codeChunks[FILE_TYPE.JS]) {
    jsCode = removeLastEmptyLine(codeChunks[FILE_TYPE.JS])
  } else {
    throw new Error('No code chunk of type JS found, vue file concatenation aborded')
  }

  // if no CSS, skip the <style></style>
  if (codeChunks[FILE_TYPE.CSS]) {
    cssCode = removeLastEmptyLine(codeChunks[FILE_TYPE.CSS])
  }

  const formattedHTMLCode = addSpacesToEachLine(' '.repeat(2), htmlCode)
  const vueCode = buildVueFile(formattedHTMLCode, jsCode, cssCode)

  return {
    [FILE_TYPE.VUE]: vueCode,
  }
}

export default processor

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
