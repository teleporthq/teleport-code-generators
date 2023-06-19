import {
  ChunkDefinition,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  InMemoryFileRecord,
  UIDLCMSItemNode,
  UIDLCMSItemNodeContent,
  UIDLCMSListNode,
  UIDLCMSListNodeContent,
  UIDLNode,
  UIDLResourceItem,
} from '@teleporthq/teleport-types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'

interface ContextPluginConfig {
  componentChunkName?: string
  files: Map<string, InMemoryFileRecord>
}

export const createNextComponentInlineFetchPlugin: ComponentPluginFactory<ContextPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component', files } = config || {}

  const nextComponentCMSFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { resources } = options

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      const { type } = node as UIDLNode
      if (type !== 'cms-list' && type !== 'cms-item') {
        return
      }

      const content = node.content as UIDLCMSListNodeContent | UIDLCMSItemNodeContent
      if (!content?.resource?.id) {
        return
      }

      const usedResource = resources.items[content.resource.id]
      if (!usedResource) {
        throw new Error(`Tried to find a resource that does not exist ${content.resource.id}`)
      }

      const resourceImportVariable = StringUtils.dashCaseToCamelCase(
        StringUtils.camelize(`${usedResource.name}-reource`)
      )
      const importName = StringUtils.camelCaseToDashCase(usedResource.name)
      const resouceFileName = StringUtils.camelCaseToDashCase(resourceImportVariable)
      let funcParams = ''

      if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'GET') {
        funcParams = 'req.query'
      }

      if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'POST') {
        funcParams = 'req.body'
      }

      files.set(resourceImportVariable, {
        files: [
          {
            name: resouceFileName,
            fileType: FileType.JS,
            content: `import ${resourceImportVariable} from '../../resources/${importName}'

export default async function handler(req, res) {
  try {
    const response = await ${resourceImportVariable}(${funcParams})
    return res.status(200).json(response)
  } catch (error) {
    return res.status(500).send('Something went wrong')
  }
}
`,
          },
        ],
        path: ['pages', 'api'],
      })

      computeUseEffectAST({
        fileName: resouceFileName,
        resource: usedResource,
        node: node as UIDLCMSItemNode | UIDLCMSListNode,
        componentChunk,
      })
    })

    return structure
  }

  return nextComponentCMSFetchPlugin
}

const computeUseEffectAST = (params: {
  fileName: string
  resource: UIDLResourceItem
  node: UIDLCMSItemNode | UIDLCMSListNode
  componentChunk: ChunkDefinition
}) => {
  const { node, fileName, componentChunk, resource } = params
  const { key, attrs = {}, itemValuePath } = node.content
  const jsxNode = componentChunk.meta.nodesLookup[key] as types.JSXElement
  let resourcePath: types.StringLiteral | types.TemplateLiteral = types.stringLiteral(
    `/api/${fileName}`
  )

  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const resourceParameters: types.ObjectProperty[] = []

  if (resource.method === 'GET' && Object.keys(attrs).length > 0) {
    resourcePath = types.templateLiteral(
      [
        types.templateElement({ raw: `/api/${fileName}?`, cooked: `/api/${fileName}?` }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
    )
  }

  if (resource.method === 'POST' && Object.keys(attrs).length > 0) {
    resourceParameters.push(
      types.objectProperty(types.identifier('method'), types.stringLiteral('POST')),
      types.objectProperty(
        types.identifier('body'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.identifier('params')]
        )
      )
    )
  }

  const headers = types.objectProperty(
    types.identifier('headers'),
    types.objectExpression([
      types.objectProperty(
        types.stringLiteral('Content-Type'),
        types.stringLiteral('application/json')
      ),
    ])
  )

  /*
    For NextJS projects, we wrap the direct CMS calls with a `/api`
    from Next. So, the return type is always going to be `json`. We can safely
    set the return type to `.json()`. Because the actual return type is handled
    in the resource itself. `/api/resource/resource.js`
  */

  const resourceAST = types.arrowFunctionExpression(
    [types.identifier('params')],
    types.callExpression(
      types.memberExpression(
        node.type === 'cms-item' && itemValuePath.length >= 0
          ? types.callExpression(
              types.memberExpression(
                types.callExpression(
                  types.identifier('fetch'),
                  [resourcePath, types.objectExpression([headers, ...resourceParameters])].filter(
                    Boolean
                  )
                ),
                types.identifier('then')
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('res')],
                  types.callExpression(
                    types.memberExpression(types.identifier('res'), types.identifier('json')),
                    []
                  )
                ),
              ]
            )
          : types.callExpression(
              types.identifier('fetch'),
              [resourcePath, types.objectExpression([headers, ...resourceParameters])].filter(
                Boolean
              )
            ),
        types.identifier('then')
      ),
      node.type === 'cms-item' && itemValuePath.length >= 0
        ? [
            types.arrowFunctionExpression(
              [types.identifier('data')],
              types.memberExpression(
                types.identifier('data'),
                itemValuePath.length > 0
                  ? types.identifier((node.content.itemValuePath || []).join('.'))
                  : types.numericLiteral(0),
                true
              )
            ),
          ]
        : [
            types.arrowFunctionExpression(
              [types.identifier('res')],
              types.callExpression(
                types.memberExpression(types.identifier('res'), types.identifier('json')),
                []
              )
            ),
          ]
    )
  )

  jsxNode.openingElement.attributes.push(
    types.jSXAttribute(types.jsxIdentifier('fetcher'), types.jsxExpressionContainer(resourceAST))
  )

  return
}

export default createNextComponentInlineFetchPlugin()
