import { FileType } from '@teleporthq/teleport-types'
import { TailwindPluginParams } from '.'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const stencilTailwindModifier = async (params: TailwindPluginParams) => {
  const { structure, config, css, path } = params
  const { files, devDependencies } = structure
  config.content = ['./src/**/*.{ts,tsx,html}']

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
    ],
    path: [''],
  })

  files.delete('stencil.config')
  files.set('stencil.config', {
    files: [
      {
        name: 'stencil.config',
        fileType: FileType.TS,
        content: `import { Config } from "@stencil/core";
import tailwind, { tailwindHMR } from "stencil-tailwind-plugin";
import tailwindConfig from "./tailwind.config";
import autoprefixer from "autoprefixer";

export const config: Config = {
  namespace: "app",
  globalStyle: "src/style.css",
  outputTargets: [
    {
      type: "www",
      // comment the following line to disable service workers in production
      serviceWorker: null,
      baseUrl: "https://myapp.local/",
    },
  ],
  plugins: [
    tailwind({
      // @ts-ignore
      tailwindConfig,
      tailwindCssContents: '@tailwind utilities;',
      postcss: {
        plugins: [autoprefixer()],
      },
    }),
    tailwindHMR(),
  ],
};`,
      },
    ],
    path: [''],
  })

  devDependencies.tailwindcss = TAILWIND
  devDependencies.autoprefixer = AUTO_PREFIXER
  devDependencies.postcss = POSTCSS
  devDependencies['stencil-tailwind-plugin'] = '^1.3.0'
}
