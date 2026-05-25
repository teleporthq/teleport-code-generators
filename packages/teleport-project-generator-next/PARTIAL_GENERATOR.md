# Next.js Partial Generator

Generate individual pieces of a Next.js project on demand, instead of regenerating everything.

## Installation

No new dependency needed. Everything is exported from `@teleporthq/teleport-project-generator-next`:

```ts
import {
  createNextPartialGenerator,
  splitProjectUIDL,
} from '@teleporthq/teleport-project-generator-next'
```

**Types** (if needed):

```ts
import type {
  NextPartialGeneratorOptions,
  PartialGenerationResult,
  FrameworkConfigInput,
  SplitProjectResult,
} from '@teleporthq/teleport-project-generator-next'
```

---

## Quick Start

### Option A: Starting from a full ProjectUIDL

Use `splitProjectUIDL` to split a full ProjectUIDL into individual pieces, then feed them to the partial generator one at a time.

```ts
import {
  createNextPartialGenerator,
  splitProjectUIDL,
} from '@teleporthq/teleport-project-generator-next'

// 1. Split the project UIDL once
const split = splitProjectUIDL(projectJSON)

// 2. Create the partial generator with shared options
const partial = createNextPartialGenerator(split.sharedOptions)

// 3. Generate only what you need
const pageResult = await partial.generatePage(split.pages[0])
const compResult = await partial.generateComponent(split.components['MyComponent'])
```

### Option B: Constructing inputs manually (incremental updates)

When you already have the shared context from a previous split, you can construct individual UIDLs directly for each generator method without re-splitting.

```ts
const partial = createNextPartialGenerator(savedSharedOptions)

// Generate a single page from a ComponentUIDL you built yourself
const result = await partial.generatePage(myPageUIDL)
```

---

## Return Type

Every generator method returns a `PartialGenerationResult`:

```ts
interface PartialGenerationResult {
  /** Generated source files */
  files: Array<{ name: string; fileType: string; content: string }>
  /** NPM package dependencies required by the generated code */
  dependencies: Record<string, string>
  /** Side-effect files (data source handlers, API routes) — only from generatePage/generateComponent */
  extractedResources?: Record<string, {
    fileName: string
    fileType: string
    path: string[]     // e.g. ['utils', 'data-sources'] or ['pages', 'api']
    content: string
  }>
}
```

### Writing files to disk

```ts
// Main files
result.files.forEach(file => {
  const ext = file.fileType ? `.${file.fileType}` : ''
  fs.writeFileSync(`${outputDir}/${file.name}${ext}`, file.content)
})

// Extracted resources (data source handlers, API routes)
if (result.extractedResources) {
  Object.values(result.extractedResources).forEach(res => {
    const dir = res.path.join('/')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/${res.fileName}.${res.fileType}`, res.content)
  })
}
```

---

## Generator Methods

### `generatePage(pageUIDL, options?)`

Generates a single Next.js page file with `getStaticProps`, `getStaticPaths`, data source bindings, i18n, Head meta, and form handling.

**Output path:** `pages/{folderPath}/{fileName}.js`

**Input:** A `ComponentUIDL` with page-specific fields:

```ts
const pageUIDL = {
  name: 'MyPage',
  node: { /* element tree */ },
  outputOptions: {
    componentClassName: 'MyPage',
    fileName: 'my-page',
    styleFileName: 'my-page',
    templateFileName: 'my-page',
    folderPath: [],                    // e.g. ['posts'] for nested routes
    initialPropsData: { /* ... */ },   // triggers getStaticProps
    initialPathsData: { /* ... */ },   // triggers getStaticPaths
    pagination: { /* ... */ },         // pagination config
  },
  seo: { title: 'My Page' },
  propDefinitions: { /* ... */ },
  stateDefinitions: { /* ... */ },
}

const result = await partial.generatePage(pageUIDL)
```

**Side effects:** If the page uses data sources, `result.extractedResources` will contain:
- `utils/data-sources/{type}-{table}-{id}.js` — The server-side data source handler
- `pages/api/{type}-{table}-{id}.js` — API route wrapper
- `pages/api/{type}-{table}-{id}-count.js` — Count endpoint (for pagination)

---

### `generateComponent(componentUIDL, options?)`

Generates a single reusable component.

**Output path:** `components/{fileName}.js`

**Input:** A `ComponentUIDL`:

```ts
const componentUIDL = {
  name: 'Navigation',
  node: { /* element tree */ },
  outputOptions: {
    componentClassName: 'Navigation',
    fileName: 'navigation',
    styleFileName: 'navigation',
    templateFileName: 'navigation',
    folderPath: [],
  },
}

