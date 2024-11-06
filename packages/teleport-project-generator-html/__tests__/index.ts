import { FileType } from '@teleporthq/teleport-types'
import ProjectTemplate from '../src/project-template'
import { htmlErrorPageMapping } from '../src/error-page-mapping'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../src'
import fallbackUidlSample from '../../../examples/uidl-samples/tests.json'
import uidlWithCompStyleOverrides from '../../../examples/test-samples/comp-style-overrides.json'
import uidlWithImages from '../../../examples/test-samples/html-image-use-cases.json'

describe('Passes the rootClass which using the component', () => {
  it('run without crashing while using with HTML', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    generator.setAssets({
      mappings: {},
      identifier: 'playground_assets',
      prefix: '/public',
    })
    const result = await generator.generateProject(uidlWithCompStyleOverrides)

    const mainFile = result.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.HTML
    )
    const styleFile = result.files.find(
      (file) => file.name === 'index' && file.fileType === FileType.CSS
    )

    expect(mainFile).toBeDefined()
    expect(mainFile?.content).toContain(`root-class-name`)
    expect(styleFile?.content).toContain(`root-class-name`)
  })
})

describe('Image Resolution', () => {
  it('resolves all local assets to be refered from public folder', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    generator.setAssets({
      mappings: {
        'kitten.png': '',
      },
      identifier: 'playground_assets',
      prefix: 'public',
    })
    const { files } = await generator.generateProject(uidlWithImages)

    const mainCSS = files.find((file) => file.name === 'index' && file.fileType === FileType.CSS)
    const indexFile = files.find((file) => file.name === 'index' && file.fileType === FileType.HTML)

    expect(indexFile).toBeDefined()
    expect(mainCSS).toBeDefined()
    expect(indexFile?.content).toContain(`href="public/playground_assets/kitten.png"`)
    expect(indexFile?.content).toContain(`src="public/playground_assets/kitten.png"`)
    expect(mainCSS?.content).toContain(`.comp-with-image-prop-comp-with-image-bg-in-css {
  width: 100%;
  height: 200px;
  background-image: url("public/playground_assets/kitten.png");
}`)
    expect(mainCSS?.content).toContain(`@media(max-width: 991px) {
  .comp-with-image-prop-div {
    width: 100%;
    height: 200px;
    background-image: url("public/playground_assets/kitten.png");
  }
}`)
    expect(mainCSS?.content).toContain(`.comp-with-image-propbg-image-c {
  background-image: url("public/playground_assets/kitten.png");
}`)
    expect(mainCSS?.content).toContain(`.home-div {
  width: 100%;
  height: 200px;
  background-image: url("public/playground_assets/kitten.png");
}`)
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    generator.setAssets({
      mappings: {},
      identifier: 'playground_assets',
      prefix: '/public',
    })
    generator.addPlugin(htmlErrorPageMapping)

    const { files } = await generator.generateProject(fallbackUidlSample, ProjectTemplate)
    const fallbackPage = files.find((file) => file.name === '404')

    expect(fallbackPage).toBeDefined()
  })
})

describe('Meta tags from globals', () => {
  it('are added to each page`s head', async () => {
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)

    const { files } = await generator.generateProject(fallbackUidlSample)
    const pages = files.filter((file) => file.fileType === 'html')

    pages.forEach((page) => {
      expect(page.content).toContain('<meta charset="utf-8"')
      expect(page.content).toContain('<meta name="viewport"')
      expect(page.content).toContain('<meta property="twitter:card"')
    })
  })
})
