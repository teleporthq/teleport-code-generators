import {
  FileType,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { createNextWidgetProjectPlugins } from '../src/widgets'

const APP_CONTENT = `import './style.css'

export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />
}
`

const elementNode = (elementType: string, children: UIDLElementNode[] = []): UIDLElementNode => ({
  type: 'element',
  content: {
    elementType,
    children,
  },
})

const buildStructure = (pageChildren: UIDLElementNode[]): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  const uidl = {
    name: 'test',
    root: {
      name: 'App',
      node: elementNode('container', pageChildren),
    },
    components: {},
  } as unknown as ProjectUIDL

  return {
    uidl,
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const runAll = async (structure: ProjectPluginStructure): Promise<void> => {
  const plugins: ProjectPlugin[] = createNextWidgetProjectPlugins()
  for (const plugin of plugins) {
    await plugin.runAfter(structure)
  }
}

interface WidgetCase {
  elementType: string
  fileKey: string
  fileName: string
  componentName: string
  dependency: string
  version: string
}

const WIDGET_CASES: WidgetCase[] = [
  {
    elementType: 'qrcode-node',
    fileKey: 'tq-qrcode-component',
    fileName: 'tq-qrcode',
    componentName: 'TqQrCode',
    dependency: 'qrcode',
    version: '1.5.4',
  },
  {
    elementType: 'barcode-node',
    fileKey: 'tq-barcode-component',
    fileName: 'tq-barcode',
    componentName: 'TqBarcode',
    dependency: 'jsbarcode',
    version: '3.12.1',
  },
  {
    elementType: 'signature-node',
    fileKey: 'tq-signature-component',
    fileName: 'tq-signature',
    componentName: 'TqSignature',
    dependency: 'signature_pad',
    version: '5.0.4',
  },
  {
    elementType: 'color-picker-node',
    fileKey: 'tq-color-picker-component',
    fileName: 'tq-color-picker',
    componentName: 'TqColorPicker',
    dependency: '@simonwep/pickr',
    version: '1.9.1',
  },
  {
    elementType: 'emoji-picker-node',
    fileKey: 'tq-emoji-picker-component',
    fileName: 'tq-emoji-picker',
    componentName: 'TqEmojiPicker',
    dependency: 'emoji-picker-element',
    version: '1.26.3',
  },
  {
    elementType: 'motion-node',
    fileKey: 'tq-motion-component',
    fileName: 'tq-motion',
    componentName: 'TqMotion',
    dependency: 'framer-motion',
    version: '^11.18.0',
  },
]

describe('Next widget project plugins', () => {
  it('are a no-op for projects without any widget primitive', async () => {
    const structure = buildStructure([elementNode('container')])

    await runAll(structure)

    for (const widget of WIDGET_CASES) {
      expect(structure.files.has(widget.fileKey)).toBe(false)
      expect(structure.dependencies[widget.dependency]).toBeUndefined()
    }
    expect(structure.files.has('tq-form-file-input-component')).toBe(false)
    expect(structure.files.get('_app')?.files[0].content).toBe(APP_CONTENT)
  })

  it.each(WIDGET_CASES)(
    'emits the $componentName wrapper + dependency when $elementType is used',
    async (widget) => {
      const structure = buildStructure([elementNode(widget.elementType)])

      await runAll(structure)

      const record = structure.files.get(widget.fileKey)
      expect(record?.path).toEqual(['components'])
      expect(record?.files[0].name).toBe(widget.fileName)
      expect(record?.files[0].fileType).toBe(FileType.JS)
      expect(record?.files[0].content).toContain(`const ${widget.componentName} =`)
      expect(record?.files[0].content).toContain(`export default ${widget.componentName}`)
      expect(structure.dependencies[widget.dependency]).toBe(widget.version)
    }
  )

  it('detects a widget primitive nested deep in the tree', async () => {
    const structure = buildStructure([
      elementNode('container', [elementNode('container', [elementNode('qrcode-node')])]),
    ])

    await runAll(structure)

    expect(structure.files.has('tq-qrcode-component')).toBe(true)
  })

  it('injects the Pickr theme stylesheet into _app only for the color picker', async () => {
    const structure = buildStructure([elementNode('color-picker-node')])

    await runAll(structure)

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent).toContain("import '@simonwep/pickr/dist/themes/nano.min.css'")
  })

  it('does not inject any stylesheet for a widget without CSS (qr code)', async () => {
    const structure = buildStructure([elementNode('qrcode-node')])

    await runAll(structure)

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent).toBe(APP_CONTENT)
  })

  it('bumps react/react-dom to ^18 only when the motion widget is used', async () => {
    const withoutMotion = buildStructure([elementNode('qrcode-node')])
    await runAll(withoutMotion)
    expect(withoutMotion.dependencies.react).toBeUndefined()
    expect(withoutMotion.dependencies['react-dom']).toBeUndefined()

    const withMotion = buildStructure([elementNode('motion-node')])
    await runAll(withMotion)
    expect(withMotion.dependencies['framer-motion']).toBe('^11.18.0')
    expect(withMotion.dependencies.react).toBe('^18.3.1')
    expect(withMotion.dependencies['react-dom']).toBe('^18.3.1')
  })

  it('emits a root .npmrc (legacy-peer-deps) only when the React-18 bump runs', async () => {
    const withoutMotion = buildStructure([elementNode('qrcode-node')])
    await runAll(withoutMotion)
    expect(withoutMotion.files.get('tq-motion-component-npmrc')).toBeUndefined()

    const withMotion = buildStructure([elementNode('motion-node')])
    await runAll(withMotion)
    const npmrc = withMotion.files.get('tq-motion-component-npmrc')
    expect(npmrc?.path).toEqual([])
    expect(npmrc?.files[0].name).toBe('.npmrc')
    expect(npmrc?.files[0].content).toContain('legacy-peer-deps=true')
  })

  it('generates a TqMotion wrapper that imports framer-motion and renders children', async () => {
    const structure = buildStructure([elementNode('motion-node')])
    await runAll(structure)
    const content = structure.files.get('tq-motion-component')?.files[0].content as string
    expect(content).toContain(
      "import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'"
    )
    expect(content).toContain('<motion.div')
    expect(content).toContain('{children}')
    expect(content).toContain('useReducedMotion')
  })

  it('drives in-view via useInView + a timed in-viewport failsafe (never trapped at opacity:0)', async () => {
    const structure = buildStructure([elementNode('motion-node')])
    await runAll(structure)
    const content = structure.files.get('tq-motion-component')?.files[0].content as string
    // in-view is no longer the bare whileInView (which could miss an already-in-view
    // hero) — it is gated on useInView OR a forced reveal after a timed visibility check.
    expect(content).toContain('useInView(ref')
    expect(content).toContain('setForceReveal')
    expect(content).toContain('getBoundingClientRect')
    expect(content).toContain('animate: revealed ? toVars : fromVars')
    expect(content).not.toContain('whileInView')
  })

  it('staggers the real repeated items (descends grid/array-mapper wrappers), not the block', async () => {
    const structure = buildStructure([elementNode('motion-node')])
    await runAll(structure)
    const content = structure.files.get('tq-motion-component')?.files[0].content as string
    // The descent helper + per-child wrapping must be generated so a wrapped grid
    // cascades its cards rather than animating as one block.
    expect(content).toContain('mapStaggerTargets')
    expect(content).toContain('cloneElement')
    expect(content).toContain('index * Number(stagger)')
  })

  it('uses next/dynamic ssr:false for the window-dependent wrappers', async () => {
    const structure = buildStructure([
      elementNode('color-picker-node'),
      elementNode('emoji-picker-node'),
    ])

    await runAll(structure)

    expect(structure.files.get('tq-color-picker-component')?.files[0].content).toContain(
      "import('@simonwep/pickr')"
    )
    expect(structure.files.get('tq-emoji-picker-component')?.files[0].content).toContain(
      "import('emoji-picker-element')"
    )
  })
})