const result = await partial.generateComponent(componentUIDL)
```

**Side effects:** If the component uses data sources, `result.extractedResources` will contain the same files as with pages:
- `utils/data-sources/{type}-{table}-{id}.js` — The server-side data source handler
- `pages/api/{type}-{table}-{id}.js` — API route wrapper
- `pages/api/{type}-{table}-{id}-count.js` — Count endpoint (for pagination)

---

### `generateStyleSheet(rootUIDL, options?)`

Generates the global CSS stylesheet from `styleSetDefinitions`.

**Output path:** `pages/style.css`

**Input:** The root `ComponentUIDL` (contains `styleSetDefinitions` and `designLanguage`):

```ts
const result = await partial.generateStyleSheet(split.rootUIDL)
// or with the project's root directly:
const result = await partial.generateStyleSheet(projectUIDL.root)
```

---

### `generateEntryFile(projectUIDL, options?)`

Generates `_document.js` (Next.js custom document with asset tags, fonts, meta).

**Output path:** `pages/_document.js`

**Input:** Full `ProjectUIDL` (reads `globals.settings`, `globals.assets`, `globals.meta`):

```ts
const result = partial.generateEntryFile(split.projectUIDL)
```

---

### `generateFrameworkConfig(configOptions?)`

Generates `_app.js` (Next.js custom app wrapper with global styles and providers).

**Output path:** `pages/_app.js`

**Input:**

```ts
const result = partial.generateFrameworkConfig({
  dependencies: hasI18n ? { 'next-intl': '^2.0.0' } : {},
  globalStyles: {
    path: './',
    sheetName: 'style',
    isGlobalStylesDependent: true,
  },
})
```

---

### `generateResource(resource, resourceMappers?)`

Generates a client-side resource fetcher module (thin wrapper that calls `/api/...`).

**Output path:** `resources/{resource-name}.js`

**Input:** A `UIDLResourceItem` from the project's resources:

```ts
for (const [key, resource] of Object.entries(split.resources.items)) {
  const result = await partial.generateResource(resource, split.resources.mappers)
}
```

---

### `generateLocaleFiles(internationalization?, projectStyleSet?)`

Generates JSON locale files for each language. Element-type translations are rendered through the JSX/CSS pipeline to produce real HTML.

**Output path:** `locales/{locale}.json`

**Input:**

```ts
const result = await partial.generateLocaleFiles(
  split.projectUIDL.internationalization
)
```

---

### `generateGlobalContext(internationalization?)`

Generates `global-context.js` (React context provider for locale state).

**Output path:** `global-context.js`

```ts
const result = partial.generateGlobalContext(
  split.projectUIDL.internationalization
)
```

---

### `generateNextConfig(internationalization?)`

Generates `next.config.js` (i18n routing) and `jsconfig.json` (path aliases).

**Output path:** `next.config.js`, `jsconfig.json`

```ts
const result = partial.generateNextConfig(
  split.projectUIDL.internationalization
)
```

---

### `generateEnvFiles(env)`

Generates `.env` and `.env.example` files.

**Output path:** `.env`, `.env.example`

```ts
if (split.env && Object.keys(split.env).length > 0) {
  const result = partial.generateEnvFiles(split.env)
}
```

---

### `generateManifest(projectUIDL, assets?)`

Generates `manifest.json` for PWA support.

**Output path:** `public/manifest.json`

```ts
const result = partial.generateManifest(split.projectUIDL)
```

---

### `resolveDataSourceDependencies(dataSources)`

Returns NPM dependencies required by the project's data sources. Does **not** generate files.

```ts
const deps = partial.resolveDataSourceDependencies(split.dataSources)
// { 'node-fetch': '^2.7.0', pg: '^8.11.0', ... }
```

---

### `generateExternalCSSImports(cssImportPaths)`

Returns import statements for external CSS packages (e.g. `import "package/style.css"`). Used to build the imports list for `_app.js`.

```ts
const cssImports = projectUIDL.root.importDefinitions || {}
const cssOnly = Object.entries(cssImports).reduce((acc, [key, dep]) => {
  if (dep.path.endsWith('.css')) acc[key] = dep
  return acc
}, {})
const importStatements = partial.generateExternalCSSImports(cssOnly)
```

---

### `updateOptions(options)`

Updates the shared options after construction without creating a new instance.

```ts
partial.updateOptions({
  internationalization: updatedI18nConfig,
})
```

---

## User Action to Generator Mapping

| Editor Action | Generator Method | What Changes |
|---|---|---|
| Edit node styling/attributes/content | `generatePage()` or `generateComponent()` | Page/component `.js` file |
| Add/remove node | `generatePage()` or `generateComponent()` | Page/component `.js` file |
| Create new page | `generatePage()` | New page `.js` file |
| Create new component | `generateComponent()` | New component `.js` file |
| Bind data source to a node | `generatePage()` or `generateComponent()` | Page/component `.js` + `extractedResources` (utils + API routes) |
| Change design tokens / CSS classes | `generateStyleSheet()` | `style.css` |
| Change project settings (title, assets, fonts) | `generateEntryFile()` | `_document.js` |
| Toggle i18n / add language | `generateFrameworkConfig()` + `generateLocaleFiles()` + `generateGlobalContext()` + `generateNextConfig()` | `_app.js`, locale JSONs, `global-context.js`, `next.config.js` |
| Edit translation text | `generateLocaleFiles()` | Affected `locales/{locale}.json` |
| Add/edit environment variable | `generateEnvFiles()` | `.env`, `.env.example` |
| Add/edit resource endpoint | `generateResource()` | `resources/{name}.js` |
| Change manifest settings | `generateManifest()` | `public/manifest.json` |

---

## Full Project Output Structure

When all generators run, the combined output produces:

```
pages/
  _document.js              ← generateEntryFile()
  _app.js                   ← generateFrameworkConfig()
  style.css                 ← generateStyleSheet()
  index.js                  ← generatePage() (home page)
  courses.js                ← generatePage()
  posts/
    index.js                ← generatePage() (nested route)
    [id].js                 ← generatePage() (dynamic route)
    page/
      [page].js             ← generatePage() (paginated route)
  api/
    google-sheets-*.js      ← extractedResources from generatePage()
    google-sheets-*-count.js
