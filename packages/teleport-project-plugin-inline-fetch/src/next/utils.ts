import {
  ChunkDefinition,
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  InMemoryFileRecord,
  UIDLCMSItemNode,
  UIDLCMSItemNodeContent,
  UIDLCMSListNode,
  UIDLCMSListNodeContent,
  UIDLLocalResource,
  UIDLNode,
  UIDLResourceItem,
  UIDLResourceLink,
} from '@teleporthq/teleport-types'
import { GenericUtils, StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { FilteredResource } from '.'

interface ContextPluginConfig {
  componentChunkName?: string
  files: Map<string, InMemoryFileRecord>
  dependencies: Record<string, string>
  extractedResources: Record<string, FilteredResource>
  paths: {
    resources: string[]
    pages: string[]
  }
}

export const createNextComponentInlineFetchPlugin: ComponentPluginFactory<ContextPluginConfig> = (
  config
) => {
  const {
    componentChunkName = 'jsx-component',
    files,
    dependencies: globalDependencies,
    extractedResources,
    paths,
  } = config || {}

  const nextComponentCMSFetchPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options

    const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const extractedResourceDeclerations: Record<string, types.VariableDeclaration> = {}

    UIDLUtils.traverseNodes(uidl.node, (node) => {
      const { type, content } = node as UIDLNode
      if (type !== 'cms-list' && type !== 'cms-item') {
        return
      }

      const { resource } = node.content as UIDLCMSListNodeContent | UIDLCMSItemNodeContent
      if (!resource) {
        return
      }

      const propKey = StringUtils.createStateOrPropStoringValue(
        content.renderPropIdentifier + 'Prop'
      )

      if (extractedResources[propKey]) {
        const extractedResource = extractedResources[propKey]
        let resourceName: string
        let dependencyPath: string

        if ('id' in extractedResource) {
          resourceName = StringUtils.dashCaseToCamelCase(
            StringUtils.camelCaseToDashCase(resources.items[extractedResource.id].name + 'Resource')
          )
          const resourcesPath = paths.resources
          const currentPagePath = [...paths.pages, ...uidl.outputOptions.folderPath]
          dependencyPath =
            GenericUtils.generateLocalDependenciesPrefix(currentPagePath, resourcesPath) +
            StringUtils.camelCaseToDashCase(resources.items[extractedResource.id].name)

          dependencies[resourceName] = {
            type: 'local',
            path: dependencyPath,
          }
        }

        if ('name' in extractedResource) {
          resourceName = extractedResource.name
          dependencies[resourceName] = extractedResource.dependency
        }

        extractedResourceDeclerations[propKey] = types.variableDeclaration('const', [
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
                  ...Object.keys(extractedResource?.params || {}).reduce(
                    (acc: types.ObjectProperty[], item) => {
                      const prop = extractedResource.params[item]
                      acc.push(
                        types.objectProperty(
                          types.stringLiteral(item),
                          ASTUtils.resolveObjectValue(prop)
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
        return
      }

      let resourceFileName: string
      let resourceImportVariable: string
      let importPath = '../../resources/'
      let funcParams = ''
      let isNamedImport = false

      if ('id' in resource) {
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
        importPath = importPath + importName

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

      if ('name' in resource) {
        const { name, dependency } = resource
        resourceImportVariable = dependency.meta?.originalName || name
        importPath = dependency?.meta?.importAlias || dependency.path
        resourceFileName = StringUtils.camelCaseToDashCase(resource.name)
        globalDependencies[dependency.path] = dependency.version
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

    const declerations = Object.values(extractedResourceDeclerations)
    if (declerations.length > 0) {
      /*
        For listing and details pages, the getStaticProps function is already defined.
        So we just inject the newly extracted resource declerations into it.

        For other instances, we decleare a new getStaticProps function
      */
      if (getStaticPropsChunk) {
        const functionDecleration = (getStaticPropsChunk.content as types.ExportNamedDeclaration)
          .declaration as types.FunctionDeclaration
        const functionBody = functionDecleration.body.body
        const tryBlock = functionBody.find(
          (node) => node.type === 'TryStatement'
        ) as types.TryStatement

        if (!tryBlock) {
          throw new Error(`Try block not found for getStaticProps`)
        }

        tryBlock.block.body.unshift(...declerations)

        const returnStatement: types.ReturnStatement = tryBlock.block.body.find(
          (node) => node.type === 'ReturnStatement'
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
          ...computeResponseObjectForExtractedResources(
            extractedResourceDeclerations,
            extractedResources
          )
        )
      } else {
        const tryBlock = types.tryStatement(
          types.blockStatement([
            ...declerations,
            types.returnStatement(
              types.objectExpression([
                types.objectProperty(
                  types.identifier('props'),
                  types.objectExpression(
                    computeResponseObjectForExtractedResources(
                      extractedResourceDeclerations,
                      extractedResources
                    )
                  )
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
                  types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
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

        chunks.push({
          name: 'getStaticProps',
          type: ChunkType.AST,
          fileType: FileType.JS,
          linkAfter: ['jsx-component'],
          content: staticPropsChunk,
        })
      }
    }

    return structure
  }

  return nextComponentCMSFetchPlugin
}

const computeResponseObjectForExtractedResources = (
  extractedResourceDeclerations: Record<string, types.VariableDeclaration>,
  extractedResources: Record<string, FilteredResource>
) => {
  return Object.keys(extractedResourceDeclerations).map((key) => {
    const extractedResource = extractedResources[key]

    let responseMemberAST: types.Identifier | types.OptionalMemberExpression

    if (extractedResource?.itemValuePath?.length) {
      responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
        key,
        ...(extractedResource.itemValuePath || []),
      ])
    }

    if (extractedResource?.valuePath?.length >= 0) {
      responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
        key,
        ...(extractedResource.valuePath || []),
      ])
    }

    if (!responseMemberAST) {
      throw new Error(`Both itemValuePath and valuePath are missing.
Please check the UIDL \n ${JSON.stringify(extractedResource, null, 2)}`)
    }

    const dataWeNeedAccessorAST = extractedResource?.itemValuePath?.length
      ? types.optionalMemberExpression(responseMemberAST, types.numericLiteral(0), true, true)
      : responseMemberAST

    return types.objectProperty(types.identifier(key), dataWeNeedAccessorAST, false, false)
  })
}

const computeUseEffectAST = (params: {
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

  let responseExpression: types.OptionalMemberExpression

  if (node.type === 'cms-item') {
    responseExpression = types.optionalMemberExpression(
      ASTUtils.generateMemberExpressionASTFromPath([
        'data',
        ...itemValuePath,
      ]) as types.OptionalMemberExpression,
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
