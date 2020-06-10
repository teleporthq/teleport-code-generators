import {
  FrameWorkConfigOptions,
  ChunkDefinition,
  FileType,
  ChunkType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
// @ts-ignore
export const configContentGenerator = (options: FrameWorkConfigOptions, t = types) => {
  const content: unknown[] = []
  content.push(
    t.exportDefaultDeclaration(
      t.functionDeclaration(
        null,
        [
          t.identifier('Vue'),
          t.objectPattern([
            t.objectProperty(t.identifier('router'), t.identifier('router')),
            t.objectProperty(t.identifier('head'), t.identifier('head')),
            t.objectProperty(t.identifier('isClient'), t.identifier('isClient')),
          ]),
        ],
        t.blockStatement([])
      )
    )
  )

  if (options.globalStyles && options.globalStyles?.isGlobalStylesDependent) {
    content.unshift(
      t.importDeclaration(
        [],
        t.stringLiteral(
          `~/${options.globalStyles.path}/${options.globalStyles.sheetName}.${FileType.CSS}`
        )
      )
    )
  }

  const chunk: ChunkDefinition = {
    type: ChunkType.AST,
    name: 'config-chunk',
    fileType: FileType.JS,
    content,
    linkAfter: [],
  }

  return {
    chunks: {
      [FileType.JS]: [chunk],
    },
    dependencies: options.dependencies,
  }
}