describe('form-file-input widget plugin (dependency-less wrapper)', () => {
  const buildContent = async (): Promise<{
    structure: ProjectPluginStructure
    content: string
  }> => {
    const structure = buildStructure([elementNode('form-file-input-node')])
    await runAll(structure)
    const content = structure.files.get('tq-form-file-input-component')?.files[0].content as string
    return { structure, content }
  }

  it('emits the TqFormFileInput wrapper without adding any npm dependency', async () => {
    const { structure, content } = await buildContent()

    const record = structure.files.get('tq-form-file-input-component')
    expect(record?.path).toEqual(['components'])
    expect(record?.files[0].name).toBe('tq-form-file-input')
    expect(record?.files[0].fileType).toBe(FileType.JS)
    expect(content).toContain('const TqFormFileInput =')
    expect(content).toContain('export default TqFormFileInput')
    // Pure DOM/FileReader wrapper: nothing lands in package.json and the
    // react version stays whatever the template ships.
    expect(Object.keys(structure.dependencies)).toEqual([])
  })

  it('reads picked files into PickedFile POJOs (browser-pick-files shape) via FileReader', async () => {
    const { content } = await buildContent()

    expect(content).toContain('readAsDataURL')
    for (const field of ['name:', 'size:', 'type:', 'lastModified:', 'dataURL:']) {
      expect(content).toContain(field)
    }
    // No upload at pick time — uploads belong to the form-submit workflow.
    expect(content).not.toContain('fetch(')
  })

  it('renders dataURL previews with per-item remove and the form-file-input marker', async () => {
    const { content } = await buildContent()

    expect(content).toContain('data-thq="form-file-input"')
    expect(content).toContain('src={file.dataURL}')
    expect(content).toContain('removeAt')
    expect(content).toContain('aria-label="Remove file"')
  })

  it('mirrors state into a nameless hidden input so form payloads never see the JSON', async () => {
    const { content } = await buildContent()

    const mirrorLine = content.split('\n').find((line) => line.includes('type="hidden"')) as string
    expect(mirrorLine).toBeDefined()
    expect(mirrorLine).not.toContain('name=')
    // Commits reach the page state through the generated onChange contract
    // (event.target.value = JSON array) plus a native change on the mirror.
    expect(content).toContain('onChange({ target: { value: serialized } })')
    expect(content).toContain("dispatchEvent(new Event('change', { bubbles: true }))")
  })
})

