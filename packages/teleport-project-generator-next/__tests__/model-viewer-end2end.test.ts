import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/**
 * The shape the GUI's model-viewer-to-uidl converter emits for Next: a styled
 * div wrapper whose only child is the `model-viewer-node` element carrying the
 * web component's own kebab attributes ('true' booleans already reduced to
 * bare attributes, defaults omitted).
 */
const MODEL_VIEWER_WRAPPED_NODE = {
  type: 'element',
  content: {
    elementType: 'div',
    semanticType: 'div',
    name: 'model1',
    style: {
      width: { type: 'static', content: '400px' },
      height: { type: 'static', content: '300px' },
    },
    children: [
      {
        type: 'element',
        content: {
          elementType: 'model-viewer-node',
          name: 'model1viewer',
          attrs: {
            src: { type: 'static', content: '/robot.glb' },
            poster: { type: 'static', content: '/robot-poster.jpg' },
            alt: { type: 'static', content: '3D model' },
            'camera-controls': { type: 'static', content: 'true' },
            // The inspector's Zoom setting — the initial camera distance must
            // survive into the published page verbatim.
            'camera-orbit': { type: 'static', content: 'auto auto 50%' },
          },
          style: {
            width: { type: 'static', content: '100%' },
            height: { type: 'static', content: '100%' },
          },
          children: [],
        },
      },
    ],
  },
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

const buildUidlWithModelViewer = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(MODEL_VIEWER_WRAPPED_NODE)
  return uidl
}

