import uidlSample from '../../../../examples/test-samples/project-sample.json'
import template from './template-definition.json'
import { createNextProjectGenerator } from '../../src'

const withPageTransition = () => {
  // Deep-clone so we don't mutate the shared fixture.
  const uidl = JSON.parse(JSON.stringify(uidlSample))
  uidl.globals.pageTransition = { preset: 'book-flip' }
  return uidl
}

describe('Next.js View Transition API integration', () => {
  const generator = createNextProjectGenerator()

  it('emits startViewTransition + flushSync wrapper in _app.js when pageTransition is set', async () => {
    const outputFolder = await generator.generateProject(withPageTransition(), template)
    const pages = outputFolder.subFolders.find((f) => f.name === 'pages')
    const appFile = pages?.files.find((f) => f.name === '_app')

    expect(appFile).toBeDefined()
    const content = appFile!.content

    expect(content).toContain(`from 'react'`)
    expect(content).toContain('useState')
    expect(content).toContain('useEffect')
    expect(content).toContain('useRef')
    expect(content).toContain(`import { flushSync } from 'react-dom'`)
    expect(content).toContain(`import { useRouter } from 'next/router'`)

    expect(content).toContain('document.startViewTransition')
    expect(content).toContain('flushSync')
    expect(content).toContain('setPage')
    expect(content).toContain('DISABLED_VTA_PATHS')

    expect(content).toContain('<page.Component')
  })

  it('injects preset CSS into the _document.js head via customCode', async () => {
    const outputFolder = await generator.generateProject(withPageTransition(), template)
    const pages = outputFolder.subFolders.find((f) => f.name === 'pages')
    const documentFile = pages?.files.find((f) => f.name === '_document')

    expect(documentFile).toBeDefined()
    const content = documentFile!.content

    expect(content).toContain('data-vta-preset')
    expect(content).toContain('::view-transition-old(root)')
    expect(content).toContain('::view-transition-old(navbar)')
    expect(content).toContain('@keyframes tlp-page-flip-exit')
    expect(content).toContain('@media (prefers-reduced-motion: no-preference)')
  })

  it('collects disabled paths from pageOptions.pageTransition.disabled', async () => {
    const uidl = withPageTransition()
    // Mark one of the route values as disabled.
    const route = uidl.root.stateDefinitions.route
    const target = route.values.find((v: { value: string }) => v.value === 'about')
    target.pageOptions = target.pageOptions ?? {}
    target.pageOptions.pageTransition = { disabled: true }

    const outputFolder = await generator.generateProject(uidl, template)
    const pages = outputFolder.subFolders.find((f) => f.name === 'pages')
    const appFile = pages?.files.find((f) => f.name === '_app')

    expect(appFile!.content).toContain(`'/about'`)
  })

  it('does not emit VTA wrapper when pageTransition is absent', async () => {
    // Use the original uidlSample (no pageTransition).
    const outputFolder = await generator.generateProject(uidlSample, template)
    const pages = outputFolder.subFolders.find((f) => f.name === 'pages')
    const appFile = pages?.files.find((f) => f.name === '_app')

    expect(appFile).toBeDefined()
    expect(appFile!.content).not.toContain('document.startViewTransition')
    expect(appFile!.content).not.toContain('DISABLED_VTA_PATHS')
    expect(appFile!.content).not.toContain('flushSync')
  })
})
