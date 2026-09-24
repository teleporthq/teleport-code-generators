// Compare how a linked element renders in three shapes:
//   today  : <a wrapper><div class=card>…</div></a>            (what codegen emits now)
//   editor : <div class=card>…</div>                           (what the canvas renders: no link element)
//   anchor : <a class=card>…</a>                               (the element itself becomes the anchor)
//   guard  : anchor + zero-specificity `display:block` default
const { chromium } = require(require('path').resolve(
  __dirname,
  '../../../../teleport-gui/node_modules/playwright-core'
))
const port = process.argv[2] || '3001'
const routes = (
  process.argv[3] ||
  '/,/about,/our-glazes,/care-and-maintenance,/products,/shipping-returns,/sign-in,/cart'
).split(',')
const MODES = ['today', 'editor', 'anchor', 'guard']

const inPage = (mode) => {
  const BLOCKISH = new Set([
    'DIV',
    'SECTION',
    'ARTICLE',
    'FIGURE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'P',
    'IMG',
    'LI',
    'UL',
    'HEADER',
    'FOOTER',
    'NAV',
    'PICTURE',
  ])
  const wrappers = Array.from(document.querySelectorAll('a')).filter((a) => {
    if (a.children.length !== 1) return false
    const text = Array.from(a.childNodes).filter(
      (n) => n.nodeType === 3 && n.textContent.trim()
    ).length
    if (text) return false
    return BLOCKISH.has(a.firstElementChild.tagName)
  })
  if (mode === 'guard') {
    const style = document.createElement('style')
    style.textContent = ':where(a[data-thq-link-box]) { display: block; }'
    document.head.prepend(style)
  }
  const targets = []
  wrappers.forEach((wrapper, index) => {
    const child = wrapper.firstElementChild
    const parent = wrapper.parentElement
    parent.setAttribute('data-probe-parent', String(index))
    let target = child
    if (mode === 'editor') {
      parent.replaceChild(child, wrapper)
    } else if (mode === 'anchor' || mode === 'guard') {
      const canBeAnchor = child.tagName === 'DIV'
      if (canBeAnchor) {
        const anchor = document.createElement('a')
        for (const attr of Array.from(child.attributes)) anchor.setAttribute(attr.name, attr.value)
        for (const attr of Array.from(wrapper.attributes)) {
          if (attr.name === 'class') continue
          if (!anchor.hasAttribute(attr.name)) anchor.setAttribute(attr.name, attr.value)
        }
        // styled-jsx scope class of the wrapper is the same as the child's; keep the child's list
        if (mode === 'guard') anchor.setAttribute('data-thq-link-box', '')
        while (child.firstChild) anchor.appendChild(child.firstChild)
        parent.replaceChild(anchor, wrapper)
        target = anchor
      }
    }
    target.setAttribute('data-probe-id', String(index))
    targets.push({
      index,
      target,
      parent,
      childTag: child.tagName,
      wrapperDisplay: mode === 'today' ? getComputedStyle(wrapper).display : null,
    })
  })
  const rules = []
  for (const sheet of Array.from(document.styleSheets)) {
    let list
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    const visit = (ruleList) => {
      for (const rule of Array.from(ruleList)) {
        if (rule.selectorText) rules.push(rule.selectorText)
        else if (rule.cssRules) visit(rule.cssRules)
      }
    }
    visit(list)
  }
  const unique = Array.from(new Set(rules))
  return targets.map(({ index, target, parent, childTag, wrapperDisplay }) => {
    const cs = getComputedStyle(target)
    const matched = unique.filter((selector) => {
      try {
        return target.matches(selector)
      } catch {
        return false
      }
    })
    const firstKid = target.firstElementChild
    return {
      index,
      childTag,
      wrapperDisplay,
      cls: (target.getAttribute('class') || '')
        .replace(/jsx-\d+/g, '')
        .trim()
        .slice(0, 70),
      parentCls: (parent.getAttribute('class') || '')
        .replace(/jsx-\d+/g, '')
        .trim()
        .slice(0, 50),
      parentDisplay: getComputedStyle(parent).display,
      w: target.offsetWidth,
      h: target.offsetHeight,
      x: Math.round(target.getBoundingClientRect().left - parent.getBoundingClientRect().left),
      y: Math.round(target.getBoundingClientRect().top - parent.getBoundingClientRect().top),
      kidW: firstKid ? firstKid.offsetWidth : null,
      kidH: firstKid ? firstKid.offsetHeight : null,
      display: cs.display,
      color: cs.color,
      deco: cs.textDecorationLine,
      fontSize: cs.fontSize,
      cursor: cs.cursor,
      matched,
    }
  })
}

;(async () => {
  const browser = await chromium.launch()
  const summary = {}
  for (const route of routes) {
    const byMode = {}
    for (const mode of MODES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      try {
        await page.goto(`http://localhost:${port}${route}`, {
          waitUntil: 'networkidle',
          timeout: 60000,
        })
      } catch (error) {
        console.log(`SKIP ${route} (${mode}): ${error.message.split('\n')[0]}`)
        await page.close()
        continue
      }
      await page.waitForTimeout(1200)
      byMode[mode] = await page.evaluate(inPage, mode)
      await page.close()
    }
    if (!byMode.editor) continue
    const differs = (a, b) => {
      const out = []
      for (const k of ['w', 'h', 'x', 'y', 'kidW', 'kidH', 'color', 'deco', 'fontSize']) {
        const tol = ['w', 'h', 'x', 'y', 'kidW', 'kidH'].includes(k) ? 1 : 0
        if (typeof a[k] === 'number' && typeof b[k] === 'number') {
          if (Math.abs(a[k] - b[k]) > tol) out.push(`${k}:${b[k]}→${a[k]}`)
        } else if (a[k] !== b[k]) out.push(`${k}:${b[k]}→${a[k]}`)
      }
      return out
    }
    const total = byMode.editor.length
    const line = { route, links: total }
    for (const mode of ['today', 'anchor', 'guard']) {
      const rows = byMode[mode] || []
      let bad = 0
      const details = []
      rows.forEach((row, i) => {
        const ref = byMode.editor[i]
        if (!ref) return
        const d = differs(row, ref)
        if (d.length) {
          bad += 1
          const lost = ref.matched.filter((s) => !row.matched.includes(s))
          const gained = row.matched.filter((s) => !ref.matched.includes(s))
          details.push(
            `   #${i} <${row.childTag.toLowerCase()} class="${ref.cls}"> in .${ref.parentCls} [${
              ref.parentDisplay
            }] ${d.join(' ')}${
              lost.length ? `\n        rules LOST: ${lost.slice(0, 4).join(' | ')}` : ''
            }${gained.length ? `\n        rules GAINED: ${gained.slice(0, 4).join(' | ')}` : ''}`
          )
        }
      })
      line[mode] = bad
      if (details.length)
        console.log(
          `\n${route} — ${mode} differs from the editor on ${bad}/${total}:\n${details
            .slice(0, 12)
            .join('\n')}`
        )
    }
    const wrapDisplays = {}
    for (const row of byMode.today || [])
      wrapDisplays[row.wrapperDisplay] = (wrapDisplays[row.wrapperDisplay] || 0) + 1
    line.wrapperDisplays = wrapDisplays
    summary[route] = line
  }
  console.log('\n===== SUMMARY (links that render differently from the editor) =====')
  for (const line of Object.values(summary)) console.log(JSON.stringify(line))
  await browser.close()
})()
