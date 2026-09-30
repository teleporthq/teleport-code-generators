import {
  FileType,
  GeneratedFolder,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLInstallableWebApp,
} from '@teleporthq/teleport-types'

export const APP_SOURCE = `import './style.css'
export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
    </>
  )
}
`

export const NEXT_CONFIG_SOURCE = `module.exports = {
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: "en",
  },
}`

// A 1x1 transparent PNG — the plugin only copies the bytes.
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export const installableApp = (
  overrides: Partial<UIDLInstallableWebApp> = {}
): UIDLInstallableWebApp => ({
  installable: true,
  name: 'Northwind Coffee Roasters',
  shortName: 'Northwind',
  description: 'Fresh roasts, delivered.',
  themeColor: '#0F766E',
  backgroundColor: '#ffffff',
  installBanner: true,
  cacheContent: true,
  networkOnlyPaths: ['/checkout', '/orders/[id]'],
  icons: {
    any192: PNG_BASE64,
    any512: PNG_BASE64,
    maskable512: PNG_BASE64,
    appleTouch180: PNG_BASE64,
  },
  ...overrides,
})

export const workflowsUsing = (...nodeTypes: string[]) => ({
  workflows: {
    'workflow-1': {
      id: 'workflow-1',
      name: 'Notify',
      nodes: nodeTypes.map((type, index) => ({ id: `node-${index}`, type, config: {} })),
      edges: [] as unknown[],
    },
  },
  customNodes: {},
})

export const baseUidl = (extra: Record<string, unknown> = {}): ProjectUIDL =>
  ({
    name: 'northwind',
    globals: {
      settings: { title: 'Northwind', language: 'en' },
      meta: [],
      assets: [{ type: 'icon', path: '/favicon.png' }],
    },
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
    ...extra,
  } as unknown as ProjectUIDL)

export const buildStructure = (
  uidl: ProjectUIDL,
  options: { withNextConfig?: boolean } = {}
): ProjectPluginStructure => {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_SOURCE }],
  })
  if (options.withNextConfig !== false) {
    files.set('next.config', {
      path: [],
      files: [{ name: 'next.config', fileType: FileType.JS, content: NEXT_CONFIG_SOURCE }],
    })
  }
  const emptyFolder: GeneratedFolder = { name: 'root', files: [], subFolders: [] }
  return {
    uidl,
    template: emptyFolder,
    rootFolder: emptyFolder,
    files,
    dependencies: {},
    devDependencies: {},
    strategy: {} as ProjectPluginStructure['strategy'],
  }
}

export const fileContent = (
  structure: ProjectPluginStructure,
  key: string,
  name: string
): string | undefined => structure.files.get(key)?.files.find((file) => file.name === name)?.content
