import { PostProcessingFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import {
  removeLastEmptyLine,
  addSpacesToEachLine,
} from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'
import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'

const processor: PostProcessingFunction = (codeChunks) => {
  // TODO: console.warn / skip
  const jsCode = removeLastEmptyLine(codeChunks[FILE_TYPE.JS])
  const cssCode = removeLastEmptyLine(codeChunks[FILE_TYPE.CSS])
  const htmlCode = removeLastEmptyLine(codeChunks[FILE_TYPE.HTML])

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
<style>
${cssCode}
</style>
`
  }

  return code
}
