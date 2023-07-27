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
  UIDLLocalResource,
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
  dependencies: Record<string, string>
}

export const createNextComponentInlineFetchPlugin: ComponentPluginFactory<ContextPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component', files, dependencies } = config || {}

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

      const { resource } = node.content as UIDLCMSListNodeContent | UIDLCMSItemNodeContent
      if (!resource) {
        return
      }

      const isLocalResource = 'id' in resource
      const isExternalResource = 'name' in resource

      let resourceFileName: string
      let resourceImportVariable: string
      let importPath: string
      let funcParams = ''
      let isNamedImport = false

      if (isLocalResource) {
        const { id = null, params = {} } = (resource as UIDLLocalResource) || {}
        if (!id) {
          return
        }

        const usedResource = resources.items[id]
        if (!usedResource) {
          throw new Error(`Tried to find a resource that does not exist ${id}`)
        }

        resourceImportVariable = StringUtils.dashCaseToCamelCase(
          StringUtils.camelize(`${usedResource.name}-resource`)
        )
        const importName = StringUtils.camelCaseToDashCase(usedResource.name)
        importPath = `../../resources/${importName}`

        if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'GET') {
          funcParams = 'req.query'
        }

        if (Object.keys(usedResource?.params || {}).length > 0 && usedResource.method === 'POST') {
          funcParams = 'req.body'
        }

        resourceFileName = StringUtils.camelCaseToDashCase(
          `${resourceImportVariable}-${importName}`
        )

        computeUseEffectAST({
          fileName: resourceFileName,
          resourceType: usedResource.method,
          node: node as UIDLCMSItemNode | UIDLCMSListNode,
          componentChunk,
          params,
        })
      }

      if (isExternalResource) {
        const { name, dependency } = resource
        resourceImportVariable = dependency.meta?.originalName || name
        importPath = dependency?.meta?.importAlias || dependency.path
        resourceFileName = StringUtils.camelCaseToDashCase(resource.name)
        dependencies[dependency.path] = dependency.version
        isNamedImport = dependency?.meta?.namedImport || false

        /*
          When we are calling external functions to make a request call for us.
          The `fetch` that happens behind the scenes are basically encapsulated.
          So, we can't derieve if the resource call is actually a GET / POST.
          So, we can mark these as POST by default since we are taking data from the component.
        */
        funcParams = 'req.body'
        computeUseEffectAST({
          fileName: resourceFileName,
          resourceType: 'POST',
          node: node as UIDLCMSItemNode | UIDLCMSListNode,
          componentChunk,
          params: resource.params,
        })
      }

      files.set(resourceFileName, {
        files: [
          {
            name: resourceFileName,
            fileType: FileType.JS,
            content: `import ${
              isNamedImport ? '{ ' + resourceImportVariable + ' }' : resourceImportVariable
            } from '${importPath}'

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
    })

    return structure
  }

  return nextComponentCMSFetchPlugin
}

const computeUseEffectAST = (params: {
  fileName: string
  resourceType: UIDLResourceItem['method']
  node: UIDLCMSItemNode | UIDLCMSListNode
  componentChunk: ChunkDefinition
  params: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue>
}) => {
  const { node, fileName, componentChunk, resourceType } = params
  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const { key, itemValuePath = [], valuePath = [] } = node.content
  const jsxNode = componentChunk.meta.nodesLookup[key] as types.JSXElement
  let resourcePath: types.StringLiteral | types.TemplateLiteral = types.stringLiteral(
    `/api/${fileName}`
  )

  const resourceParameters: types.ObjectProperty[] = []

  if (resourceType === 'GET' && Object.keys(params).length > 0) {
    resourcePath = types.templateLiteral(
      [
        types.templateElement({ raw: `/api/${fileName}?`, cooked: `/api/${fileName}?` }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
    )
  }

  if (resourceType === 'POST' && Object.keys(params).length > 0) {
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

  let responseExpression: types.MemberExpression

  if (node.type === 'cms-item') {
    responseExpression =
      itemValuePath.length > 0
        ? (ASTUtils.generateMemberExpressionASTFromPath([
            'data',
            ...itemValuePath,
          ]) as types.MemberExpression)
        : types.memberExpression(types.identifier('data'), types.numericLiteral(0), true)
  }

  if (node.type === 'cms-list') {
    responseExpression = ASTUtils.generateMemberExpressionASTFromPath([
      'data',
      ...valuePath,
    ]) as types.MemberExpression
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
