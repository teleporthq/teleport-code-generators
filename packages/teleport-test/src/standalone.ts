// @ts-nocheck
import { readFileSync, writeFileSync, mkdirSync, accessSync, rmSync, existsSync } from 'fs'
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

// Parse a KEY=value .env file into a plain object. Lines starting with `#`
// and empty lines are skipped. Values are taken verbatim (no quote
// unwrapping) because that's how `createEnvFiles` also writes them.
const parseDotEnv = (content: string): Record<string, string> => {
  const out: Record<string, string> = {}
  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      return
    }
    const eq = line.indexOf('=')
    if (eq < 0) {
      return
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key) {
      out[key] = value
    }
  })
  return out
}

// Preserve the buyer-editable subset of the existing `.env` across regeneration.
// The generator strips `teleporthq.secrets.*` placeholders to empty strings
// via `resolveAuthEnvValue`, so without this hook every `yarn standalone`
// wipes out values the user manually set (Stripe / PayPal test keys, DB
// connection string, etc.). By injecting the on-disk values into
// `uidl.globals.env` BEFORE packing, those values survive regeneration.
// Only non-empty existing values are promoted, so new keys introduced by the
// generator still take their default (empty) state on first run.
const preserveExistingEnv = (uidl: ProjectUIDL, envPath: string): void => {
  if (!existsSync(envPath)) {
    return
  }
  let raw = ''
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  const existing = parseDotEnv(raw)
  if (!uidl.globals.env) {
    uidl.globals.env = {}
  }
  const env = uidl.globals.env as Record<string, string>
  // Copy over every existing key (even ones the generator did not emit this
  // pass) so user-added entries such as TELEPORT_PROJECT_TOKEN stay in the
  // regenerated file. Values that are explicitly empty in the file are kept
  // empty — matching what the user saw on disk.
  Object.keys(existing).forEach((key) => {
    env[key] = existing[key]
  })
}

const run = async () => {
  try {
    if (packerOptions.publisher === PublisherType.DISK) {
      try {
        accessSync('dist')
      } catch {
        mkdirSync('dist')
      }
      const wfApi = join(
        __dirname,
        '..',
        'dist',
        'teleport-project-next',
        'pages',
        'api',
        'workflows'
      )
      if (existsSync(wfApi)) {
        rmSync(wfApi, { recursive: true, force: true })
      }
      // Preserve the user's existing `.env` values before regeneration so
      // Stripe / PayPal / DB credentials survive the trip through the
      // generator's secret-placeholder resolver.
      const existingEnvPath = join(__dirname, '..', 'dist', 'teleport-project-next', '.env')
      preserveExistingEnv(projectUIDL, existingEnvPath)
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
