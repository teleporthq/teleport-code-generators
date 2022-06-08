import { ProjectPlugin, ProjectPluginStructure, ProjectType } from '@teleporthq/teleport-types'
import { nextJSTailwindModifier } from './next'
import { defaultTailwindModifier } from './default'
import { reactTailwindModifier } from './react'
import { vueTailwindModifier } from './vue'
import { angularTailwindModifier } from './angular'
import { nuxtTailwindModifier } from './nuxt'

export type SUPPORTED_TAILWIND_FRAMEWORKS =
  | ProjectType.HTML
  | ProjectType.NEXT
  | ProjectType.REACT
  | ProjectType.VUE
  | ProjectType.NUXT
  | ProjectType.ANGULAR

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
