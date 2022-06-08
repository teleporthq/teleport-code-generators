import { FileType } from '@teleporthq/teleport-types'
import { TailwindPluginParams } from '.'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const nuxtTailwindModifier = async (params: TailwindPluginParams): Promise<void> => {
  const { structure, config, css, path } = params
  const { devDependencies, files } = structure
  config.content = [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './nuxt.config.{js,ts}',
  ]

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)
  let globalStyleSheet = css

  if (projectSheet) {
    files.delete('projectStyleSheet')
    globalStyleSheet = `${globalStyleSheet} \n \n ${projectSheet.content}`
  }

  files.set('projectStyleSheet', {
    path: path || [''],
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
    ],
    path: [''],
  })

  if (files.get('nuxt.config')) {
    files.delete('nuxt.config')
  }

  files.set('nuxt.config', {
    path: [''],
    files: [
      {
        name: 'nuxt.config',
        fileType: FileType.JS,
        content: `export default {
  css: ["~/style.css"],
  buildModules: ["@nuxt/postcss8"],
  build: {
    postcss: {
      plugins: {
        tailwindcss: {},
        autoprefixer: {},
      },
    },
  },
};`,
      },
    ],
  })

  devDependencies.autoprefixer = AUTO_PREFIXER
  devDependencies.postcss = POSTCSS
  devDependencies.tailwindcss = TAILWIND
  devDependencies['@nuxt/postcss8'] = '^1.1.3'
}
