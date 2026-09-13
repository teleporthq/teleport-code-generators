import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import { StringUtils, GenericUtils } from '@teleporthq/teleport-shared'
import { RouteUtils } from '@teleporthq/teleport-plugin-common'
import { generateInitialPropsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

const { isDynamicRoute, pageHasSameTableMutationWorkflow } = RouteUtils

export const createStaticPropsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPropsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options, dependencies } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPropsData) {
      return structure
    }

    // Entity-bound dynamic-route pages (edit-item/[id], view-item/[id], ...)
    // that ALSO have a same-page workflow writing to the same table render
    // with getServerSideProps instead of getStaticProps+ISR — see
    // `pageHasSameTableMutationWorkflow`'s doc in
    // `teleport-plugin-common/src/utils/route-utils.ts` and
    // `generateInitialPropsAST`'s `useServerSideProps` doc for the rationale.
    // Pages with no such mutation (a read-only details page) or no dynamic
    // route (a static "Add Item" create form) keep getStaticProps: they
    // carry no per-row staleness risk.
    const useServerSideProps =
      isDynamicRoute(uidl) && pageHasSameTableMutationWorkflow(uidl, options.workflows)

    const { resource } = uidl?.outputOptions?.initialPropsData

    const isLocalResource = 'id' in resource
    const isExternalResource = 'name' in resource
    /*
      Name of the function that is being imported
    */
    let resourceImportName

    if (isLocalResource) {
      const usedResource = resources.items?.[resource.id]
      if (!usedResource) {
        throw new TeleportError(
          `Resource ${resource.id} is being used, but missing from the project ressources. Check ${uidl.name} in UIDL for more information`
        )
      }

      resourceImportName = StringUtils.dashCaseToCamelCase(
        StringUtils.camelCaseToDashCase(usedResource.name + 'Resource')
      )

      dependencies[resourceImportName] = {
        type: 'local',
        path: `${GenericUtils.generatePageDependenciesPrefix({
          toPath: resources.path,
          folderPath: uidl.outputOptions.folderPath,
          pagesPath: options.pagesPath,
        })}${StringUtils.camelCaseToDashCase(usedResource.name)}`,
      }
    }

    if (isExternalResource) {
      dependencies[resource.name] = resource.dependency
      resourceImportName = resource.name
    }

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsData,
      resourceImportName,
      resources.cache,
      options.skipI18n,
      useServerSideProps
    )

    // NOTE: the chunk is always registered under the 'getStaticProps' name
    // (regardless of useServerSideProps) — several other page plugins that
    // run LATER in the pipeline (data-source, inline-fetch, pagination) look
    // up / merge additional fetches into this chunk by that literal name.
    // Only the emitted FUNCTION IDENTIFIER inside `getStaticPropsAST` differs
    // (getServerSideProps vs getStaticProps, see generateInitialPropsAST) —
    // renaming the chunk itself would make every later plugin's lookup miss
    // and spawn a second, conflicting getStaticProps function on the same
    // page. `entity-mutation-ssr-finalize-plugin.ts` (registered last in the
    // page pipeline) renames this chunk's name/identifier to
    // getServerSideProps and strips any revalidate the later plugins added,
    // once no further plugin needs to find it by its original name.
    chunks.push({
      name: 'getStaticProps',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: getStaticPropsAST,
      linkAfter: [componentChunkName],
      meta: useServerSideProps ? { useServerSideProps: true } : undefined,
    })

    return structure
  }

  return staticPropsPlugin
}

export default createStaticPropsPlugin()
