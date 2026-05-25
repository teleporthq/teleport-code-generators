import { FileType } from '@teleporthq/teleport-types'
import componentSample from '../../../examples/test-samples/component-sample.json'
import projectSample from '../../../examples/test-samples/project-sample.json'
import projectWithTokens from '../../../examples/test-samples/project-with-only-tokens.json'
import { createNextPartialGenerator } from '../src/partial'

describe('Next.js Partial Generator', () => {
  describe('generateComponent', () => {
    it('generates a single component from a ComponentUIDL', async () => {
      const partial = createNextPartialGenerator()
      const result = await partial.generateComponent(componentSample as any)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('Hello World!')
      expect(jsFile.content).toContain('props')
    })

    it('generates a component with styled-jsx styles', async () => {
      const styledUIDL = {
        name: 'StyledComponent',
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            style: {
              color: { type: 'static', content: 'red' },
              padding: { type: 'static', content: '10px' },
            },
            children: [{ type: 'static', content: 'Styled content' }],
          },
        },
      }

      const partial = createNextPartialGenerator()
      const result = await partial.generateComponent(styledUIDL as any)

      expect(result.files).toBeDefined()
      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('Styled content')
    })

    it('returns dependencies used by the component', async () => {
      const partial = createNextPartialGenerator()
      const result = await partial.generateComponent(componentSample as any)

      expect(result.dependencies).toBeDefined()
      expect(typeof result.dependencies).toBe('object')
    })
  })

  describe('generatePage', () => {
    it('generates a single page from a page-shaped ComponentUIDL', async () => {
      const pageUIDL = {
        name: 'HomePage',
        outputOptions: {
          componentClassName: 'HomePage',
          fileName: 'index',
        },
        seo: {
          title: 'Home Page',
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [{ type: 'static', content: 'Welcome home' }],
          },
        },
      }

      const partial = createNextPartialGenerator()
      const result = await partial.generatePage(pageUIDL as any)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('Welcome home')
    })

    it('generates a page with Head config for SEO', async () => {
      const pageUIDL = {
        name: 'SeoPage',
        outputOptions: {
          componentClassName: 'SeoPage',
          fileName: 'seo-page',
        },
        seo: {
          title: 'SEO Title',
          metaTags: [{ name: 'description', value: 'A description' }],
        },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [{ type: 'static', content: 'Page with SEO' }],
          },
        },
      }

      const partial = createNextPartialGenerator()
      const result = await partial.generatePage(pageUIDL as any)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain('Head')
      expect(jsFile.content).toContain('SEO Title')
    })

    it('provides extractedResources for API routes', async () => {
      const pageUIDL = {
        name: 'SimplePage',
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [{ type: 'static', content: 'Simple' }],
          },
        },
      }

      const partial = createNextPartialGenerator()
      const result = await partial.generatePage(pageUIDL as any)

      expect(result.extractedResources).toBeDefined()
      expect(typeof result.extractedResources).toBe('object')
    })
  })

  describe('generateStyleSheet', () => {
    it('generates a global CSS stylesheet from root UIDL with design tokens', async () => {
      const rootUIDL = (projectWithTokens as any).root

      const partial = createNextPartialGenerator()
      const result = await partial.generateStyleSheet(rootUIDL)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const cssFile = result.files.find((f) => f.fileType === FileType.CSS)
      expect(cssFile).toBeDefined()
      expect(cssFile.content).toContain('--greys-500')
    })
  })

  describe('generateEntryFile', () => {
    it('generates _document.js from a ProjectUIDL', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateEntryFile(projectSample as any)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.name).toBe('_document')
      expect(jsFile.content).toContain('Document')
      expect(jsFile.content).toContain('Html')
      expect(jsFile.content).toContain('Head')
      expect(jsFile.content).toContain('Main')
      expect(jsFile.content).toContain('NextScript')
    })

    it('includes lang attribute from globals settings', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateEntryFile(projectSample as any)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile.content).toContain('lang')
      expect(jsFile.content).toContain('en')
    })
  })

  describe('generateFrameworkConfig', () => {
    it('generates _app.js with GlobalProvider wrapper', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateFrameworkConfig()

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.name).toBe('_app')
      expect(jsFile.content).toContain('Component')
      expect(jsFile.content).toContain('pageProps')
    })

    it('generates _app.js with global styles import when configured', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateFrameworkConfig({
        globalStyles: {
          path: './',
          sheetName: 'style',
          isGlobalStylesDependent: true,
        },
      })

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import './style.css'")
    })
  })

  describe('generateResource', () => {
    it('generates a resource endpoint file from a UIDLResourceItem', async () => {
      const resource = {
        name: 'GetPosts',
        path: {
          baseUrl: { type: 'static', content: 'https://api.example.com' },
          route: { type: 'static', content: '/posts' },
        },
        method: 'GET' as const,
        mappers: [] as string[],
      }

      const partial = createNextPartialGenerator()
      const result = await partial.generateResource(resource as any)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)

      const jsFile = result.files.find((f) => f.fileType === FileType.JS)
      expect(jsFile).toBeDefined()
      expect(jsFile.name).toBe('get-posts')
      expect(jsFile.content).toContain('export default')
    })
  })

  describe('generateManifest', () => {
    it('generates manifest.json from a ProjectUIDL with manifest config', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateManifest(projectSample as any)

      expect(result.files).toBeDefined()
      expect(result.files.length).toBe(1)

      const manifestFile = result.files[0]
      expect(manifestFile.name).toBe('manifest')
      expect(manifestFile.fileType).toBe(FileType.JSON)

      const content = JSON.parse(manifestFile.content)
      expect(content.name).toBe('myVueProject')
      expect(content.display).toBe('standalone')
      expect(content.icons).toBeDefined()
      expect(content.icons.length).toBe(2)
    })

    it('returns empty files when no manifest is configured', () => {
      const noManifestUIDL = {
        name: 'TestProject',
        globals: {
          settings: { title: 'Test', language: 'en' },
          meta: [] as Array<Record<string, string>>,
          assets: [] as any[],
        },
      }

      const partial = createNextPartialGenerator()
      const result = partial.generateManifest(noManifestUIDL as any)

      expect(result.files).toHaveLength(0)
    })
  })

  describe('generateEnvFiles', () => {
    it('generates .env and .env.example files', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateEnvFiles({
        API_URL: 'https://api.example.com',
        SECRET_KEY: 'my-secret',
      })

      expect(result.files).toHaveLength(2)

      const envFile = result.files.find((f) => f.name === '.env')
      expect(envFile).toBeDefined()
      expect(envFile.content).toContain('API_URL=https://api.example.com')
      expect(envFile.content).toContain('SECRET_KEY=my-secret')

      const envExampleFile = result.files.find((f) => f.name === '.env.example')
      expect(envExampleFile).toBeDefined()
      expect(envExampleFile.content).toContain('API_URL=')
      expect(envExampleFile.content).toContain('SECRET_KEY=')
      expect(envExampleFile.content).not.toContain('my-secret')
    })
  })

  describe('resolveDataSourceDependencies', () => {
    it('returns correct npm packages for known data source types', () => {
      const partial = createNextPartialGenerator()
      const deps = partial.resolveDataSourceDependencies({
        db1: { id: 'db1', name: 'Main DB', type: 'postgresql' as any, config: {} },
        db2: { id: 'db2', name: 'Cache', type: 'redis' as any, config: {} },
      })

      expect(deps.pg).toBe('^8.11.0')
      expect(deps.redis).toBe('^4.6.0')
    })

    it('skips data sources with no external dependency', () => {
      const partial = createNextPartialGenerator()
      const deps = partial.resolveDataSourceDependencies({
        db1: { id: 'db1', name: 'JS Source', type: 'javascript' as any, config: {} },
        db2: { id: 'db2', name: 'Static', type: 'static-collection' as any, config: {} },
      })

      expect(Object.keys(deps)).toHaveLength(0)
    })

    it('handles scoped packages correctly', () => {
      const partial = createNextPartialGenerator()
      const deps = partial.resolveDataSourceDependencies({
        db1: { id: 'db1', name: 'Supabase', type: 'supabase' as any, config: {} },
        db2: { id: 'db2', name: 'ClickHouse', type: 'clickhouse' as any, config: {} },
      })

      expect(deps['@supabase/supabase-js']).toBe('^2.38.0')
      expect(deps['@clickhouse/client']).toBe('^1.13.0')
    })
  })

  describe('generateExternalCSSImports', () => {
    it('generates import statements for CSS dependencies', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateExternalCSSImports({
        antd: { type: 'package', path: 'antd/dist/antd.css', version: 'latest' },
        react: { type: 'library', path: 'react', version: '17.0.2' },
      })

      expect(result).toContain('import "antd/dist/antd.css"')
      expect(result).not.toContain('react')
    })

    it('returns empty string when no CSS imports exist', () => {
      const partial = createNextPartialGenerator()
      const result = partial.generateExternalCSSImports({
        react: { type: 'library', path: 'react', version: '17.0.2' },
      })

      expect(result).toBe('')
    })
  })

  describe('updateOptions', () => {
    it('updates shared options for subsequent calls', async () => {
      const partial = createNextPartialGenerator()

      partial.updateOptions({
        assets: { prefix: '/custom-prefix/' },
      })

      const simpleComponent = {
        name: 'TestComponent',
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [{ type: 'static', content: 'Test' }],
          },
        },
      }

      const result = await partial.generateComponent(simpleComponent as any)
      expect(result.files).toBeDefined()
      expect(result.files.length).toBeGreaterThan(0)
    })
  })
})
