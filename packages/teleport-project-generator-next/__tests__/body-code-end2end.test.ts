import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import {
  BODY_CODE_TEMPLATE_ATTR,
  splitBodyCustomCode,
  wrapBodyCustomCode,
} from '../src/body-code/body-code-component'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const BODY_CODE = [
  '<script src="https://unpkg.com/@teleporthq/teleport-custom-scripts"></script>',
  '<noscript><img src="https://px.example/pixel" alt="" /></noscript>',
  '<script>window.__patched = true</script>',
].join('\n')

const buildUidlWithBodyCode = (body: string | undefined): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  uidl.globals.customCode = body === undefined ? undefined : { body }
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('body custom code runs after hydration', () => {
  it('keeps noscript live and makes everything else inert', () => {
    const { noscript, deferred } = splitBodyCustomCode(BODY_CODE)
    expect(noscript).toBe('<noscript><img src="https://px.example/pixel" alt="" /></noscript>')
    expect(deferred).not.toContain('<noscript')
    expect(deferred).toContain('teleport-custom-scripts')
    expect(deferred).toContain('window.__patched')

    const html = wrapBodyCustomCode(BODY_CODE)
    expect(html.indexOf('<noscript')).toBeLessThan(html.indexOf('<template'))
    expect(html).toContain(`<template ${BODY_CODE_TEMPLATE_ATTR}>`)
    // a body made only of noscript ships no template at all
    expect(wrapBodyCustomCode('<noscript>x</noscript>')).toBe('<noscript>x</noscript>')
  })

  describe('generated project', () => {
    const generator = createNextProjectGenerator()

    it('ships the code inert in _document and the unpacker as an _app sibling', async () => {
      const output = await generator.generateProject(buildUidlWithBodyCode(BODY_CODE), template)

      const document = findFile(output, 'pages', '_document')
      expect(document?.content).toContain(`<template ${BODY_CODE_TEMPLATE_ATTR}>`)
      expect(document?.content).toMatch(/<noscript><img[\s\S]*<template/)

      const app = findFile(output, 'pages', '_app')
      expect(app?.content).toContain("import TqBodyCode from '../components/tq-body-code'")
      expect(app?.content).toContain('<TqBodyCode />')

      const component = findFile(output, 'components', 'tq-body-code')
      expect(component?.content).toContain('useEffect')
      expect(component?.content).toContain(`template[${BODY_CODE_TEMPLATE_ATTR}]`)
      expect(component?.content).toContain('script.async = false')
    })

    it('adds nothing when the project has no body custom code', async () => {
      const output = await generator.generateProject(buildUidlWithBodyCode(undefined), template)
      expect(findFile(output, 'pages', '_app')?.content).not.toContain('TqBodyCode')
      expect(findFile(output, 'components', 'tq-body-code')).toBeUndefined()
    })
  })
})
