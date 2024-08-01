import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as types from '@babel/types'

export const createStaticPropslogsPlugin: ComponentPluginFactory<{}> = () => {
  const staticPropsLogsPlugin: ComponentPlugin = async (structure) => {
    const { chunks } = structure

    const staticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    if (staticPropsChunk === undefined) {
      return structure
    }
    const ast = staticPropsChunk.content as types.Node
    if (ast.type !== 'ExportNamedDeclaration') {
      return structure
    }

    const code = generate(types.program([ast])).code
    const parsedAST = parse(code, { sourceType: 'module' })

    traverse(parsedAST, {
      ObjectProperty(objectAst) {
        if (objectAst.node.value.type === 'OptionalMemberExpression') {
          objectAst.node.value = types.logicalExpression(
            '??',
            objectAst.node.value,
            types.objectExpression([])
          )
        }
      },
      BlockStatement(blockAst) {
        if (blockAst.parent.type === 'CatchClause') {
          blockAst.node.body = [
            types.expressionStatement(
              types.callExpression(types.identifier('console.trace'), [
                types.stringLiteral('Error:'),
                types.identifier('error'),
              ])
            ),
            ...blockAst.node.body,
          ]
        }
      },
      VariableDeclarator(variableAst) {
        if (
          variableAst.node.init.type === 'AwaitExpression' &&
          variableAst.node.id.type === 'Identifier' &&
          variableAst.parentPath.parentPath.node.type === 'BlockStatement'
        ) {
          const returnStatementIndex = variableAst.parentPath.parentPath.node.body.findIndex(
            (node) => node.type === 'ReturnStatement'
          )
          variableAst.parentPath.parentPath.node.body.splice(
            returnStatementIndex,
            0,
            types.expressionStatement(
              types.callExpression(types.identifier('console.log'), [
                types.identifier(variableAst.node.id.name),
              ])
            )
          )
        }
      },
    })

    structure.chunks = [
      ...chunks.filter((chunk) => chunk.name !== 'getStaticProps'),
      {
        ...staticPropsChunk,
        content: parsedAST.program.body[0],
      },
    ]

    return structure
  }

  return staticPropsLogsPlugin
}
