import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

export class TailwindNextJSPlugin implements ProjectPlugin {
  config: Record<string, unknown>
  css: string

  constructor(params: { config: Record<string, unknown>; css: string }) {
    this.config = params.config
    this.css = params.css
  }

  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files, devDependencies } = structure
    this.config.content = ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}']

    const projectSheet = files
      .get('projectStyleSheet')
      ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)

    if (projectSheet) {
      files.delete('projectStyleSheet')
      files.set('projectStyleSheet', {
        path: ['pages'],
        files: [
          {
            ...projectSheet,
            content: `${this.css}\n${projectSheet.content}`,
          },
        ],
      })
    } else {
      const rootFolder = files.get('_app')
      const rootFile = rootFolder?.files.find(
        (file) => file.name === '_app' && file.fileType === FileType.JS
      )

      if (!rootFile) {
        throw new Error(`Entry _app.js is missing from the project. Please check the project`)
      }

      files.delete('_app')
      files.set('_app', {
        files: [
          ...(rootFolder?.files || []).filter(
            (file) => file.name !== '_app' && file.fileType === FileType.JS
          ),
          {
            ...rootFile,
            content: `import "./global.css"\n${rootFile.content}`,
          },
        ],
        path: ['pages'],
      })
      files.set('tailwindGlobal', {
        files: [
          {
            name: 'global',
            fileType: FileType.CSS,
            content: this.css,
          },
        ],
        path: ['pages'],
      })
    }

    files.set('tailwindConfig', {
      files: [
        {
          name: 'tailwind.config',
          fileType: FileType.JS,
          content: `module.exports = ${JSON.stringify(this.config, null, 2)}`,
        },
        {
          name: 'postcss.config',
          fileType: FileType.JS,
          content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`,
        },
      ],
      path: [''],
    })

    devDependencies.tailwindcss = `^3.0.24`
    devDependencies.autoprefixer = `^9.8.6`
    devDependencies.postcss = '^8.2.15'

    return structure
  }
}
