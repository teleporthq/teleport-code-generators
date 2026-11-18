import * as types from '@babel/types'
import { parse, parseExpression } from '@babel/parser'
import { CodeGenerator } from '@babel/generator'
import { JSIdentifiers, PageArrival, StringUtils } from '@teleporthq/teleport-shared'
import { ForumDetailsPage } from './settings'

/** The prop the page's extra data travels under (SEO, the community, the reply cursor). */
export const FORUM_PAGE_PROP = '__tqForum'
const DATA_IMPORT = '__tqForumData'

/** Which record a page is about. */
export type ForumPageRecord =
  /** The one its address ends with, by the route column (`slug`): `context.params[column]`. */
  | { column: string }
  /** Always the same one, by its slug: a page with a static address (`/forum/new`). */
  | { slug: string }

export type ForumPageRewrite = ForumPageRecord & {
  kind: ForumDetailsPage
  /** The prop the page reads its row from (`initialPropsData.exposeAs.name`), or null when it binds none. */
  exposeAs: string | null
  /** From the page's folder to the project root (`../../../` for `pages/forum/t/`). */
  rootPrefix: string
  /** `utils/forum-page-data`, under `rootPrefix`. */
  dataModulePath: string
  /** `utils/page-arrival`, under `rootPrefix`. */
  pageArrivalPath: string
}

/** The states each page declares (`forum-markers.ts` there) that start from the module's answer. */
export const FORUM_SEEDED_STATES: Record<ForumDetailsPage, string[]> = {
  topic: [
    'viewer',
    'topicDetails',
    'replies',
    'reactions',
    'score',
    'myVote',
    'hasMoreReplies',
    'replySort',
    'replyTo',
  ],
  community: [
    'viewer',
    'topics',
    'rules',
    'moderators',
    'sortBy',
    'paging',
    'pendingJoinCount',
    'openReportCount',
  ],
  manage: ['viewer', 'rulesText'],
  newTopic: ['viewer'],
}

/**
 * A seeded state the answer keeps elsewhere, as a path into it: `topicDetails`
 * is the topic the record prop reads; `rulesText` the community's rules as the
 * Manage form edits them (its field reads the state once, when it mounts).
 */
const SEED_ANSWER_PATH: Record<string, string> = {
  topicDetails: 'topic',
  rulesText: 'community.rules_text',
}

interface ForumPageSource {
  /** The module's call: `slug`, `session`, `query`, `one` and (with `url`) `pageUrl` are in scope. */
  load: string
  /** The answer's key the page's record prop (`exposeAs`) reads. */
  record: string
  /** What travels under `__tqForum`. */
  extra: string
  /** The call takes the page's address (the topic's JSON-LD). */
  url?: boolean
  /** An anonymous answer is cached at the edge; without it the page is every visitor's own. */
  shared?: boolean
}

const FORUM_PAGE_SOURCES: Record<ForumDetailsPage, ForumPageSource> = {
  topic: {
    load: `loadTopicPage({ slug, session, rootReplyId: one(query.reply), sort: one(query.sort), url: pageUrl })`,
    record: 'topic',
    extra: `{ seo: data.seo, community: data.community, nextReplyOffset: data.nextReplyOffset }`,
    url: true,
    shared: true,
  },
  community: {
    load: `loadCommunityPage({ slug, session, sort: one(query.sort), page: parseInt(one(query.page), 10) || 1 })`,
    record: 'community',
    extra: `{ seo: data.seo }`,
    shared: true,
  },
  // A community's Manage and New topic pages: one visitor's own, never in a search engine.
  manage: {
    load: `loadCommunityGate({ slug, session, need: 'moderate' })`,
    record: 'community',
    extra: `{ seo: { noindex: true } }`,
  },
  newTopic: {
    load: `loadCommunityGate({ slug, session, need: 'post' })`,
    record: 'community',
    extra: `{ seo: { noindex: true } }`,
  },
}

