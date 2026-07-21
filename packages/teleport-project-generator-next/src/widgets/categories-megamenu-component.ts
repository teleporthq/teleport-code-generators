/**
 * Generates the TqCategoriesMegamenu wrapper — the "Category Menu" primitive
 * (`<tq-categories-megamenu>`). A single "Shop by Category" dropdown built from
 * the `categoriesData` taxonomy (a flat `{ id, name, parentId, order, icon? }[]`
 * baked in at export). Every category is a real `<a>` linking to the
 * products-list page with `?<paramKey>=<id>`, so the whole tree is crawlable and
 * SSR-rendered; the button only toggles the panel's visibility. A selected
 * parent id matches its whole subtree via the products' materialized
 * `category_filter_ids`.
 */
export const generateCategoriesMegamenuComponentCode = (): string => {
  return `import React, { useState } from 'react'
import { useRouter } from 'next/router'

const sanitizeSvg = (svg) => {
  if (typeof svg !== 'string' || !svg.trim()) {
    return ''
  }
  return svg
    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
    .replace(/\\son\\w+\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

// Resolve a category's name/description to \`locale\` from its \`translations\`
// map (baked in verbatim at export, alongside the main-language fields),
// falling back to the main-language values when there's no override yet.
const resolveCategoryLocale = (cat, locale) => {
  const override = locale && cat.translations ? cat.translations[locale] : null
  if (!override) {
    return cat
  }
  return Object.assign({}, cat, {
    name: override.name || cat.name,
    description: override.description || cat.description,
  })
}

const buildCategoryTree = (categories, locale) => {
  const list = (Array.isArray(categories) ? categories : []).map((cat) =>
    resolveCategoryLocale(cat, locale)
  )
  const ids = new Set(list.map((cat) => cat.id))
  const byParent = {}
  list.forEach((cat) => {
    const key = cat.parentId && ids.has(cat.parentId) ? cat.parentId : '__root__'
    if (!byParent[key]) {
      byParent[key] = []
    }
    byParent[key].push(cat)
  })
  const sortNodes = (a, b) =>
    (a.order || 0) - (b.order || 0) || String(a.name || '').localeCompare(String(b.name || ''))
  const build = (key, seen) =>
    (byParent[key] || [])
      .slice()
      .sort(sortNodes)
      .filter((cat) => !seen.has(cat.id))
      .map((cat) => {
        seen.add(cat.id)
        return Object.assign({}, cat, { children: build(cat.id, seen) })
      })
  return build('__root__', new Set())
}

// categoriesData / productsListHref / paramKey / buttonLabel / previewOpen are
// destructured so they never leak onto the DOM through {...rest}. previewOpen is
// an editor-only flag — the store always starts collapsed.
const TqCategoriesMegamenu = ({
  id,
  categoriesData = [],
  productsListHref = '/products-list',
  paramKey = 'categoryFilter',
  buttonLabel = 'Shop by Category',
  previewOpen,
  ...rest
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const tree = buildCategoryTree(categoriesData, router.locale)

  const hrefFor = (categoryId) =>
    productsListHref + '?' + paramKey + '=' + encodeURIComponent(categoryId)

  const renderNodes = (nodes, depth) =>
    nodes.map((cat) => (
      <div key={cat.id}>
        <a
          href={hrefFor(cat.id)}
          title={cat.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            paddingLeft: 14 + depth * 16 + 'px',
            textDecoration: 'none',
            color: '#111827',
            fontSize: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {cat.icon ? (
            <span
              style={{ display: 'inline-flex', width: '16px', height: '16px' }}
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(cat.icon) }}
            />
          ) : null}
          <span>{cat.name}</span>
        </a>
        {cat.children && cat.children.length ? renderNodes(cat.children, depth + 1) : null}
      </div>
    ))

  return (
    <div {...rest} data-thq="categories-megamenu-node" style={Object.assign({ position: 'relative', display: 'inline-block', minWidth: '220px' }, rest.style)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          background: '#ffffff',
          color: '#111827',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        <span>{buttonLabel}</span>
        <span style={{ fontSize: '10px', marginLeft: 'auto' }}>{'\\u25be'}</span>
      </button>
      <div
        style={{
          display: open ? 'block' : 'none',
          position: 'absolute',
          top: '100%',
          left: 0,
          width: '100%',
          zIndex: 20,
          marginTop: '4px',
          maxHeight: '360px',
          overflowY: 'auto',
          padding: '6px 0',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          background: '#ffffff',
          boxShadow: '0 8px 24px rgba(17, 24, 39, 0.12)',
        }}
      >
        {tree.length ? (
          renderNodes(tree, 0)
        ) : (
          <div style={{ padding: '8px 14px', color: '#9ca3af', fontSize: '13px' }}>
            No categories yet
          </div>
        )}
      </div>
    </div>
  )
}

export default TqCategoriesMegamenu
`
}
