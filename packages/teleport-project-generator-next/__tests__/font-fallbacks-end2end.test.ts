import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const allFiles = (folder: GeneratedFolder): Array<{ path: string; content: string }> => [
  ...folder.files.map((file) => ({ path: `${file.name}.${file.fileType}`, content: file.content })),
  ...folder.subFolders.flatMap((sub) =>
    allFiles(sub).map((file) => ({ ...file, path: `${sub.name}/${file.path}` }))
  ),
]

const sampleWithHeadingClass = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  uidl.root.styleSetDefinitions = {
    ...(uidl.root.styleSetDefinitions || {}),
    'brand-heading': {
      type: 'reusable-project-style-map',
      content: { fontFamily: 'Roboto' },
    } as never,
  }
  return uidl
}

describe('Google fonts get a size-matched stand-in in the generated Next project', () => {
  it('declares the stand-in once in the head and names it after the font everywhere', async () => {
    const output = await createNextProjectGenerator().generateProject(
      sampleWithHeadingClass(),
      template
    )
    const files = allFiles(output)
    const document = files.find((file) => file.path === 'pages/_document.js')

    expect(document?.content).toContain('font-family: Roboto Fallback;')
    expect(document?.content).toContain('size-adjust:')
    expect(document?.content).toContain("font-family: 'Roboto', Roboto Fallback, sans-serif;")
    expect(document?.content.match(/font-family: Roboto Fallback;/g)).toHaveLength(1)

    const brandHeading = files.find((file) =>
      /brand-heading\s*\{[^}]*font-family/.test(file.content)
    )
    expect(brandHeading?.content).toMatch(
      /brand-heading\s*\{[^}]*font-family: Roboto, Roboto Fallback;/
    )
  })
})
