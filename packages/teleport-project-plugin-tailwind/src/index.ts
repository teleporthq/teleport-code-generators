import { ProjectPlugin, ProjectPluginStructure, ProjectType } from '@teleporthq/teleport-types'
import { nextJSTailwindModifier } from './nextjs'
import { defaultTailwindModifier } from './default'

type SUPPORTED_FRAMEWORKS = ProjectType.HTML | ProjectType.NEXT

const frameworkMap: Record<
  SUPPORTED_FRAMEWORKS,
  (
    structure: ProjectPluginStructure,
    config: Record<string, unknown>,
    content: string[],
    css: string
  ) => Promise<void>
> = {
  [ProjectType.NEXT]: nextJSTailwindModifier,
  [ProjectType.HTML]: defaultTailwindModifier,
}

export class ProjectPluginTailwind implements ProjectPlugin {
  config: Record<string, unknown>
  content: string[]
  css: string
  framework: SUPPORTED_FRAMEWORKS

  constructor(params: {
    config?: Record<string, unknown>
    css: string
    content?: string[]
    framework?: SUPPORTED_FRAMEWORKS
  }) {
    this.css = params.css
    this.config = params?.config || {}
    this.content = params?.content || ['./src/**/*.{vue,js,ts,jsx,tsx}']
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
    await projectModifier(structure, this.config, this.content, this.css)
    return structure
  }
}
