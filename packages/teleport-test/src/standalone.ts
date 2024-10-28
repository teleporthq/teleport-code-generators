// @ts-nocheck
import { readFileSync, mkdirSync, accessSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { packProject } from '@teleporthq/teleport-code-generator'
import {
  ProjectUIDL,
  PackerOptions,
  ProjectType,
  PublisherType,
  ProjectPlugin,
} from '@teleporthq/teleport-types'
import { performance } from 'perf_hooks'
import { ProjectPluginCSSModules } from '@teleporthq/teleport-project-plugin-css-modules'
import { ProjectPluginReactJSS } from '@teleporthq/teleport-project-plugin-react-jss'
import { ProjectPluginStyledComponents } from '@teleporthq/teleport-project-plugin-styled-components'
import { ProjectPluginParseEmbed } from '@teleporthq/teleport-project-plugin-parse-embed'
import projectJSON from '../../../examples/uidl-samples/project.json'
import contentfulUIDL from '../../../examples/uidl-samples/contentful.json'
import strapiUIDL from '../../../examples/uidl-samples/strapi.json'
import wordpressUIDL from '../../../examples/uidl-samples/wordpress.json'
import caisyUIDL from '../../../examples/uidl-samples/caisy.json'
import flotiqUIDL from '../../../examples/uidl-samples/flotiq.json'

const projectUIDL = projectJSON as unknown as ProjectUIDL
const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = Buffer.from(assetFile).toString('base64')
const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.REACT,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [
    {
      fileType: 'png',
      name: 'icons-192',
      content: base64File,
      path: ['custom'],
    },
    {
      fileType: 'png',
      name: 'icons-512',
      content: base64File,
      contentEncoding: 'base64',
    },
    {
      content: 'https://placekitten.com/800/400',
      name: 'kitten.png',
      location: 'remote',
      path: ['one', 'two'],
    },
    {
      content:
        'https://storage.googleapis.com/playground-bucket-v2.teleporthq.io/8db63146-c3cc-47b2-a38d-1f2b39418d4e/8f055b25-4689-4305-b41a-0655571542ca',
      name: 'super-funky.ttf',
      location: 'remote',
      path: ['fonts'],
    },
  ],
}

const log = async (cb: () => Promise<string>) => {
  const t1 = performance.now()
  const framework = await cb()
  const t2 = performance.now()

  const time = t2 - t1
  console.info(chalk.greenBright(`${framework} -  ${time.toFixed(2)}`))
}

const project = (params: {
  projectType: ProjectType
  projectSlug: string
  plugins?: ProjectPlugin[]
  options?: PackerOptions
  uidl?: Record<string, unknown>
}) =>
  log(async () => {
    const { projectType, projectSlug, plugins = [], options = packerOptions, uidl } = params
    const { payload } = await packProject((uidl ?? projectUIDL) as ProjectUIDL, {
      ...options,
      projectType,
      plugins,
      publishOptions: {
        ...packerOptions.publishOptions,
        projectSlug,
      },
    })

    return JSON.stringify(
      {
        projectSlug,
        payload,
      },
      null,
      2
    )
  })

const run = async () => {
  try {
    if (packerOptions.publisher === PublisherType.DISK) {
      try {
        accessSync('dist')
      } catch {
        mkdirSync('dist')
      }
    }

    await Promise.all([
      // project({
      //   projectType: ProjectType.HTML,
      //   projectSlug: 'teleport-project-html',
      //   plugins: [new ProjectPluginParseEmbed()],
      //   options: {
      //     ...packerOptions,
      //     strictHtmlWhitespaceSensitivity: false,
      //   },
      // }),
      project({ projectType: ProjectType.NEXT, projectSlug: 'teleport-project-next' }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-embeds-with-css-modules`,
      //   plugins: [
      //     new ProjectPluginCSSModules({ framework: ProjectType.NEXT }),
      //     new ProjectPluginParseEmbed(),
      //   ],
      // }),
      // project({
      //   projectType: ProjectType.REACT,
      //   projectSlug: 'teleport-project-react',
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NUXT,
      //   projectSlug: `teleport-project-nuxt-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.VUE,
      //   projectSlug: `teleport-project-vue-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.ANGULAR,
      //   projectSlug: `teleport-project-angular-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-with-reactjss`,
      //   plugins: [new ProjectPluginReactJSS({ framework: ProjectType.NEXT })],
      // }),
      // project({
      //   projectType: ProjectType.REACT,
      //   projectSlug: `teleport-project-react-with-styled-components`,
      //   plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.REACT })],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-contentful-cms',
      //   uidl: contentfulUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-wordpress-cms',
      //   uidl: wordpressUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-strapi-cms',
      //   uidl: strapiUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-caisy-cms',
      //   uidl: caisyUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-flotiq-cms',
      //   uidl: flotiqUIDL,
      // }),
    ])
  } catch (e) {
    console.info(e)
  }
}

run()
