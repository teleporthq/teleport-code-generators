import {
  UIDLCMSItemNode,
  UIDLCMSListNode,
  ChunkDefinition,
  UIDLResourceLink,
  UIDLResourceItem,
  GeneratorOptions,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import { relative } from 'path'

export const extractResourceIntoNextAPIFolder = (
  node: UIDLCMSItemNode | UIDLCMSListNode,
  resources: GeneratorOptions['resources'],
  componentChunk: ChunkDefinition,
  extractedResources: GeneratorOptions['extractedResources']
) => {
  let resourceFileName: string
  let resourceImportVariable: string
  let importPath: string
  let isNamedImport: boolean = false
  let funcParams = ''

  if ('id' in node.content.resource) {
    const usedResource = resources.items[node.content.resource.id]
    if (!usedResource) {
      throw new Error(`Tried to find a resource that does not exist ${node.content.resource.id}`)
    }

    if (
      Object.keys(node.content.resource.params).length > 0 &&
      Object.keys(usedResource.params).length > 0
    ) {
      funcParams = 'req.query'
    }

    resourceImportVariable = StringUtils.dashCaseToCamelCase(
      StringUtils.camelize(`${usedResource.name}-resource`)
    )
    const importName = StringUtils.camelCaseToDashCase(usedResource.name)
    importPath = relative(['pages', 'api'].join('/'), [...resources.path, importName].join('/'))

    resourceFileName = StringUtils.camelCaseToDashCase(`${resourceImportVariable}-${importName}`)

    computeUseEffectAST({
      fileName: resourceFileName,
      resourceType: usedResource.method,
      node,
      componentChunk,
      params: node.content.resource.params,
    })
  }

  if ('name' in node.content.resource) {
    const { name, dependency } = node.content.resource
    resourceImportVariable = dependency.meta?.originalName || name
    importPath = dependency?.meta?.importAlias || dependency.path
    resourceFileName = StringUtils.camelCaseToDashCase(node.content.resource.name)
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
      node,
      componentChunk,
      params: node.content.resource.params,
    })
  }

  extractedResources[resourceFileName] = {
    fileName: resourceFileName,
    fileType: FileType.JS,
    path: ['pages', 'api'],
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
  }
}

export const computeUseEffectAST = (params: {
  fileName: string
  resourceType: UIDLResourceItem['method']
  node: UIDLCMSItemNode | UIDLCMSListNode
  componentChunk: ChunkDefinition
  params: UIDLResourceLink['params']
}) => {
  const { node, fileName, componentChunk, resourceType } = params
  if (node.type !== 'cms-item' && node.type !== 'cms-list') {
    throw new Error('Invalid node type passed to computeUseEffectAST')
  }

  const { key, valuePath = [] } = node.content
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

  const responseExpression = ASTUtils.generateMemberExpressionASTFromPath([
    'data',
    ...valuePath,
  ]) as types.OptionalMemberExpression

  const resourceAST = types.arrowFunctionExpression(
    [types.identifier('params')],
    valuePath.length >= 0
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