describe('Next generator with a model-viewer element', () => {
  const generator = createNextProjectGenerator()

  it('adds the pinned dependency and window-guards the side-effect import (lottie treatment)', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithModelViewer(), template)

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['@google/model-viewer']).toBe('4.3.1')
    // model-viewer's peer must be explicit: the generated .npmrc's
    // legacy-peer-deps=true disables npm's automatic peer installation.
    expect(packageJson.dependencies.three).toBe('^0.183.0')

    const indexPage = outputFolder.subFolders
      .find((sub) => sub.name === 'pages')
      ?.files.find((file) => file.name === 'index')

    // No static top-level import — the custom element registers itself and
    // touches window, so the import must be dynamic and window-guarded.
    expect(indexPage?.content).not.toMatch(/^import '@google\/model-viewer'/m)
    expect(indexPage?.content).toContain("import('@google/model-viewer')")

    // The import is RUN by the effect, never RETURNED from it. A concise arrow
    // body (`useEffect(() => import(…), [])`) hands React the import's Promise
    // as that effect's cleanup, and React calls whatever an effect returns on
    // unmount — so leaving the page killed the app with
    // `TypeError: destroy is not a function`.
    expect(indexPage?.content).toMatch(/useEffect\(\(\) => \{\s*import\('@google\/model-viewer'\)/)
    // A chunk that fails to load degrades to an unupgraded element with a
    // warning, instead of an unhandled promise rejection.
    expect(indexPage?.content).toMatch(/\.catch\(\(error\) => \{/)

    // The element renders with its local asset paths and the presence-valued
    // boolean (the component only checks attribute presence).
    expect(indexPage?.content).toContain('<model-viewer')
    expect(indexPage?.content).toContain('src="/robot.glb"')
    expect(indexPage?.content).toContain('poster="/robot-poster.jpg"')
    expect(indexPage?.content).toContain('camera-controls="true"')
    expect(indexPage?.content).toContain('camera-orbit="auto auto 50%"')

    // React cannot style custom elements through className, so the plugin
    // ships a global sizing stylesheet and imports it from _app.
    const cssFile = findFile(outputFolder, 'pages', 'model-viewer')
    expect(cssFile?.fileType).toBe('css')
    expect(cssFile?.content).toContain('model-viewer {')
    // Without this the library's white default poster hides the wrapper's own
    // background until the model loads, so the page would not match the canvas.
    expect(cssFile?.content).toContain('--poster-color: transparent;')

    const appFile = findFile(outputFolder, 'pages', '_app')
    expect(appFile?.content).toContain("import './model-viewer.css'")

    // The return-to-default-view runtime ships alongside and is imported the
    // same way: it glides marked viewers back to their initial orbit after
    // the shopper stops interacting.
    const orbitFile = findFile(outputFolder, 'utils', 'model-viewer-orbit-reset')
    expect(orbitFile?.fileType).toBe('js')
    expect(orbitFile?.content).toContain("'data-tq-model-orbit-reset'")
    expect(orbitFile?.content).toContain('camera-change')
    expect(orbitFile?.content).toContain('user-interaction')
    expect(appFile?.content).toContain("import '../utils/model-viewer-orbit-reset'")
  })

  it('emits a data-bound viewer inside a component with kebab attrs and the fill opt-out', async () => {
    // The shape the GUI's product-media builder emits for a product card: the
    // wrapper (carrying the builder's sizing opt-out) inside a `showModel`
    // conditional, with src / poster bound to the card's object prop.
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    uidl.components = uidl.components || {}
    uidl.components.ProductCard = {
      name: 'ProductCard',
      propDefinitions: {
        product: {
          type: 'object',
          defaultValue: { showModel: 'false', modelUrl: '', modelPoster: '' },
        },
      },
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'conditional',
              content: {
                reference: {
                  type: 'dynamic',
                  content: { referenceType: 'prop', id: 'product', refPath: ['showModel'] },
                },
                value: 'true',
                node: {
                  type: 'element',
                  content: {
                    elementType: 'div',
                    semanticType: 'div',
                    name: 'productmodel',
                    attrs: { 'data-tq-model-fill': { type: 'static', content: 'true' } },
                    style: { width: { type: 'static', content: '100%' } },
                    children: [
                      {
                        type: 'element',
                        content: {
                          elementType: 'model-viewer-node',
                          name: 'productmodelviewer',
                          attrs: {
                            src: {
                              type: 'dynamic',
                              content: {
                                referenceType: 'prop',
                                id: 'product',
                                refPath: ['modelUrl'],
                              },
                            },
                            poster: {
                              type: 'dynamic',
                              content: {
                                referenceType: 'prop',
                                id: 'product',
                                refPath: ['modelPoster'],
                              },
                            },
                            alt: {
                              type: 'dynamic',
                              content: { referenceType: 'prop', id: 'product', refPath: ['name'] },
                            },
                            'auto-rotate': { type: 'static', content: 'true' },
                          },
                          children: [],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    } as unknown as ProjectUIDL['components'][string]

    const outputFolder = await generator.generateProject(uidl, template)

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    // A component (not a page) using the element is enough for the plugin.
    expect(packageJson.dependencies['@google/model-viewer']).toBe('4.3.1')
    expect(packageJson.dependencies.three).toBe('^0.183.0')

    const componentFile = findFile(outputFolder, 'components', 'product-card')
    expect(componentFile?.content).toContain('<model-viewer')
    // Dynamic values keep the web component's own kebab attribute names.
    expect(componentFile?.content).toMatch(/src=\{props\.product\??\.(\['modelUrl'\]|modelUrl)\}/)
    expect(componentFile?.content).toMatch(
      /poster=\{props\.product\??\.(\['modelPoster'\]|modelPoster)\}/
    )
    expect(componentFile?.content).toContain('auto-rotate="true"')
    // The whole wrapper is gated on the product's showModel flag.
    expect(componentFile?.content).toMatch(
      /props\.product\??\.(\['showModel'\]|showModel) === ['"]true['"]/
    )
    expect(componentFile?.content).toContain('data-tq-model-fill="true"')

    // The builder-sized wrapper switches the safety-net min-height off.
    const cssFile = findFile(outputFolder, 'pages', 'model-viewer')
    expect(cssFile?.content).toContain('[data-tq-model-fill] > model-viewer {')
    expect(cssFile?.content).toContain('min-height: 0;')
  })

  it('adds no model-viewer dependency for projects without the element', async () => {
    const outputFolder = await generator.generateProject(
      JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL,
      template
    )

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['@google/model-viewer']).toBeUndefined()
    expect(packageJson.dependencies.three).toBeUndefined()
    expect(findFile(outputFolder, 'utils', 'model-viewer-orbit-reset')).toBeUndefined()
  })
})
