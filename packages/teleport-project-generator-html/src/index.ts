import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { GeneratorFactoryParams } from '@teleporthq/teleport-types'
import HTMLTemplate from './project-template'
import { pluginCloneGlobals, ProjectPluginCloneGlobals } from './plugin-clone-globals'
import { pluginHomeReplace } from './plugin-home-replace'
import { pluginSnapIntoView, ProjectPluginSnapIntoView } from './plugin-snap-into-view'
import { pluginScrollRail, ProjectPluginScrollRail } from './plugin-scroll-rail'
import { htmlErrorPageMapping } from './error-page-mapping'

interface HTMLProjectGeneratorOptions {
  standaloneHtmlComponents?: boolean
  excludeHtmlComponentFiles?: boolean
}

const createHTMLProjectGenerator = (options: HTMLProjectGeneratorOptions = {}) => {
  const { standaloneHtmlComponents = false, excludeHtmlComponentFiles = false } = options

  // Create component generator factory that includes standaloneHtmlComponents option
  // Must forward all params from bootstrapGenerator while adding our option
  const componentGeneratorFactory = standaloneHtmlComponents
    ? (params: GeneratorFactoryParams = {}) =>
        createHTMLComponentGenerator({ ...params, standaloneHtmlComponents: true })
    : createHTMLComponentGenerator

  const generator = createProjectGenerator({
    id: 'teleport-project-html',
    components: {
      generator: componentGeneratorFactory,
      path: ['components'],
      ...(excludeHtmlComponentFiles && { options: { excludeFiles: true } }),
    },
    pages: {
      generator: createHTMLComponentGenerator,
      path: [''],
      options: {
        useFileNameForNavigation: true,
      },
    },
    static: {
      prefix: 'public',
      path: ['public'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin({ fileName: 'style', relativeFontPath: true })],
      fileName: 'style',
      path: [''],
      importFile: true,
    },
    entry: {
      postprocessors: [prettierHTML],
      fileName: 'index',
      path: [''],
    },
  })

  return generator
}

export {
  createHTMLProjectGenerator,
  HTMLTemplate,
  pluginCloneGlobals,
  pluginHomeReplace,
  pluginSnapIntoView,
  pluginScrollRail,
  htmlErrorPageMapping,
  ProjectPluginCloneGlobals,
  ProjectPluginSnapIntoView,
  ProjectPluginScrollRail,
}
