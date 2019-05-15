import prettyhtml from '@starptech/prettyhtml'

import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'
import { PostProcessingFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const processor: PostProcessingFunction = (codeChunks) => {
  if (codeChunks[FILE_TYPE.HTML]) {
    const formattedCode = prettyhtml(codeChunks[FILE_TYPE.HTML], {
      wrapAttributes: true,
    })
    codeChunks[FILE_TYPE.HTML] = formattedCode.contents
  } else {
    console.warn(
      'No code chunk of type HTML found, starptech-pretty-html formatter did not perform any operation'
    )
  }
  return codeChunks
}

export default processor
