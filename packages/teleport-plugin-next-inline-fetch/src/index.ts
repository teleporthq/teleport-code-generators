import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { extractResourceIntoNextAPIFolder } from './utils'
import { join, relative } from 'path'

/*
  When defining a cms-item or cms-list in the UIDL, the user can specify a resource associated with the node.
  Usually, this resource is a local resource, and we decide here either to extract it into getStaticProps or
  directly pass it as a callback to the DataProvider.
  All the top-level API calls which don't have any dynamic references are extracted into getStaticProps,
  and the rest are passed as callbacks to the DataProvider which results in loading them at the client-side
  when the app is deployed..
*/

export const createNextPagesInlineFetchPlugin: ComponentPluginFactory<{}> = () => {
  const nextPagesInlineFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options || {}

    if (resources?.items === undefined || resources?.path === undefined) {
      return structure
    }

    let getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (componentChunk === undefined) {
      return structure
    }

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      if (node.type !== 'cms-item' && node.type !== 'cms-list') {
        return
      }

      const jsxNode = componentChunk.meta.nodesLookup[node.content.key] as types.JSXElement
      if (jsxNode === undefined || jsxNode.type !== 'JSXElement') {
        return
      }

      /*
        If a node already has a initialData on it. We don't need to do anything.
        As the node is connected with getStaticProps in the page. And the resource is
        defined inside `intialPropsData` in the UIDL for the page.
      */
      if (node.content.initialData !== undefined || node.content.resource === undefined) {
        return
      }

      const isResourceContainsAnyDynamicValues = Object.values(
        node.content.resource?.params || {}
      ).some((param) => param.type === 'expr' || param.type === 'dynamic')

      /*
        If the node is not using any dynamic stuff as parameters, it can be safely extracted.
        If the node is using purely static values as params, no matter how deep the node is nested.
        If can safely be extracted into server side getStaticProps
      */
      if (isResourceContainsAnyDynamicValues === false) {
        const propKey = StringUtils.createStateOrPropStoringValue(
          node.content.renderPropIdentifier + 'Prop'
        )
        jsxNode.openingElement.attributes.push(
          types.jsxAttribute(
            types.jsxIdentifier('initialData'),
            types.jsxExpressionContainer(
              types.memberExpression(types.identifier('props'), types.identifier(propKey))
            )
          )
        )

        jsxNode.openingElement.attributes.push(
          types.jsxAttribute(
            types.jsxIdentifier('persistDataDuringLoading'),
            types.jsxExpressionContainer(types.booleanLiteral(true))
          )
        )

        let resourceName: string
        if ('id' in node.content.resource) {
          const usedResource = resources.items[node.content.resource.id]
          resourceName = StringUtils.dashCaseToCamelCase(
            StringUtils.camelCaseToDashCase(
              StringUtils.removeIllegalCharacters(usedResource.name + 'Resource')
            )
          )
          dependencies[resourceName] = {
            type: 'local',
            path: relative(
              join(...uidl.outputOptions.folderPath, uidl.outputOptions.fileName),
              join(...resources.path, StringUtils.camelCaseToDashCase(usedResource.name))
            ),
          }
        }

        if ('name' in node.content.resource) {
          resourceName = StringUtils.dashCaseToCamelCase(
            StringUtils.camelCaseToDashCase(
              StringUtils.removeIllegalCharacters(node.content.resource.name)
            )
          )
          dependencies[node.content.resource.name] = node.content.resource.dependency
        }

        const extractedResource = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier(propKey),
            types.awaitExpression(
              types.callExpression(types.identifier(resourceName), [
                types.objectExpression([
                  types.spreadElement(
                    types.optionalMemberExpression(
                      types.identifier('context'),
                      types.identifier('params'),
                      false,
                      true
                    )
                  ),
                  ...Object.keys(node.content.resource?.params || {}).reduce(
                    (acc: types.ObjectProperty[], item) => {
                      const prop = node.content.resource.params[item]
                      acc.push(
                        types.objectProperty(
                          types.stringLiteral(item),
                          ASTUtils.resolveObjectValue(prop as UIDLStaticValue)
                        )
                      )

                      return acc
                    },
                    []
                  ),
                ]),
              ])
            )
          ),
        ])

        const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
          propKey,
          ...(node.content.valuePath || []),
        ])

        if (getStaticPropsChunk === undefined) {
          const tryBlock = types.tryStatement(
            types.blockStatement([
              extractedResource,
              types.returnStatement(
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('props'),
                    types.objectExpression([
                      types.objectProperty(
                        types.identifier(propKey),
                        responseMemberAST,
                        false,
                        false
                      ),
                    ])
                  ),
                  types.objectProperty(types.identifier('revalidate'), types.numericLiteral(60)),
                ])
              ),
            ]),
            types.catchClause(
              types.identifier('error'),
              types.blockStatement([
                types.returnStatement(
                  types.objectExpression([
                    types.objectProperty(types.identifier('props'), types.objectExpression([])),
                    types.objectProperty(types.identifier('revalidate'), types.numericLiteral(60)),
                  ])
                ),
              ])
            )
          )
          const staticPropsChunk = types.exportNamedDeclaration(
            types.functionDeclaration(
              types.identifier('getStaticProps'),
              [types.identifier('context')],
              types.blockStatement([tryBlock]),
              false,
              true
            )
          )

          getStaticPropsChunk = {
            name: 'getStaticProps',
            type: ChunkType.AST,
            fileType: FileType.JS,
            linkAfter: ['jsx-component'],
            content: staticPropsChunk,
          }

          chunks.push(getStaticPropsChunk)
        } else {
          const functionDecleration = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
            .declaration as types.FunctionDeclaration
          const functionBody = functionDecleration.body.body
          const tryBlock = functionBody.find(
            (subNode) => subNode.type === 'TryStatement'
          ) as types.TryStatement

          if (!tryBlock) {
            throw new Error(`Try block not found for getStaticProps`)
          }

          tryBlock.block.body.unshift(extractedResource)

          const returnStatement: types.ReturnStatement = tryBlock.block.body.find(
            (subNode) => subNode.type === 'ReturnStatement'
          ) as types.ReturnStatement

          if (!returnStatement) {
            throw new Error(`Failed to find return statement for getStatisProps`)
          }

          const propsObject = (returnStatement.argument as types.ObjectExpression).properties.find(
            (property) =>
              ((property as types.ObjectProperty).key as types.Identifier).name === 'props'
          ) as types.ObjectProperty

          const propsValue = propsObject.value as types.ObjectExpression
          propsValue.properties.unshift(
            types.objectProperty(types.identifier(propKey), responseMemberAST, false, false)
          )
        }
      } else {
        /*
          If a resource is not extracted, it means the data-fetch happens on the client-side.
          which in case, we need to proxy the call using /api/ route in next-js.
          So, the reosurces can take advantage of
          process.env values while accessing the actual functions from the `/resources/` folder.
        */

        extractResourceIntoNextAPIFolder(
          node,
          resources,
          componentChunk,
          options.extractedResources
        )
      }
    })

    return structure
  }

  return nextPagesInlineFetchPlugin
}

export const createNextComponentInlineFetchPlugin = () => {
  const nextComponentInlineFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, options, chunks } = structure
    const { resources } = options || {}

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (componentChunk === undefined) {
      return structure
    }

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      if (node.type !== 'cms-list' && node.type !== 'cms-item') {
        return
      }
      extractResourceIntoNextAPIFolder(node, resources, componentChunk, options.extractedResources)
    })

    return structure
  }

  return nextComponentInlineFetchPlugin
}
