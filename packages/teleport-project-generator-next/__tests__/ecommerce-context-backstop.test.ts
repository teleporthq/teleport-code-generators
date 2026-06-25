import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'

// When a project has NO ecommerceSettings, a component can still import the cart
// hook — the i18n locale mapper injects
// `import { useEcommerce } from '@/ecommerce-context'` for cart-bound nodes.
// The plugin must then still emit `ecommerce-context.js` (and wrap _app) so that
// import resolves; otherwise `next build` fails with
// "Module not found: Can't resolve '@/ecommerce-context'".

const APP_CONTENT = [
  "import React from 'react'",
  'function MyApp({ Component, pageProps }) {',
  '  return (',
  '    <Component {...pageProps} />',
  '  )',
  '}',
  'export default MyApp',
].join('\n')

const buildStructure = (componentContent: string): ProjectPluginStructure => {
  const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
  files.set('navigation', {
    path: ['components'],
    files: [{ name: 'navigation', fileType: FileType.JS, content: componentContent }],
  })
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  return {
    uidl: { globals: { env: {} } },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const findContext = (structure: ProjectPluginStructure) =>
  structure.files.get('ecommerce-context')?.files?.[0]

describe('NextEcommerceProjectPlugin — settings-less context backstop', () => {
  it('emits ecommerce-context.js and wraps _app when a component references the hook', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure(
      "import { useEcommerce } from '@/ecommerce-context'\nexport default function Nav() { return null }"
    )

    await plugin.runAfter(structure)

    const context = findContext(structure)
    expect(context).toBeDefined()
    expect(context?.content).toContain('export const useEcommerce')
    expect(context?.content).toContain('export const EcommerceProvider')

    const appFile = structure.files.get('_app')?.files?.[0] as { content: string }
    expect(appFile.content).toContain('EcommerceProvider')
  })

  it('leaves a project that never references the hook untouched', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure(
      "import React from 'react'\nexport default function Nav() { return null }"
    )

    await plugin.runAfter(structure)

    expect(findContext(structure)).toBeUndefined()
    const appFile = structure.files.get('_app')?.files?.[0] as { content: string }
    expect(appFile.content).not.toContain('EcommerceProvider')
  })
})
