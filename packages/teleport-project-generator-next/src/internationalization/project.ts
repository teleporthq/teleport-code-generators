import {
  FileType,
  GeneratedFile,
  GeneratedFolder,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLCustomUserProperty,
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

const generateJsConfigFile = () => {
  return `
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}`
}

const generatePickUserEntries = (customProps: UIDLCustomUserProperty[]): string => {
  if (customProps.length === 0) {
    return ''
  }
  return (
    ', ' + customProps.map((p) => `${p.key}: u.${p.key} != null ? u.${p.key} : null`).join(', ')
  )
}

const generateGlobalContextFileContent = (
  locales: Record<string, string>,
  main: {
    name: string
    locale: string
  },
  authEnabled?: boolean,
  customUserProperties?: UIDLCustomUserProperty[]
) => {
  const localesArray = Object.keys(locales).map((key) => ({ name: locales[key], short: key }))
  const currentLocale = localesArray.find((locale) => locale.short === main.locale)
  const customEntries = generatePickUserEntries(customUserProperties || [])

  const authState = authEnabled
    ? `
  const [currentUser, setCurrentUser] = useState(null)

  const pickUser = (u) => {
    if (!u) return null
    return { id: u.id || null, name: u.name || null, email: u.email || null, emailVerified: u.emailVerified || null, image: u.image || null, role: u.role || null${customEntries} }
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session')
      .then((res) => res.ok ? res.json() : null)
      .then((session) => {
        if (!cancelled && session && session.user) {
          setCurrentUser(pickUser(session.user))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handler = (e) => {
      setCurrentUser(e.detail && e.detail.user ? pickUser(e.detail.user) : null)
    }
    window.addEventListener('teleport:auth-user-changed', handler)
    return () => window.removeEventListener('teleport:auth-user-changed', handler)
  }, [])
`
    : ''

  const authValueEntries = authEnabled
    ? `\n      currentUser,\n      setCurrentUser,\n      userIsLoggedIn: currentUser !== null,`
    : ''
  const authMemoEntries = authEnabled ? ', currentUser' : ''

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
  }, [locales, localeValue])
${authState}
  const value = useMemo(() => {
    return {
      locales,
      locale,
      setLocales,
      setLocale,${authValueEntries}
    }
  }, [locales, locale${authMemoEntries}])

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

const extractBaseUrl = (
  routeValues: Array<{ seo?: { assets?: Array<{ type: string }> } }>
): string | null => {
  for (const route of routeValues) {
    const canonical = route.seo?.assets?.find((a) => a.type === 'canonical') as
      | { type: 'canonical'; path: string }
      | undefined
    if (canonical) {
      try {
        return new URL(canonical.path).origin
      } catch {
        /* skip invalid URLs */
      }
    }
  }
  return null
}

