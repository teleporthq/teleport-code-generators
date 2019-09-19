import { PostProcessor, FileType } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const createPostProcessor = () => {
  const processor: PostProcessor = (codeChunks) => {
    let jsCode
    let cssCode
    let htmlCode

    if (codeChunks[FileType.HTML]) {
      htmlCode = StringUtils.removeLastEmptyLine(codeChunks[FileType.HTML])
    } else {
      throw new Error('No code chunk of type HTML found, vue file concatenation aborded')
    }

    if (codeChunks[FileType.JS]) {
      jsCode = StringUtils.removeLastEmptyLine(codeChunks[FileType.JS])
    } else {
      throw new Error('No code chunk of type JS found, vue file concatenation aborded')
    }

    // if no CSS, skip the <style></style>
    if (codeChunks[FileType.CSS]) {
      cssCode = StringUtils.removeLastEmptyLine(codeChunks[FileType.CSS])
    }

    const formattedHTMLCode = StringUtils.addSpacesToEachLine(' '.repeat(2), htmlCode)
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
