import rehype from 'rehype'
import format from 'rehype-format'

import { FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'
import { PostProcessingFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const processor: PostProcessingFunction = async (codeChunks) => {
  if (codeChunks[FILE_TYPE.HTML]) {
    const formattedHTML = await formatHTML(codeChunks[FILE_TYPE.HTML])
    codeChunks[FILE_TYPE.HTML] = String(formattedHTML)
  } else {
    console.warn('No code chunk of type HTML found, rehype formatter did not perform any operation')
  }
  return codeChunks
}

const formatHTML = (code: string) => {
  const formatter = rehype().use(format)
  return new Promise((resolve) => {
    formatter.process(code, (err, file) => {
      if (err) {
        throw new Error(`Error Occured during postprcessing phase ${err}`)
      }
      resolve(file)
    })
  })
}

export default processor
