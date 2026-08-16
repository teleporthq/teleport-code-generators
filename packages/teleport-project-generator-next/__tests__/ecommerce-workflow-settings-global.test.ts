import { FileType, ProjectPluginStructure, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'
import {
  buildWorkflowEcommerceSettingsPayload,
  generateEcommerceSettingsApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'

// The client-side `ecommerce-get-settings` workflow node (see
// teleport-plugin-next-workflows) reads `window.__teleportEcommerceSettings`
// instead of fetching /api/ecommerce/settings. This file pins the supply side
// of that contract:
//   1. the generated ecommerce-context publishes the global at module-eval
//      time with EXACTLY the payload the settings route bakes;
//   2. the settings-less backstop context (emitted only so cart-hook imports
//      resolve) does NOT publish a defaults-shaped payload the workflow node
//      would mistake for real merchant settings.

const APP_CONTENT = [
  "import React from 'react'",
  'function MyApp({ Component, pageProps }) {',
  '  return (',
  '    <Component {...pageProps} />',
  '  )',
  '}',
  'export default MyApp',
].join('\n')

const SETTINGS: UIDLEcommerceSettings = {
  guestCheckout: false,
  stockManagement: true,
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  stockManagementConfig: {
    allowBackorders: false,
    maxQuantityPerProduct: 5,
    lowStockThreshold: 3,
    outOfStockVisibility: 'hidden',
  },
} as unknown as UIDLEcommerceSettings

const buildStructure = (
  withSettings: boolean,
  componentContent?: string
): ProjectPluginStructure => {
  const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
  if (componentContent) {
    files.set('navigation', {
      path: ['components'],
      files: [{ name: 'navigation', fileType: FileType.JS, content: componentContent }],
    })
  }
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })
  return {
    uidl: {
      globals: { env: {} },
      ...(withSettings ? { ecommerceSettings: SETTINGS } : {}),
    },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const contextContent = (structure: ProjectPluginStructure): string =>
  String(structure.files.get('ecommerce-context')?.files?.[0]?.content || '')

describe('workflow settings global in the generated ecommerce-context', () => {
  it('publishes window.__teleportEcommerceSettings with the exact route payload', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure(true)

    await plugin.runAfter(structure)

    const content = contextContent(structure)
    const expectedPayload = JSON.stringify(buildWorkflowEcommerceSettingsPayload(SETTINGS))
    expect(content).toContain(`const WORKFLOW_ECOMMERCE_SETTINGS = ${expectedPayload}`)
    expect(content).toContain('window.__teleportEcommerceSettings = WORKFLOW_ECOMMERCE_SETTINGS')

    // The route bakes the SAME payload — the two can never disagree.
    const route = generateEcommerceSettingsApiRoute(SETTINGS)
    expect(route).toContain(expectedPayload)
  })

  it('publishes the global at module scope, not inside the provider', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure(true)

    await plugin.runAfter(structure)

    const content = contextContent(structure)
    const globalAt = content.indexOf('window.__teleportEcommerceSettings')
    const providerAt = content.indexOf('export const EcommerceProvider')
    expect(globalAt).toBeGreaterThan(-1)
    expect(providerAt).toBeGreaterThan(-1)
    expect(globalAt).toBeLessThan(providerAt)
  })

  it('settings-less backstop context does NOT publish the global', async () => {
    const plugin = new NextEcommerceProjectPlugin()
    const structure = buildStructure(
      false,
      "import { useEcommerce } from '@/ecommerce-context'\nexport default function Nav() { return null }"
    )

    await plugin.runAfter(structure)

    const content = contextContent(structure)
    expect(content.length).toBeGreaterThan(0)
    expect(content).not.toContain('__teleportEcommerceSettings')
  })
})
