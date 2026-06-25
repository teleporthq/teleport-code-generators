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
      "import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'"
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