const DATA_FUNCTIONS = ['getStaticProps', 'getServerSideProps', 'getStaticPaths']
/** The page-access guard's verdict variable (`access-rules/page-access-guard-plugin.ts`). */
const ACCESS_DENIED = '__tqAccessDenied'
const SKIP_WALK_KEYS = new Set([
  'loc',
  'range',
  'start',
  'end',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

const walk = (node: unknown, visit: (node: types.Node) => void): void => {
  if (!node || typeof node !== 'object') {
    return
  }
  const anyNode = node as Record<string, unknown> & { type?: string }
  if (typeof anyNode.type === 'string') {
    visit(anyNode as unknown as types.Node)
  }
  for (const key of Object.keys(anyNode)) {
    if (SKIP_WALK_KEYS.has(key)) {
      continue
    }
    const value = anyNode[key]
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child, visit))
    } else if (value && typeof (value as { type?: string }).type === 'string') {
      walk(value, visit)
    }
  }
}

const mentions = (node: types.Node, name: string): boolean => {
  let found = false
  walk(node, (inner) => {
    if (inner.type === 'Identifier' && inner.name === name) {
      found = true
    }
  })
  return found
}

const exportedFunctionName = (statement: types.Statement): string | null =>
  statement.type === 'ExportNamedDeclaration' &&
  statement.declaration?.type === 'FunctionDeclaration' &&
  statement.declaration.id
    ? statement.declaration.id.name
    : null

/** Import bindings nothing in the program uses any more, once the data functions are gone. */
const dropUnusedImports = (program: types.Program, alsoUsedBy: types.Node[]): void => {
  const used = new Set<string>()
  walk(
    [...program.body.filter((statement) => statement.type !== 'ImportDeclaration'), ...alsoUsedBy],
    (node) => {
      if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
        used.add(node.name)
      }
    }
  )
  program.body = program.body.filter((statement) => {
    if (statement.type !== 'ImportDeclaration' || statement.specifiers.length === 0) {
      return true
    }
    // React stays whatever the JSX runtime: the generated pages import it by name.
    statement.specifiers = statement.specifiers.filter(
      (specifier) => specifier.local.name === 'React' || used.has(specifier.local.name)
    )
    return statement.specifiers.length > 0
  })
}

/**
 * The locale's messages of a project with internationalization: the locale
 * fetcher put them in the page's `getStaticProps`, which this rewrite takes
 * away. Without them `next-intl` has nothing to translate with, and every
 * word of the page — its navigation and footer too — shows its key.
 */
const LOCALE_MESSAGES_PATH = '/locales/'

/** Whether one of the data functions this rewrite takes away loaded the locale's messages. */
const loadsLocaleMessages = (statements: types.Statement[]): boolean => {
  let found = false
  walk(statements, (node) => {
    if (node.type === 'StringLiteral' && node.value === LOCALE_MESSAGES_PATH) {
      found = true
    }
  })
  return found
}

const dataFunctionSource = (rewrite: ForumPageRewrite, localized: boolean): string => {
  const source = FORUM_PAGE_SOURCES[rewrite.kind]
  const slug =
    'column' in rewrite
      ? `one(params[${JSON.stringify(rewrite.column)}])`
      : JSON.stringify(rewrite.slug)
  const seeded = FORUM_SEEDED_STATES[rewrite.kind]
    .map((state) => `${state}: data.${SEED_ANSWER_PATH[state] ?? state}`)
    .join(', ')
  const record = rewrite.exposeAs
    ? `${JSON.stringify(rewrite.exposeAs)}: data.${source.record},\n      `
    : ''
  const pageUrl = source.url
    ? `
  const host = String((req && req.headers && req.headers.host) || '')
  const pageUrl = /^[a-z0-9.-]+(:\\d+)?$/i.test(host) ? 'https://' + host + String(req.url || '').split('?')[0] : ''`
    : ''
  const cache = source.shared
    ? `session ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300'`
    : `'private, no-store'`
  return `// Rendered per request by the Forum plugin: who is asking decides what is shown.
export async function getServerSideProps(context) {
  const { params = {}, query = {}, req, res } = context
  const one = (value) => String(Array.isArray(value) ? value[0] : value == null ? '' : value)
  const slug = ${slug}
  const session = await ${DATA_IMPORT}.readSession(req)${pageUrl}
  const data = await ${DATA_IMPORT}.${source.load}
  if (!data) {
    res.setHeader('Cache-Control', 'no-store')
    return { notFound: true }
  }
  res.setHeader('Cache-Control', ${cache})${
    localized
      ? `
  const messages = (await import('${LOCALE_MESSAGES_PATH}' + context.locale + '.json')).default`
      : ''
  }
  return {
    props: {
      ...params,${localized ? '\n      messages,' : ''}
      ${record}${seeded},
      ${FORUM_PAGE_PROP}: ${source.extra},
    },
  }
}
`
}

