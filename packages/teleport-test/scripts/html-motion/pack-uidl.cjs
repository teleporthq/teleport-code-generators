// Packs any exported project UIDL as a static HTML site the way the editor's download does
// (embed parsing on, relaxed whitespace). Usage: node pack-uidl.cjs <uidl.json> <out-dir>
const path = require('path')
const fs = require('fs')
const CG = path.resolve(__dirname, '../../../..')
const { packProject } = require(CG + '/packages/teleport-code-generator/dist/cjs/index.js')
const { ProjectType, PublisherType } = require(CG + '/packages/teleport-types/dist/cjs/index.js')
const { ProjectPluginParseEmbed } = require(CG +
  '/packages/teleport-project-plugin-parse-embed/dist/cjs/index.js')
const [uidlPath, out] = process.argv.slice(2)
;(async () => {
  const uidl = JSON.parse(fs.readFileSync(uidlPath, 'utf8'))
  const result = await packProject(uidl, {
    projectType: ProjectType.HTML,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath: out, projectSlug: 'site' },
    plugins: [new ProjectPluginParseEmbed()],
    strictHtmlWhitespaceSensitivity: false,
  })
  console.log('packProject success:', result.success)
  console.log(fs.readdirSync(path.join(out, 'site')).join(' '))
})().catch((e) => {
  console.error(
    String((e && e.stack) || e)
      .split('\n')
      .slice(0, 12)
      .join('\n')
  )
  process.exit(1)
})
