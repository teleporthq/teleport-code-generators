import { FileType } from '@teleporthq/teleport-types'
import { TailwindPluginParams } from '.'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const defaultTailwindModifier = async (params: TailwindPluginParams): Promise<void> => {
  const { structure, config, css, path } = params
  const { files, devDependencies, rootFolder } = structure
  config.content = ['./src/**/*.{html,js,ts,jsx,tsx}', './*.html']

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)
  let globalStyleSheet = css

  if (projectSheet) {
    files.delete('projectStyleSheet')
    globalStyleSheet = `${globalStyleSheet} \n \n ${projectSheet.content}`
  }

  rootFolder.files.forEach((file) => {
    const { name, fileType } = file

    if (name === 'package' && fileType === 'json') {
      const jsonContent = JSON.parse(file.content)
      jsonContent.scripts = {
        ...jsonContent?.scripts,
        tailwind: 'tailwindcss -o style.css -c ./tailwind.config.js',
      }
      file.content = JSON.stringify(jsonContent, null, 2)
    }
  })

  files.set('projectStyleSheet', {
    path: path || ['src', 'teleporthq'],
    files: [
      {
        ...projectSheet,
        content: globalStyleSheet,
      },
    ],
  })

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
