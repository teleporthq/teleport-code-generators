import * as types from '@babel/types'
import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import { GenericUtils, PageAccess } from '@teleporthq/teleport-shared'
import { convertToServerSideProps } from '../entity-mutation-ssr-finalize-plugin'

const GUARD_IMPORT = '__tqPageAccess'
const DENIED = '__tqAccessDenied'

/**
 * The server half of page protection, per page. A page the middleware gates
 * (`PageAccess.resolvePageAccessPolicy` — its own route table) renders with
 * getServerSideProps whose first statement is
 *
 *   const __tqAccessDenied = await __tqPageAccess.guardPageAccess(context, <policy>)
 *   if (__tqAccessDenied) return __tqAccessDenied
 *
 * (`utils/auth/page-access.js`, emitted with the middleware). Its data is
 * therefore read only for a visitor the policy admits, and it never has a
 * getStaticProps: that output is a static JSON (`/_next/data/<build>/<page>.json`)
 * any visitor can fetch, and Next 12 serves it without running the middleware
 * on a site with languages. A page without a data function gets one that
 * only runs the guard; every other page comes out exactly as before.
 *
 * Registered after the getServerSideProps finalizer, so every plugin that
 * fills the 'getStaticProps' chunk by name has run.
 */
export const createPageAccessGuardPlugin: ComponentPluginFactory<Record<string, never>> = () => {
  const pageAccessGuardPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const policy = PageAccess.resolvePageAccessPolicy(uidl, options?.auth)
    if (!policy) {
      return structure
    }

    if (chunks.some((chunk) => chunk.name === 'getStaticPaths')) {
      throw new TeleportError(
        `Page "${uidl.name}" is protected but has getStaticPaths: it must render per request.`
      )
    }

    const staticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    if (staticPropsChunk && !convertToServerSideProps(staticPropsChunk)) {
      throw new TeleportError(
        `Page "${uidl.name}" is protected but its getStaticProps cannot be made per request.`
      )
    }

    let dataFunctionChunk = chunks.find((chunk) => chunk.name === 'getServerSideProps')
    if (!dataFunctionChunk) {
      const fn = types.functionDeclaration(
        types.identifier('getServerSideProps'),
        [types.identifier('context')],
        types.blockStatement([
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(types.identifier('props'), types.objectExpression([])),
            ])
          ),
        ]),
        false,
        true
      )
      dataFunctionChunk = {
        name: 'getServerSideProps',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: types.exportNamedDeclaration(fn),
        linkAfter: ['jsx-component'],
      }
      chunks.push(dataFunctionChunk)
    }

    const declaration = (dataFunctionChunk.content as types.ExportNamedDeclaration)?.declaration
    if (!declaration || declaration.type !== 'FunctionDeclaration') {
      throw new TeleportError(
        `Page "${uidl.name}" is protected but its getServerSideProps is not a function declaration.`
      )
    }
    if (declaration.params.length === 0) {
      declaration.params.push(types.identifier('context'))
    }
    const contextParam = declaration.params[0]
    if (contextParam.type !== 'Identifier') {
      throw new TeleportError(
        `Page "${uidl.name}" is protected but its getServerSideProps destructures its context.`
      )
    }

    declaration.body.body.unshift(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier(DENIED),
          types.awaitExpression(
            types.callExpression(
              types.memberExpression(
                types.identifier(GUARD_IMPORT),
                types.identifier(PageAccess.PAGE_ACCESS_GUARD_FUNCTION)
              ),
              [types.identifier(contextParam.name), types.valueToNode(policy)]
            )
          )
        ),
      ]),
      types.ifStatement(
        types.identifier(DENIED),
        types.blockStatement([types.returnStatement(types.identifier(DENIED))])
      )
    )

    dependencies[GUARD_IMPORT] = {
      type: 'local',
      path: `${GenericUtils.generatePageDependenciesPrefix({
        toPath: [...PageAccess.PAGE_ACCESS_MODULE_FOLDER],
        folderPath: uidl.outputOptions?.folderPath,
        pagesPath: options?.pagesPath,
      })}${PageAccess.PAGE_ACCESS_MODULE_NAME}`,
    }

    return structure
  }

  return pageAccessGuardPlugin
}