describe('category widget plugins (dependency-less, data-driven wrappers)', () => {
  const contentFor = async (elementType: string, fileKey: string): Promise<string> => {
    const structure = buildStructure([elementNode(elementType)])
    await runAll(structure)
    return structure.files.get(fileKey)?.files[0].content as string
  }

  it('emits the Category Menu wrapper with real products-list links, no npm dependency', async () => {
    const structure = buildStructure([elementNode('categories-megamenu-node')])
    await runAll(structure)
    const content = structure.files.get('tq-categories-megamenu-component')?.files[0]
      .content as string

    expect(content).toContain('const TqCategoriesMegamenu =')
    expect(content).toContain('export default TqCategoriesMegamenu')
    expect(content).toContain('data-thq="categories-megamenu-node"')
    // Every category is a real crawlable <a> to products-list?<paramKey>=<id>.
    expect(content).toContain('productsListHref')
    expect(content).toContain("'?' + paramKey + '=' + encodeURIComponent")
    expect(content).toContain('buildCategoryTree')
    expect(content).toContain('sanitizeSvg')
    // Pure wrapper — nothing lands in package.json.
    expect(Object.keys(structure.dependencies)).toEqual([])
  })

  it('emits the Category Filter wrapper with multi-select + shallow URL routing, no npm dependency', async () => {
    const structure = buildStructure([elementNode('categories-filter-node')])
    await runAll(structure)
    const content = structure.files.get('tq-categories-filter-component')?.files[0]
      .content as string

    expect(content).toContain('const TqCategoriesFilter =')
    expect(content).toContain('export default TqCategoriesFilter')
    expect(content).toContain('data-thq="categories-filter-node"')
    expect(content).toContain("import { useRouter } from 'next/router'")
    // Multi-select: parent selects subtree, minimal antichain to the URL.
    expect(content).toContain('toggleSelection')
    expect(content).toContain('computeMinimalSelectedIds')
    expect(content).toContain('expandSelection')
    // Selection is written comma-joined to the URL via shallow routing.
    expect(content).toContain('{ shallow: true }')
    expect(content).toContain('router.replace')
    expect(content).toContain('type="checkbox"')
    expect(Object.keys(structure.dependencies)).toEqual([])
  })

  it('does not emit either category wrapper when the project omits it', async () => {
    const structure = buildStructure([elementNode('container')])
    await runAll(structure)
    expect(structure.files.has('tq-categories-megamenu-component')).toBe(false)
    expect(structure.files.has('tq-categories-filter-component')).toBe(false)
  })
})
