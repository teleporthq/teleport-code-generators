import { FileType } from '@teleporthq/teleport-types'
import { TailwindPluginParams } from '.'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const reactTailwindModifier = async (params: TailwindPluginParams): Promise<void> => {
  const { structure, config, css, path } = params
  const { files, devDependencies } = structure
  config.content = ['./src/**/*.{js,ts,jsx,tsx}']

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)
  let globalStyleSheet = css

  if (projectSheet) {
    files.delete('projectStyleSheet')
    globalStyleSheet = `${globalStyleSheet} \n \n ${projectSheet.content}`
  }

  files.set('projectStyleSheet', {
    path: path || ['src'],
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
