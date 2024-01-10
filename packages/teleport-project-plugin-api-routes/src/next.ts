import { CodeGenerator } from '@babel/generator'
import { FileType, ProjectPluginStructure, UIDLResourceItem } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import * as types from '@babel/types'
import path from 'path'

export const nextBeforeModifier = async (structure: ProjectPluginStructure) => {
  const { projectResources, strategy, uidl, files } = structure

  if (strategy.id !== 'teleport-project-next' || !strategy?.resources?.path) {
    throw new Error('Plugin can be used only with teleport-project-next')
  }

  const { items = {} } = uidl.resources || {}
  Object.keys(items).forEach((key) => {
    const resource = items[key]

    const apiRouteContentAST = buildApiRouteAST(resource)
    const babelGenerator = new CodeGenerator(apiRouteContentAST, { jsescOption: { minimal: true } })
    const content = prettierJS({
      [FileType.JS]: babelGenerator.generate().code,
    })

    const fileName = StringUtils.camelize(resource.name)

    projectResources[key] = {
      path: path.join(...strategy.resources.path, fileName),
      fileName,
    }

    files.set(key, {
      path: strategy.resources.path,
      files: [
        {
          name: fileName,
          fileType: FileType.JS,
          content: content[FileType.JS],
        },
      ],
    })
  })
  return
}

export const nextAfterModifier = async () => {
  return
}

const buildApiRouteAST = (resource: UIDLResourceItem) => {
  const resourceASTs = ASTUtils.generateRemoteResourceASTs(resource)
  return types.exportDefaultDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('handler'),
        [types.identifier('req'), types.identifier('res')],
        types.blockStatement([
          types.tryStatement(
            types.blockStatement([
              ...resourceASTs,
              types.returnStatement(
                types.callExpression(
                  types.memberExpression(
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('res'),
                        types.identifier('status'),
                        false
                      ),
                      [types.numericLiteral(200)]
                    ),
                    types.identifier('json'),
                    false
                  ),
                  [types.identifier('response')]
                )
              ),
            ]),
            types.catchClause(
              types.identifier('error'),
              types.blockStatement([
                types.returnStatement(
                  types.callExpression(
                    types.memberExpression(
                      types.callExpression(
                        types.memberExpression(
                          types.identifier('res'),
                          types.identifier('status'),
                          false
                        ),
                        [types.numericLiteral(500)]
                      ),
                      types.identifier('send'),
                      false
                    ),
                    [types.stringLiteral('Something went wrong')]
                  )
                ),
              ])
            )
          ),
        ]),
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}