const HEAD_CHILDREN = [
  `props.${FORUM_PAGE_PROP} && props.${FORUM_PAGE_PROP}.seo && props.${FORUM_PAGE_PROP}.seo.noindex ? <meta name="robots" content="noindex" /> : null`,
  `props.${FORUM_PAGE_PROP} && props.${FORUM_PAGE_PROP}.seo && props.${FORUM_PAGE_PROP}.seo.jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(props.${FORUM_PAGE_PROP}.seo.jsonLd).replace(/</g, '\\\\u003c') }} /> : null`,
]

const jsxExpressionChild = (source: string): types.JSXExpressionContainer =>
  types.jsxExpressionContainer(parseExpression(source, { plugins: ['jsx'] }) as types.Expression)

/** The page's component: what `export default` names (through the arrival wrapper when already wrapped). */
const pageComponent = (
  program: types.Program
): types.FunctionDeclaration | types.ArrowFunctionExpression | types.FunctionExpression | null => {
  const exportDefault = program.body.find(
    (statement): statement is types.ExportDefaultDeclaration =>
      statement.type === 'ExportDefaultDeclaration'
  )
  if (!exportDefault) {
    return null
  }
  let declaration: types.Node = exportDefault.declaration
  if (declaration.type === 'CallExpression' && declaration.arguments[0]) {
    declaration = declaration.arguments[0]
  }
  if (declaration.type === 'FunctionDeclaration') {
    return declaration
  }
  if (declaration.type !== 'Identifier') {
    return null
  }
  const name = declaration.name
  for (const statement of program.body) {
    if (statement.type === 'FunctionDeclaration' && statement.id?.name === name) {
      return statement
    }
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        if (
          declarator.id.type === 'Identifier' &&
          declarator.id.name === name &&
          declarator.init &&
          (declarator.init.type === 'ArrowFunctionExpression' ||
            declarator.init.type === 'FunctionExpression')
        ) {
          return declarator.init
        }
      }
    }
  }
  return null
}

const isSeededFromProps = (argument: types.Node | undefined, stateKey: string): boolean =>
  !!argument &&
  argument.type === 'ConditionalExpression' &&
  argument.test.type === 'BinaryExpression' &&
  argument.test.left.type === 'MemberExpression' &&
  argument.test.left.property.type === 'Identifier' &&
  argument.test.left.property.name === stateKey

/**
 * `const [viewer, setViewer] = useState(<default>)` becomes
 * `useState(props.viewer !== undefined ? props.viewer : <default>)` for every
 * state the module seeds — the same shape the React base component emits for
 * a state with a data-source binding (`createStateHookAST`), so a page whose
 * states already carry one is left as it is. Returns the states seeded.
 */
const seedStatesFromProps = (component: types.Node, stateKeys: string[]): string[] => {
  const seeded: string[] = []
  const names = new Map(stateKeys.map((key) => [JSIdentifiers.createSafeJSIdentifier(key), key]))
  walk(component, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'ArrayPattern' || !node.init) {
      return
    }
    const first = node.id.elements[0]
    const init = node.init
    if (
      !first ||
      first.type !== 'Identifier' ||
      !names.has(first.name) ||
      init.type !== 'CallExpression' ||
      init.callee.type !== 'Identifier' ||
      init.callee.name !== 'useState'
    ) {
      return
    }
    const stateKey = names.get(first.name) as string
    const fallback =
      (init.arguments[0] as types.Expression | undefined) ?? types.identifier('undefined')
    if (isSeededFromProps(fallback, stateKey)) {
      seeded.push(stateKey)
      return
    }
    const propAccess = () =>
      types.memberExpression(
        types.identifier('props'),
        types.identifier(StringUtils.createStateOrPropStoringValue(stateKey))
      )
    init.arguments = [
      types.conditionalExpression(
        types.binaryExpression('!==', propAccess(), types.identifier('undefined')),
        propAccess(),
        fallback
      ),
    ]
    seeded.push(stateKey)
  })
  return seeded
}

