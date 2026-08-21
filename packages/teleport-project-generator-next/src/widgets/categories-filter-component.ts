/**
 * Generates the TqCategoriesFilter wrapper — the "Category Filter" primitive
 * (`<tq-categories-filter>`). A MULTI-select dropdown built from the
 * `categoriesData` taxonomy (baked in at export). Checking a parent selects its
 * whole subtree; the minimal selection (topmost fully-checked nodes) is written
 * to the URL as a comma-separated `?<paramKey>=<id,id,…>` via shallow routing —
 * which the products-list page's `selectedCategory` state (URL-bound) reads to
 * filter by the union of categories. Reading the URL back drives the checkbox
 * state, so it round-trips (incl. single-id links from the Category Menu).
 */
export const generateCategoriesFilterComponentCode = (): string => {
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

const asList = (categories) => (Array.isArray(categories) ? categories : [])

const indexById = (categories) => {
  const map = new Map()
  asList(categories).forEach((cat) => {
    if (cat && cat.id) {
      map.set(cat.id, cat)
    }
  })
  return map
}

const sortNodes = (a, b) =>
  (a.order || 0) - (b.order || 0) || String(a.name || '').localeCompare(String(b.name || ''))

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

const getChildren = (categories, parentId) =>
  asList(categories)
    .filter((cat) => (cat.parentId || null) === parentId)
    .sort(sortNodes)

const buildCategoryTree = (categories, locale) => {
  const list = asList(categories).map((cat) => resolveCategoryLocale(cat, locale))
  const ids = new Set(list.map((cat) => cat.id))
  const byParent = {}
  list.forEach((cat) => {
    const key = cat.parentId && ids.has(cat.parentId) ? cat.parentId : '__root__'
    if (!byParent[key]) {
      byParent[key] = []
    }
    byParent[key].push(cat)
  })
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

const getDescendantIds = (categories, id) => {
  const list = asList(categories)
  const childrenByParent = {}
  list.forEach((cat) => {
    if (cat.parentId) {
      if (!childrenByParent[cat.parentId]) {
        childrenByParent[cat.parentId] = []
      }
      childrenByParent[cat.parentId].push(cat.id)
    }
  })
  const result = new Set()
  const stack = (childrenByParent[id] || []).slice()
  while (stack.length) {
    const next = stack.pop()
    if (result.has(next) || next === id) {
      continue
    }
    result.add(next)
    ;(childrenByParent[next] || []).forEach((child) => stack.push(child))
  }
  return result
}

const parseParam = (value) => {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

const serializeParam = (ids) =>
  Array.isArray(ids) ? ids.map((entry) => String(entry).trim()).filter(Boolean).join(',') : ''

// Minimal antichain: topmost fully-checked nodes (a node covered by a fully
// checked parent is dropped) — the compact set written to the URL.
const computeMinimalSelectedIds = (categories, checkedSet) => {
  if (!checkedSet || !checkedSet.size) {
    return []
  }
  const out = []
  const walk = (nodes) =>
    nodes.forEach((node) => {
      if (checkedSet.has(node.id)) {
        out.push(node.id)
      } else {
        walk(node.children || [])
      }
    })
  walk(buildCategoryTree(categories))
  return out
}

// Category display NAME (verbatim, trimmed) -> id, so a \`?<paramKey>=\` value
// that carries a human category name — which is what AI-generated "Shop by
// category" nav links use — checks the same boxes an id-based link does.
//
// ids + names, matched EXACTLY, and nothing else: this has to accept exactly
// the tokens \`category_filter_ids\` carries, since the products list filters
// with a case-sensitive \`jsonb_exists_any\` over that same column. A value only
// this side understands (a slug, or a lowercased name) does not make the page
// work — it ticks a box over an empty grid.
const indexIdByToken = (categories) => {
  const map = new Map()
  asList(categories).forEach((cat) => {
    if (cat && cat.id && typeof cat.name === 'string') {
      const token = cat.name.trim()
      if (token && !map.has(token)) {
        map.set(token, cat.id)
      }
    }
  })
  return map
}

// One URL value -> a category id: exact id wins, else the exact display name.
// Returns null for a value that names no category (it seeds nothing, as before).
const resolveCategoryToken = (value, known, idByToken) => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (known.has(trimmed)) {
    return trimmed
  }
  const byToken = idByToken.get(trimmed)
  return byToken == null ? null : byToken
}

// Expand the URL values into { checked, indeterminate } render state.
const expandSelection = (categories, urlIds) => {
  const checked = new Set()
  const indeterminate = new Set()
  const seeded = new Set()
  const known = indexById(categories)
  const idByToken = indexIdByToken(categories)
  ;(urlIds || []).forEach((value) => {
    const id = resolveCategoryToken(value, known, idByToken)
    if (id !== null) {
      seeded.add(id)
      getDescendantIds(categories, id).forEach((descendantId) => seeded.add(descendantId))
    }
  })
  if (!seeded.size) {
    return { checked: checked, indeterminate: indeterminate }
  }
  const visit = (node) => {
    if (!node.children || !node.children.length) {
      if (seeded.has(node.id)) {
        checked.add(node.id)
        return 'full'
      }
      return 'none'
    }
    let full = 0
    let any = false
    node.children.forEach((child) => {
      const state = visit(child)
      if (state === 'full') {
        full += 1
      }
      if (state !== 'none') {
        any = true
      }
    })
    if (seeded.has(node.id) || full === node.children.length) {
      checked.add(node.id)
      return 'full'
    }
    if (any) {
      indeterminate.add(node.id)
      return 'partial'
    }
    return 'none'
  }
  buildCategoryTree(categories).forEach(visit)
  return { checked: checked, indeterminate: indeterminate }
}

// Toggle a node (and its subtree), then reconcile ancestors bottom-up.
const toggleSelection = (categories, currentChecked, id, shouldCheck) => {
  const checked = new Set(currentChecked)
  const known = indexById(categories)
  if (!known.has(id)) {
    return checked
  }
  const subtree = [id].concat(Array.from(getDescendantIds(categories, id)))
  subtree.forEach((nodeId) => {
    if (shouldCheck) {
      checked.add(nodeId)
    } else {
      checked.delete(nodeId)
    }
  })
  let parentId = (known.get(id) || {}).parentId || null
  const seen = new Set()
  while (parentId && known.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId)
    const siblings = getChildren(categories, parentId)
    const allChecked = siblings.length > 0 && siblings.every((child) => checked.has(child.id))
    if (allChecked) {
      checked.add(parentId)
    } else {
      checked.delete(parentId)
    }
    parentId = (known.get(parentId) || {}).parentId || null
  }
  return checked
}

// categoriesData / paramKey / title / previewOpen destructured so they never
// leak onto the DOM. previewOpen is an editor-only flag — the store always
// starts collapsed.
const TqCategoriesFilter = ({
  id,
  categoriesData = [],
  paramKey = 'categoryFilter',
  title = 'Categories',
  previewOpen,
  ...rest
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const list = Array.isArray(categoriesData) ? categoriesData : []
  const tree = buildCategoryTree(list, router.locale)
  const selectedIds = router && router.isReady ? parseParam(router.query[paramKey]) : []
  const view = expandSelection(list, selectedIds)
  const selectedCount = computeMinimalSelectedIds(list, view.checked).length

  const applySelection = (checkedSet) => {
    const joined = serializeParam(computeMinimalSelectedIds(list, checkedSet))
    const nextQuery = Object.assign({}, router.query)
    if (joined) {
      nextQuery[paramKey] = joined
    } else {
      delete nextQuery[paramKey]
    }
    router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true })
  }

  const onToggle = (categoryId, event) => {
    applySelection(toggleSelection(list, view.checked, categoryId, event.target.checked))
  }

  const renderNodes = (nodes, depth) =>
    nodes.map((cat) => (
      <div key={cat.id}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 14px',
            paddingLeft: 14 + depth * 18 + 'px',
            fontSize: '14px',
            color: '#111827',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={view.checked.has(cat.id)}
            ref={(el) => {
              if (el) {
                el.indeterminate = view.indeterminate.has(cat.id)
              }
            }}
            onChange={(event) => onToggle(cat.id, event)}
          />
          {cat.icon ? (
            <span
              style={{ display: 'inline-flex', width: '16px', height: '16px' }}
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(cat.icon) }}
            />
          ) : null}
          <span>{cat.name}</span>
        </label>
        {cat.children && cat.children.length ? renderNodes(cat.children, depth + 1) : null}
      </div>
    ))

  return (
    <div {...rest} data-thq="categories-filter-node" style={Object.assign({ position: 'relative', display: 'inline-block', minWidth: '240px' }, rest.style)}>
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
        <span>{title}</span>
        {selectedCount > 0 ? (
          <span
            style={{
              minWidth: '18px',
              height: '18px',
              padding: '0 5px',
              borderRadius: '9px',
              background: '#111827',
              color: '#ffffff',
              fontSize: '11px',
              lineHeight: '18px',
              textAlign: 'center',
            }}
          >
            {selectedCount}
          </span>
        ) : null}
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

export default TqCategoriesFilter
`
}
