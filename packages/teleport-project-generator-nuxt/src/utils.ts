import {
  FrameWorkConfigOptions,
  ChunkDefinition,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const configContentGenerator = (options: FrameWorkConfigOptions, t = types) => {
  const result = {
    chunks: {},
    dependencies: options.dependencies,
  }

  if (options.globalStyles.isGlobalStylesDependent) {
    const content = types.exportDefaultDeclaration(
      t.objectExpression([
        t.objectProperty(
          t.identifier(FileType.CSS),
          t.arrayExpression([
            t.templateLiteral(
              [
                t.templateElement({
                  raw: `~/${options.globalStyles.sheetName}.${FileType.CSS}`,
                  cooked: `~/${options.globalStyles.sheetName}.${FileType.CSS}`,
                }),
              ],
              []
            ),
          ])
        ),
      ])
    )

    const chunk: ChunkDefinition = {
      type: ChunkType.AST,
      name: 'config-chunk',
      fileType: FileType.JS,
      content,
      linkAfter: [],
    }

    result.chunks = {
      [FileType.JS]: [chunk],
    }
  }

  return result
}