/** The helper the workflows plugin shapes a record into a form state with. */
const RECORD_FORM_HELPER = '__normalizeAdminFormRow'

const isRecordCopyInto = (statement: types.Statement, setters: Set<string>): boolean =>
  statement.type === 'ExpressionStatement' &&
  statement.expression.type === 'CallExpression' &&
  statement.expression.callee.type === 'Identifier' &&
  setters.has(statement.expression.callee.name) &&
  statement.expression.arguments[0]?.type === 'CallExpression' &&
  statement.expression.arguments[0].callee.type === 'Identifier' &&
  statement.expression.arguments[0].callee.name === RECORD_FORM_HELPER

/** `useEffect(() => { if (<test>) {} }, [])`: an effect whose only branch was emptied. */
const isEmptiedEffect = (statement: types.Statement): boolean => {
  if (
    statement.type !== 'ExpressionStatement' ||
    statement.expression.type !== 'CallExpression' ||
    statement.expression.callee.type !== 'Identifier' ||
    statement.expression.callee.name !== 'useEffect'
  ) {
    return false
  }
  const effect = statement.expression.arguments[0]
  if (effect?.type !== 'ArrowFunctionExpression' || effect.body.type !== 'BlockStatement') {
    return false
  }
  const [only, ...rest] = effect.body.body
  return (
    rest.length === 0 &&
    only?.type === 'IfStatement' &&
    !only.alternate &&
    only.consequent.type === 'BlockStatement' &&
    only.consequent.body.length === 0
  )
}

/**
 * On a details page the workflows plugin copies the record into "the page's
 * form" when it mounts — the first object state it finds, shaped by that
 * state's defaults. On a forum page that state is one the module seeds
 * (`viewer`): the copy would put its signed-out defaults back right after the
 * first render. Every seeded state's copy is dropped, and the effect with it
 * once it sets nothing else. Returns the states that lost one.
 */
const dropRecordCopies = (component: types.Node, seededStates: string[]): string[] => {
  const stateBySetter = new Map(
    seededStates.map((state) => [StringUtils.createStateStoringFunction(state), state])
  )
  const setters = new Set(stateBySetter.keys())
  const dropped: string[] = []
  walk(component, (node) => {
    if (node.type !== 'BlockStatement') {
      return
    }
    node.body = node.body.filter((statement) => {
      if (!isRecordCopyInto(statement, setters)) {
        return true
      }
      const call = (statement as types.ExpressionStatement).expression as types.CallExpression
      dropped.push(stateBySetter.get((call.callee as types.Identifier).name) as string)
      return false
    })
  })
  if (dropped.length > 0) {
    walk(component, (node) => {
      if (node.type === 'BlockStatement') {
        node.body = node.body.filter((statement) => !isEmptiedEffect(statement))
      }
    })
  }
  return dropped
}

const ensurePropsParam = (component: types.Node): void => {
  const fn = component as
    | types.FunctionDeclaration
    | types.ArrowFunctionExpression
    | types.FunctionExpression
  if (fn.params.length === 0) {
    fn.params.push(types.identifier('props'))
  }
}

const injectHead = (program: types.Program): boolean => {
  let injected = false
  walk(program, (node) => {
    if (injected || node.type !== 'JSXElement') {
      return
    }
    const name = node.openingElement.name
    if (name.type !== 'JSXIdentifier' || name.name !== 'Head') {
      return
    }
    HEAD_CHILDREN.forEach((source) => node.children.push(jsxExpressionChild(source)))
    if (node.openingElement.selfClosing) {
      node.openingElement.selfClosing = false
      node.closingElement = types.jsxClosingElement(types.jsxIdentifier('Head'))
    }
    injected = true
  })
  return injected
}

