import { FileType } from '@teleporthq/teleport-types'
import { TailwindPluginParams } from '.'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const nextJSTailwindModifier = async (params: TailwindPluginParams): Promise<void> => {
  const { structure, config, css, path } = params
  const { files, devDependencies } = structure
  config.content = ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}']

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)

  if (projectSheet) {
    files.delete('projectStyleSheet')
    files.set('projectStyleSheet', {
      path: path || ['pages'],
      files: [
        {
          ...projectSheet,
          content: `${css}\n${projectSheet.content}`,
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
          content: `import "./global.css" \n \n ${rootFile.content}`,
        },
      ],
      path: ['pages'],
    })
    files.set('tailwindGlobal', {
      files: [
        {
          name: 'global',
          fileType: FileType.CSS,
          content: css,
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
        content: `module.exports = ${JSON.stringify(config, null, 2)}`,
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

  devDependencies.tailwindcss = TAILWIND
  devDependencies.autoprefixer = AUTO_PREFIXER
  devDependencies.postcss = POSTCSS
}
