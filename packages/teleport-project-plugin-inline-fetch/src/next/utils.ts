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
  UIDLExpressionValue,
  UIDLNode,
  UIDLPropValue,
  UIDLResourceItem,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

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

      const { resource: { id = null, params = {} } = {} } = node.content as
        | UIDLCMSListNodeContent
        | UIDLCMSItemNodeContent

      if (!id) {
        return
      }

      const usedResource = resources.items[id]
      if (!usedResource) {
        throw new Error(`Tried to find a resource that does not exist ${id}`)
      }

      /*
        Identifier that imports the module.
        import '...' from 'resoruce'
      */
      const resourceImportVariable = StringUtils.dashCaseToCamelCase(
        StringUtils.camelize(`${usedResource.name}-resource`)
      )

      /*
        Idenfitier that points to the actual resource path
        import resoruce from '....'
      */
      const importName = StringUtils.camelCaseToDashCase(usedResource.name)
      let funcParams = ''

      if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'GET') {
        funcParams = 'req.query'
      }

      if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'POST') {
        funcParams = 'req.body'
      }

      /*
        Identifier that defines the route name and the file name.
        Because each file name defines a individual API
      */
      const resourceFileName = StringUtils.camelCaseToDashCase(
        `${resourceImportVariable}-${importName}`
      )

      files.set(resourceFileName, {
        files: [
          {
            name: resourceFileName,
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
        fileName: resourceFileName,
        resource: usedResource,
        node: node as UIDLCMSItemNode | UIDLCMSListNode,
        componentChunk,
        params,
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
  params: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue>
}) => {
  const { node, fileName, componentChunk, resource } = params
  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const { key, itemValuePath = [], valuePath = [] } = node.content
  const jsxNode = componentChunk.meta.nodesLookup[key] as types.JSXElement
  let resourcePath: types.StringLiteral | types.TemplateLiteral = types.stringLiteral(
    `/api/${fileName}`
  )

  const resourceParameters: types.ObjectProperty[] = []

  if (resource.method === 'GET' && Object.keys(params).length > 0) {
    resourcePath = types.templateLiteral(
      [
        types.templateElement({ raw: `/api/${fileName}?`, cooked: `/api/${fileName}?` }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
    )
  }

  if (resource.method === 'POST' && Object.keys(params).length > 0) {
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

  const fetchAST = types.callExpression(
    types.memberExpression(
      types.callExpression(
        types.identifier('fetch'),
        [resourcePath, types.objectExpression([headers, ...resourceParameters])].filter(Boolean)
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

  let responseExpression: types.OptionalMemberExpression

  if (node.type === 'cms-item') {
    responseExpression =
      itemValuePath.length > 0
        ? (ASTUtils.generateMemberExpressionASTFromPath([
            'data',
            ...itemValuePath,
          ]) as types.OptionalMemberExpression)
        : types.optionalMemberExpression(
            types.memberExpression(types.identifier('data'), types.identifier('data'), false),
            types.numericLiteral(0),
            true,
            true
          )
  }

  if (node.type === 'cms-list') {
    responseExpression = ASTUtils.generateMemberExpressionASTFromPath([
      'data',
      ...valuePath,
    ]) as types.OptionalMemberExpression
  }

  const resourceAST = types.arrowFunctionExpression(
    [types.identifier('params')],
    valuePath.length || itemValuePath.length >= 0
      ? types.callExpression(types.memberExpression(fetchAST, types.identifier('then'), false), [
          types.arrowFunctionExpression([types.identifier('data')], responseExpression),
        ])
      : fetchAST
  )

  jsxNode.openingElement.attributes.unshift(
    types.jSXAttribute(types.jsxIdentifier('fetchData'), types.jsxExpressionContainer(resourceAST))
  )

  return
}

export default createNextComponentInlineFetchPlugin()