const wrapForArrival = (program: types.Program, rewrite: ForumPageRewrite): void => {
  const exportDefault = program.body.find(
    (statement): statement is types.ExportDefaultDeclaration =>
      statement.type === 'ExportDefaultDeclaration'
  )
  if (!exportDefault || exportDefault.declaration.type !== 'Identifier') {
    return
  }
  exportDefault.declaration = types.callExpression(
    types.identifier(PageArrival.PAGE_ARRIVAL_WRAPPER),
    [exportDefault.declaration]
  )
  program.body.unshift(
    types.importDeclaration(
      [types.importDefaultSpecifier(types.identifier(PageArrival.PAGE_ARRIVAL_WRAPPER))],
      types.stringLiteral(`${rewrite.rootPrefix}${rewrite.pageArrivalPath}`)
    )
  )
}

export interface ForumPageRewriteResult {
  content: string
  /** The states now seeded from the page's props. */
  seededStates: string[]
  /** The page's head got the robots and JSON-LD lines. */
  headInjected: boolean
  /** The page now remounts on every arrival (needs `utils/page-arrival.js`). */
  remounts: boolean
}

/**
 * Rewrites a generated forum details page (the topic, the community, its
 * Manage and New topic pages) — or the static New topic page of a forum
 * without communities — so it renders per request from the forum data
 * module: its `getStaticProps` / `getStaticPaths` (or an earlier
 * `getServerSideProps`) are replaced by one that reads the session, calls the
 * module, answers `notFound` when it refuses and sets the cache header; the
 * page's own states start from the module's answer through its props, and
 * keep it (no copy of the record over them on mount); the
 * head carries `noindex` and the JSON-LD when the module says so; and the page
 * remounts on every arrival, as every page seeded from props does. Returns
 * null when the file is not a page this can rewrite (no default export).
 */
export const rewriteForumPage = (
  content: string,
  rewrite: ForumPageRewrite
): ForumPageRewriteResult | null => {
  const ast = parse(content, { sourceType: 'module', plugins: ['jsx'] })
  const program = ast.program
  const component = pageComponent(program)
  if (!component) {
    return null
  }
  const alreadyWrapped = program.body.some(
    (statement) =>
      statement.type === 'ExportDefaultDeclaration' &&
      statement.declaration.type === 'CallExpression' &&
      statement.declaration.callee.type === 'Identifier' &&
      statement.declaration.callee.name === PageArrival.PAGE_ARRIVAL_WRAPPER
  )

  // A protected page's guard (`access-rules/page-access-guard-plugin.ts`) opens
  // its data function; it opens the new one too.
  const guard: types.Statement[] = []
  const removed: types.Statement[] = []
  program.body = program.body.filter((statement) => {
    const name = exportedFunctionName(statement)
    if (name === 'getServerSideProps') {
      const body = (statement as types.ExportNamedDeclaration)
        .declaration as types.FunctionDeclaration
      guard.push(...body.body.body.filter((inner) => mentions(inner, ACCESS_DENIED)))
    }
    const isDataFunction = !!name && DATA_FUNCTIONS.includes(name)
    if (isDataFunction) {
      removed.push(statement)
    }
    return !isDataFunction
  })
  dropUnusedImports(program, guard)

  const dataFunction = parse(dataFunctionSource(rewrite, loadsLocaleMessages(removed)), {
    sourceType: 'module',
  }).program.body
  const declaration = (dataFunction[0] as types.ExportNamedDeclaration)
    .declaration as types.FunctionDeclaration
  declaration.body.body.splice(1, 0, ...guard)
  program.body.push(...dataFunction)
  program.body.unshift(
    types.importDeclaration(
      [types.importDefaultSpecifier(types.identifier(DATA_IMPORT))],
      types.stringLiteral(`${rewrite.rootPrefix}${rewrite.dataModulePath}`)
    )
  )

  ensurePropsParam(component)
  const seededStates = seedStatesFromProps(component, FORUM_SEEDED_STATES[rewrite.kind])
  dropRecordCopies(component, seededStates)
  const headInjected = injectHead(program)
  if (!alreadyWrapped) {
    wrapForArrival(program, rewrite)
  }

  const generated = new CodeGenerator(ast, {
    jsescOption: { minimal: true },
    retainLines: false,
  }).generate()
  return { content: generated.code, seededStates, headInjected, remounts: true }
}