const generateSitemapContent = (
  uidl: ProjectUIDL,
  languages: Record<string, string>,
  main: { locale: string; name: string }
): string | null => {
  const routeValues = uidl.root.stateDefinitions?.route?.values || []
  const locales = Object.keys(languages)
  const hasMultipleLocales = locales.length > 1
  const homePageName = uidl.root.stateDefinitions?.route?.defaultValue || 'index'

  const baseUrl = extractBaseUrl(routeValues)
  if (!baseUrl) {
    return null
  }

  const currentDate = new Date().toISOString().split('T')[0]

  const indexablePages = routeValues.filter((route) => {
    if (route.pageOptions?.fallback) {
      return false
    }
    const hasNoIndex = route.seo?.metaTags?.some(
      (tag: { name?: string; content?: string }) =>
        tag.name === 'robots' && tag.content === 'noindex'
    )
    if (hasNoIndex) {
      return false
    }
    return true
  })

  if (indexablePages.length === 0) {
    return null
  }

  const urlBlocks: string[] = []

  for (const route of indexablePages) {
    const pagePath = route.pageOptions?.navLink || (route.value === homePageName ? '/' : '/')
    const isHomePage = pagePath === '/'
    const fullDefaultUrl = baseUrl + pagePath

    if (hasMultipleLocales) {
      for (const locale of locales) {
        const localePrefix = locale === main.locale ? '' : '/' + locale
        const locUrl = baseUrl + localePrefix + (isHomePage && localePrefix ? '' : pagePath)

        const xhtmlLinks = [
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${fullDefaultUrl}" />`,
          ...locales.map((l) => {
            const lPrefix = l === main.locale ? '' : '/' + l
            return `    <xhtml:link rel="alternate" hreflang="${l}" href="${baseUrl}${lPrefix}${
              isHomePage && lPrefix ? '' : pagePath
            }" />`
          }),
        ]

        urlBlocks.push(
          [
            `  <url>`,
            `    <loc>${locUrl}</loc>`,
            `    <lastmod>${currentDate}</lastmod>`,
            `    <changefreq>weekly</changefreq>`,
            `    <priority>${isHomePage ? '1.0' : '0.8'}</priority>`,
            ...xhtmlLinks,
            `  </url>`,
          ].join('\n')
        )
      }
    } else {
      urlBlocks.push(
        [
          `  <url>`,
          `    <loc>${fullDefaultUrl}</loc>`,
          `    <lastmod>${currentDate}</lastmod>`,
          `    <changefreq>weekly</changefreq>`,
          `    <priority>${isHomePage ? '1.0' : '0.8'}</priority>`,
          `  </url>`,
        ].join('\n')
      )
    }
  }

  const namespaces = hasMultipleLocales
    ? [
        '  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '  xmlns:xhtml="http://www.w3.org/TR/xhtml11/xhtml11_schema.html">',
      ].join('\n')
    : '  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset',
    namespaces,
    ...urlBlocks,
    '</urlset>',
  ].join('\n')
}

export class NextProjectPlugini18nConfig implements ProjectPlugin {
  private generateSitemap: boolean

  constructor(options?: { generateSitemap?: boolean }) {
    this.generateSitemap = options?.generateSitemap ?? false
  }

  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files, template } = structure

    const {
      languages = { en: 'English' },
      main = { locale: 'en', name: 'English' },
      ignoreBrowserLanguage = false,
    } = uidl.internationalization || {}

    if (languages !== undefined && Object.keys(languages).length > 0) {
      const languageKeys = Object.keys(languages)
      const nextConfig = `module.exports = {
  i18n: {
    locales: [${languageKeys.map((key) => `'${key}'`).join(', ')}],
    defaultLocale: "${main.locale}",${ignoreBrowserLanguage ? '\n    localeDetection: false,' : ''}
  },
  webpack: (config, { isServer }) => {
    // Generated data-source modules (utils/data-sources/*.js) import Node-only
    // packages like 'pg'. When a page only uses them server-side (getStaticProps
    // / API routes) Next.js normally tree-shakes them from the client bundle,
    // but if a dead import sneaks into a page the client build tries to resolve
    // 'fs', 'net', etc. and fails. Stub these on the client so the build
    // succeeds and the modules remain server-only at runtime.
    if (!isServer) {
      config.resolve.fallback = Object.assign({}, config.resolve.fallback, {
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        'pg-native': false,
      })
    }
    return config
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

      const sitemapContent = this.generateSitemap
        ? generateSitemapContent(uidl, languages, main)
        : null
      if (sitemapContent) {
        files.set('sitemap', {
          path: ['public'],
          files: [
            {
              name: 'sitemap',
              content: sitemapContent,
              fileType: 'xml',
            },
          ],
        })
      }
    }

    const authEnabled = !!uidl.authentication?.enabled
    const customUserProperties = uidl.authentication?.customUserProperties || []
    const globalContextFile = generateGlobalContextFileContent(
      languages,
      main,
      authEnabled,
      customUserProperties
    )
    files.set('global-context.js', {
      path: [],
      files: [
        {
          name: 'global-context',
          content: globalContextFile,
          fileType: FileType.JS,
        },
      ],
    })

    const jsConfigFile = generateJsConfigFile()
    files.set('jsconfig.json', {
      path: [],
      files: [
        {
          name: 'jsconfig',
          content: jsConfigFile,
          fileType: FileType.JSON,
        },
      ],
    })

    return structure
  }
}
