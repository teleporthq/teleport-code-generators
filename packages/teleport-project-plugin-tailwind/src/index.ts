import { ProjectPlugin, ProjectPluginStructure, ProjectType } from '@teleporthq/teleport-types'
import { nextJSTailwindModifier } from './nextjs'
import { defaultTailwindModifier } from './default'
import { reactTailwindModifier } from './react'
import { vueTailwindModifier } from './vue'
import { angularTailwindModifier } from './angular'

type SUPPORTED_FRAMEWORKS =
  | ProjectType.HTML
  | ProjectType.NEXT
  | ProjectType.REACT
  | ProjectType.VUE
  | ProjectType.ANGULAR

const frameworkMap: Record<
  SUPPORTED_FRAMEWORKS,
  (structure: ProjectPluginStructure, config: Record<string, unknown>, css: string) => Promise<void>
> = {
  [ProjectType.NEXT]: nextJSTailwindModifier,
  [ProjectType.HTML]: defaultTailwindModifier,
  [ProjectType.REACT]: reactTailwindModifier,
  [ProjectType.VUE]: vueTailwindModifier,
  [ProjectType.ANGULAR]: angularTailwindModifier,
}

export class ProjectPluginTailwind implements ProjectPlugin {
  config: Record<string, unknown>
  css: string
  framework: SUPPORTED_FRAMEWORKS

  constructor(params: {
    config?: Record<string, unknown>
    css?: string
    framework?: SUPPORTED_FRAMEWORKS
  }) {
    this.css = params.css
    this.css = params?.css || `@tailwind utilities;`
    this.config = params?.config || {}
    this.framework = params?.framework || ProjectType.HTML
  }

  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const projectModifier = frameworkMap[this.framework]
    if (!projectModifier) {
      throw new Error(`Requested ${this.framework} doesn't have a predefined modifier`)
    }
    await projectModifier(structure, this.config, this.css)
    return structure
  }
}
