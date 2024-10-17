import {
  FileType,
  GeneratedFile,
  GeneratedFolder,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
import { createJSXSyntax, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { CodeGenerator } from '@babel/generator'
import { resolveUIDLElement } from '@teleporthq/teleport-uidl-resolver'
import { ReactMapping } from '@teleporthq/teleport-component-generator-react'

const findFileInBuild = (
  name: string,
  ext: FileType,
  folder: Map<string, InMemoryFileRecord>
): GeneratedFile | undefined => {
  let file: GeneratedFile

  Array.from(folder.values()).find((item) => {
    file = item.files.find((f) => f.name === name && f.fileType === ext)
  })

  return file
}

const findFileInTemplate = (
  name: string,
  ext: FileType,
  folder: GeneratedFolder
): GeneratedFile | undefined => {
  let file: GeneratedFile | undefined
  file = folder.files.find((item) => item.name === name && item.fileType === ext)
  if (file) {
    return file
  }

  for (const subFolder of folder.subFolders) {
    const fileToFind = findFileInTemplate(name, ext, subFolder)
    if (fileToFind) {
      file = fileToFind
    }
  }

  return file
}

export class ProjectPluginInternationalization implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files, template } = structure
    if (uidl.internationalization === undefined) {
      return structure
    }

    const { languages, main, translations } = uidl.internationalization
    if (languages !== undefined && Object.keys(languages).length > 0) {
      const languageKeys = Object.keys(languages)
      const nextConfig = `module.exports = {
  i18n: {
    locales: [${languageKeys.map((key) => `'${key}'`).join(', ')}],
    defaultLocale: "${main.locale}",
  }
}`
      const existingNextConfig =
        findFileInBuild('next.config', FileType.JS, files) ||
        findFileInTemplate('next.config', FileType.JS, template)

      if (existingNextConfig) {
        // We need to handle this situation of merging the files.
        // At the moment we are just replacing the file.
      }

      files.set('next.config', {
        path: [],
        files: [
          {
            name: 'next.config',
            content: nextConfig,
            fileType: FileType.JS,
          },
        ],
      })
    }

    for (const locale of Object.keys(translations)) {
      const translation = translations[locale]
      const translationFile: Record<string, UIDLStaticValue['content']> = {}
      for (const id of Object.keys(translation)) {
        const item = translation[id]
        if (item?.type === 'element') {
          const resolvedElement = resolveUIDLElement(item.content, { mapping: ReactMapping })
          // We are creating templates here, but what about styling for these nodes.
          // They need to be handled to while adding these to the main component.
          const nodeAST = createJSXSyntax(
            {
              ...item,
              content: resolvedElement,
            },
            {
              stateDefinitions: {},
              propDefinitions: {},
              windowImports: {},
              dependencies: {},
              nodesLookup: {},
              localeReferences: [],
            },
            {
              dynamicReferencePrefixMap: {
                prop: 'props',
                state: '',
                local: '',
              },
              dependencyHandling: 'import',
              stateHandling: 'hooks',
              slotHandling: 'props',
              domHTMLInjection: (content: string) => ASTBuilders.createDOMInjectionNode(content),
            }
          )

          const html = new CodeGenerator(nodeAST, { jsescOption: { minimal: true } }).generate()
          translationFile[id] = html.code
        }

        if (item?.type === 'static') {
          translationFile[id] = item.content
        }
      }
      files.set(locale, {
        path: ['locales'],
        files: [
          {
            name: locale,
            content: JSON.stringify(translationFile, null, 2),
            fileType: FileType.JSON,
          },
        ],
      })
    }

    return structure
  }
}
