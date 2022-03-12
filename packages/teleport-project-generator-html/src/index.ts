import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import HTMLTemplate from './project-template'
import { pluginCloneGlobals } from './plugin-clone-globals'
import { pluginImageResolver } from './plugin-image-resolution'

const createHTMLProjectGenerator = (config?: { individualEntyFile: boolean }) => {
  const { individualEntyFile } = config || { individualEntyFile: true }

  const generator = createProjectGenerator({
    id: 'teleport-project-html',
    components: {
      generator: createHTMLComponentGenerator,
      path: ['components'],
    },
    pages: {
      generator: createHTMLComponentGenerator,
      path: [''],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin()],
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

  generator.addPlugin(pluginImageResolver)
  if (individualEntyFile) {
    generator.addPlugin(pluginCloneGlobals)
  }

  return generator
}

export { createHTMLProjectGenerator, HTMLTemplate, pluginCloneGlobals, pluginImageResolver }
