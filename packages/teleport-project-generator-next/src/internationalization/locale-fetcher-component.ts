import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

// This plugin is responsible for adding the locale fetcher to the getStaticProps function
// This adds getStaticProps by default to all the pages. If getStaticProps is already present, it will add the locale fetcher to it
// At the moment by default we add this fetcher to all the pages. Because, even if the page is not directly using any locales.
// What happens if one of the component that the page is using is using locales. In that case, the page will need the locales to be fetched.

const MESSAGES_IDENTIFIER = 'messages'

/** `const messages = (await import('/locales/' + context.locale + '.json')).default` */
const buildMessagesFetcherAST = () =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(MESSAGES_IDENTIFIER),
      types.memberExpression(
        types.awaitExpression(
          types.callExpression(types.import(), [
            types.binaryExpression(
              '+',
              types.binaryExpression(
                '+',
                // This path might not be correct. Check with pages that are not in the root pages folder
                types.stringLiteral('/locales' + '/'),
                types.memberExpression(types.identifier('context'), types.identifier('locale'))
              ),
              types.stringLiteral('.json')
            ),
          ])
        ),
        types.identifier('default')
      )
    ),
  ])

const isNamedObjectProperty = (
  property: types.ObjectExpression['properties'][number],
  name: string
): property is types.ObjectProperty =>
  property.type === 'ObjectProperty' &&
  property.key.type === 'Identifier' &&
  property.key.name === name

/** Node keys that hold positions or comments rather than child AST nodes. */
const SKIP_WALK_KEYS: ReadonlySet<string> = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

const NESTED_FUNCTION_TYPES: ReadonlySet<string> = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
])

/**
 * Every `return { props: {...} }` reachable from `node`, no matter how deeply it
 * sits inside try/catch or if-branches.
 *
 * A generic walk rather than an indexed lookup: by the time this plugin runs the
 * page's getStaticProps has been built and re-shaped by up to five other plugins
 * (static-props, inline-fetch, data-source, pagination, state-data-source), each
 * with its own statement order and its own catch-block return. Returns that carry
 * no `props` — `{ notFound: true }`, `{ redirect }` — are simply not collected.
 */
const collectPropsObjects = (node: unknown, found: types.ObjectExpression[] = []) => {
  if (!node || typeof node !== 'object') {
    return found
  }

  const astNode = node as Record<string, unknown> & { type?: string }

  // A nested function has `return`s of its own — a fetch callback inside a
  // `Promise.all`, for one. Only what getStaticProps itself returns is props.
  // (The walk is entered on the function BODY, so its own returns are reached
  // before any of these.)
  if (NESTED_FUNCTION_TYPES.has(astNode.type ?? '')) {
    return found
  }

  if (
    astNode.type === 'ReturnStatement' &&
    (astNode.argument as { type?: string } | undefined)?.type === 'ObjectExpression'
  ) {
    const propsProperty = (astNode.argument as types.ObjectExpression).properties.find((property) =>
      isNamedObjectProperty(property, 'props')
    ) as types.ObjectProperty | undefined

    if (propsProperty?.value.type === 'ObjectExpression') {
      found.push(propsProperty.value)
    }
  }

  for (const key of Object.keys(astNode)) {
    if (SKIP_WALK_KEYS.has(key)) {
      continue
    }

    const value = astNode[key]
    if (Array.isArray(value)) {
      value.forEach((child) => {
        if (child && typeof (child as { type?: string }).type === 'string') {
          collectPropsObjects(child, found)
        }
      })
      continue
    }

    if (value && typeof (value as { type?: string }).type === 'string') {
      collectPropsObjects(value, found)
    }
  }

  return found
}

const alreadyHasMessages = (propsObject: types.ObjectExpression) =>
  propsObject.properties.some((property) => isNamedObjectProperty(property, MESSAGES_IDENTIFIER))

export const createNextLocaleFetcherPlugin: ComponentPluginFactory<{}> = () => {
  const nextLocaleFetcher: ComponentPlugin = async (structure) => {
    const { chunks } = structure
    if (structure.options.skipI18n) {
      return structure
    }

    const jsxComponent = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (!jsxComponent) {
      return structure
    }

    const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const fetcher = buildMessagesFetcherAST()

    if (
      getStaticPropsChunk &&
      typeof getStaticPropsChunk.content === 'object' &&
      'type' in getStaticPropsChunk.content &&
      getStaticPropsChunk.content.type === 'ExportNamedDeclaration'
    ) {
      // getStaticProps was generated by another plugin (a CMS/resource fetch, a
      // data-source, pagination); merge the messages into the props it returns.
      const declaration = (getStaticPropsChunk.content as types.ExportNamedDeclaration).declaration
      if (declaration?.type !== 'FunctionDeclaration') {
        return structure
      }

      const propsObjects = collectPropsObjects(declaration.body).filter(
        (propsObject) => !alreadyHasMessages(propsObject)
      )
      if (!propsObjects.length) {
        return structure
      }

      // Hoisted ABOVE the try/catch, not into it. A page whose data fetch fails
      // still renders — several plugins' catch blocks return `{ props: {} }` —
      // and that fallback render has to be localized too, which it cannot be if
      // `messages` is scoped to the try block that just threw.
      declaration.body.body.unshift(fetcher)

      propsObjects.forEach((propsObject) => {
        propsObject.properties.unshift(
          types.objectProperty(
            types.identifier(MESSAGES_IDENTIFIER),
            types.identifier(MESSAGES_IDENTIFIER),
            false,
            true
          )
        )
      })
    } else {
      const exportChunk = types.exportNamedDeclaration(
        types.functionDeclaration(
          types.identifier('getStaticProps'),
          [types.identifier('context')],
          types.blockStatement([
            fetcher,
            types.returnStatement(
              types.objectExpression([
                types.objectProperty(
                  types.identifier('props'),
                  types.objectExpression([
                    types.objectProperty(
                      types.identifier(MESSAGES_IDENTIFIER),
                      types.identifier(MESSAGES_IDENTIFIER),
                      false,
                      true
                    ),
                    types.spreadElement(types.identifier('context')),
                  ])
                ),
              ])
            ),
          ]),
          false,
          true
        )
      )
      chunks.push({
        name: 'getStaticProps',
        type: ChunkType.AST,
        content: exportChunk,
        fileType: FileType.JS,
        linkAfter: ['jsx-component'],
      })
    }

    return structure
  }

  return nextLocaleFetcher
}
