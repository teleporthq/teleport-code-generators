import {
  FileType,
  GeneratedFile,
  GeneratedFolder,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'

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

const generateGlobalContextFileContent = (
  locales: Record<string, string>,
  main: {
    name: string
    locale: string
  }
) => {
  const localesArray = Object.keys(locales).map((key) => ({ name: locales[key], short: key }))
  const currentLocale = localesArray.find((locale) => locale.short === main.locale)
  return `
import { createContext, useMemo, useContext, useState, useEffect } from 'react'
import { useLocale } from "next-intl";

const GlobalContext = createContext(null)

export const GlobalProvider = ({ initialLocales, children }) => {
  const localeValue = useLocale()
  const [locales, setLocales] = useState(initialLocales ?? ${JSON.stringify(localesArray)})
  const [locale, setLocale] = useState(${JSON.stringify(currentLocale)})
  
  useEffect(() => {
    if (!locales) {
      return
    }

    const currentLangValue = locales.find((el) => el.short === localeValue)
    setLocale(currentLangValue)
  }, [locales])

  const value = useMemo(() => {
    return {
      locales,
      locale,
      setLocales,
      setLocale
    }
  }, [locales, locale])

  return (
    <GlobalContext.Provider value={value}>
      {children}
    </GlobalContext.Provider>
  )
}

export const useGlobalContext = () => {
  const context = useContext(GlobalContext)
  if (!context) {
    throw new Error('useGlobalContext must be used within a GlobalProvider')
  }

  return {
    ...context
  }
}
`
}

export class NextProjectPlugini18nConfig implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files, template } = structure
    if (uidl.internationalization === undefined) {
      return structure
    }

    const { languages, main } = uidl.internationalization
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

    const globalContextFile = generateGlobalContextFileContent(languages, main)
    files.set('global-context.js', {
      path: [],
      files: [
        {
          name: 'global-context.js',
          content: globalContextFile,
        },
      ],
    })

    return structure
  }
}
