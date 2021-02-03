import {
  ProjectPlugin,
  ProjectPluginStructure,
  ReactStyleVariation,
  FileType,
} from '@teleporthq/teleport-types'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import { createStyleSheetPlugin } from '@teleporthq/teleport-plugin-react-jss'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'
import MagicString from 'magic-string'

class PluginNextReactJSS implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure

    if (strategy.id !== 'teleport-project-next') {
      throw new Error('Plugin can be used only with teleport-project-next')
    }

    strategy.style = ReactStyleVariation.ReactJSS
    if (strategy?.projectStyleSheet?.generator) {
      strategy.projectStyleSheet.plugins = [createStyleSheetPlugin(), importStatementsPlugin]
      strategy.projectStyleSheet.postprocessors = [prettierJS]
      strategy.framework.config.isGlobalStylesDependent = false
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files } = structure

    if (!files.get('entry')) {
      throw new Error('Entry file is missing from the generated files')
    }

    const fileContent = files.get('entry').files[0].content
    const magicString = new MagicString(fileContent.replace('/n', '//n'))

    magicString.appendRight(
      70,
      `\nimport { SheetsRegistry, JssProvider, createGenerateId } from "react-jss"; \n`
    )
    magicString.appendRight(
      114,
      `\nstatic async getInitialProps(ctx) {
        const registry = new SheetsRegistry();
        const generateId = createGenerateId();
        const originalRenderPage = ctx.renderPage;
        ctx.renderPage = () =>
          originalRenderPage({
            enhanceApp: (App) => (props) => (
              <JssProvider registry={registry} generateId={generateId}>
                <App {...props} />
              </JssProvider>
            ),
          });
        const initialProps = await Document.getInitialProps(ctx);
        return {
          ...initialProps,
          styles: (
            <>
              {initialProps.styles}
              <style id="server-side-styles">{registry.toString()}</style>
            </>
          ),
        };
      }\n \n`
    )

    const formattedCode = prettierJS({
      [FileType.JS]: magicString.toString(),
    })

    files.set('entry', {
      path: ['pages'],
      files: [
        {
          name: '_document',
          fileType: FileType.JS,
          content: formattedCode[FileType.JS],
        },
      ],
    })

    return structure
  }
}

const pluginNextReactJSS = new PluginNextReactJSS()
export { PluginNextReactJSS }
export default pluginNextReactJSS
