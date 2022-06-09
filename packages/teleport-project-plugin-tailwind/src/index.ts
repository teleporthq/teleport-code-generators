import {
  FileType,
  PreactStyleVariation,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectType,
} from '@teleporthq/teleport-types'
import { nextJSTailwindModifier } from './next'
import { defaultTailwindModifier } from './default'
import { reactTailwindModifier } from './react'
import { vueTailwindModifier } from './vue'
import { angularTailwindModifier } from './angular'
import { nuxtTailwindModifier } from './nuxt'
import { preactTailwindModifier } from './preact'
import { stencilTailwindModifier } from './stencil'
import { createCSSPlugin, createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import { createReactAppRoutingPlugin } from '@teleporthq/teleport-plugin-react-app-routing'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

export type SUPPORTED_TAILWIND_FRAMEWORKS =
  | ProjectType.HTML
  | ProjectType.NEXT
  | ProjectType.REACT
  | ProjectType.VUE
  | ProjectType.NUXT
  | ProjectType.ANGULAR
  | ProjectType.PREACT
  | ProjectType.STENCIL

export interface TailwindPluginParams {
  structure: ProjectPluginStructure
  config: Record<string, unknown>
  css: string
  path?: string[]
}

const frameworkMap: Record<
  SUPPORTED_TAILWIND_FRAMEWORKS,
  (params: TailwindPluginParams) => Promise<void>
> = {
  [ProjectType.NEXT]: nextJSTailwindModifier,
  [ProjectType.HTML]: defaultTailwindModifier,
  [ProjectType.REACT]: reactTailwindModifier,
  [ProjectType.VUE]: vueTailwindModifier,
  [ProjectType.ANGULAR]: angularTailwindModifier,
  [ProjectType.NUXT]: nuxtTailwindModifier,
  [ProjectType.PREACT]: preactTailwindModifier,
  [ProjectType.STENCIL]: stencilTailwindModifier,
}

export class ProjectPluginTailwind implements ProjectPlugin {
  config: Record<string, unknown>
  css: string
  path: string[] | null
  framework: SUPPORTED_TAILWIND_FRAMEWORKS

  constructor(params: {
    config?: Record<string, unknown>
    css?: string
    framework?: SUPPORTED_TAILWIND_FRAMEWORKS
    path?: string[]
  }) {
    this.css = params.css
    this.css = params?.css || `@tailwind utilities;`
    this.config = params?.config || {}
    this.framework = params?.framework || ProjectType.HTML
    this.path = params?.path ?? undefined
  }

  async runBefore(structure: ProjectPluginStructure) {
    if (this.framework === ProjectType.PREACT) {
      const { strategy, rootFolder } = structure
      strategy.style = PreactStyleVariation.CSS
      const styleSheetPlugin = createStyleSheetPlugin({
        fileName: 'global-style',
      })
      const routerPlugin = createReactAppRoutingPlugin({ flavor: 'preact' })

      strategy.projectStyleSheet.plugins = [styleSheetPlugin]
      strategy.router.plugins = [routerPlugin, createCSSPlugin(), importStatementsPlugin]

      rootFolder.files.push({
        name: 'preact.config',
        fileType: FileType.JS,
        content: `export default (config, env, helpers, options) => {
    const css = helpers.getLoadersByName(config, 'css-loader')[0];
    css.loader.options.modules = false;
}`,
      })

      return structure
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const projectModifier = frameworkMap[this.framework]
    if (!projectModifier) {
      throw new Error(`Requested ${this.framework} doesn't have a predefined modifier`)
    }
    await projectModifier({ structure, config: this.config, css: this.css, path: this.path })
    return structure
  }
}
