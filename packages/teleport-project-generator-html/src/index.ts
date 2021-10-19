import { createProjectGenerator } from '@teleporthq/teleport-project-generator'
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-css'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import HTMLTemplate from './project-template'
import { pluginHtmlGenerators } from './utils'

const createHTMLProjectGenerator = (config?: { individualEntyFile: boolean }) => {
  const { individualEntyFile } = config || { individualEntyFile: true }

  const generator = createProjectGenerator({
    id: 'teleport-project-html',
    components: {
      generator: createHTMLComponentGenerator,
      path: ['src', 'components'],
    },
    pages: {
      generator: createHTMLComponentGenerator,
      path: ['src', 'pages'],
    },
    static: {
      prefix: '',
      path: ['public'],
    },
    projectStyleSheet: {
      generator: createComponentGenerator,
      plugins: [createStyleSheetPlugin()],
      fileName: 'style',
      path: ['src'],
      importFile: true,
    },
    entry: {
      postprocessors: [prettierHTML],
      fileName: 'index',
      path: [''],
    },
  })

  if (individualEntyFile) {
    generator.addPlugin(pluginHtmlGenerators)
  }

  return generator
}

export { createHTMLProjectGenerator, HTMLTemplate }