components/
  navigation.js             ← generateComponent()
  footer.js                 ← generateComponent()
resources/
  pagedata.js               ← generateResource()
utils/
  data-sources/
    google-sheets-*.js      ← extractedResources from generatePage()
locales/
  en.json                   ← generateLocaleFiles()
  fr.json                   ← generateLocaleFiles()
public/
  manifest.json             ← generateManifest()
global-context.js           ← generateGlobalContext()
next.config.js              ← generateNextConfig()
jsconfig.json               ← generateNextConfig()
.env                        ← generateEnvFiles()
.env.example                ← generateEnvFiles()
```

---

## Collecting Dependencies

Each generator returns its own `dependencies`. Merge them to build the final `package.json`:

```ts
const allDeps: Record<string, string> = {}

// After each generation step:
Object.assign(allDeps, pageResult.dependencies)
Object.assign(allDeps, compResult.dependencies)
Object.assign(allDeps, stylesheetResult.dependencies)
Object.assign(allDeps, configResult.dependencies)
// ... etc

// Data source deps (no files, just packages)
if (split.dataSources) {
  Object.assign(allDeps, partial.resolveDataSourceDependencies(split.dataSources))
}
```

---

## splitProjectUIDL Reference

`splitProjectUIDL` takes a raw project JSON (or parsed `ProjectUIDL`) and returns:

```ts
interface SplitProjectResult {
  projectUIDL: ProjectUIDL           // Parsed + validated
  pages: ComponentUIDL[]             // Ready for generatePage()
  components: Record<string, ComponentUIDL>  // Ready for generateComponent()
  rootUIDL: ComponentUIDL            // Ready for generateStyleSheet()
  sharedOptions: NextPartialGeneratorOptions  // Pass to createNextPartialGenerator()
  env?: Record<string, string>       // Ready for generateEnvFiles()
  resources: {
    items: Record<string, UIDLResourceItem>
    mappers: Record<string, any>
  }
  dataSources?: Record<string, any>  // Ready for resolveDataSourceDependencies()
}
```

The split handles:
- Parsing and validation
- Extracting page UIDLs from the route tree
- Setting `outputOptions` (fileName, folderPath, componentClassName) on all components
- Resolving local dependency import paths between pages and components
- Building the shared options object with design language, style sets, i18n config, etc.
