// Same project, two exports: walks every scroll scene of every page at the same scroll positions
// in the Next site and in the static HTML site, and reports where an animated element differs.
// Usage: node compare-next-html.cjs <next-origin> <html-origin> "/=index.html,/team=team.html,..."
const path = require('path')
const { chromium } = require(path.resolve(
  __dirname,
  '../../../../../teleport-gui/node_modules/playwright-core'
))
const [nextOrigin, htmlOrigin, mapping] = process.argv.slice(2)
const pages = mapping.split(',').map((pair) => pair.split('='))
const STOPS = [0, 0.25, 0.5, 0.75, 1]

const measureScenes = () =>
  Array.from(document.querySelectorAll('[data-scene-track]')).map((track) => {
    const stage = track.querySelector(':scope > [data-scene-stage]')
    return {
      id: track.id || '',
      trackH: track.offsetHeight,
      pinned: !!stage && getComputedStyle(stage).position === 'sticky',
      bound: track.querySelectorAll('[data-scroll-bind]').length,
    }
  })
const snapshot = (index) => {
  const track = document.querySelectorAll('[data-scene-track]')[index]
  const stage = track.querySelector(':scope > [data-scene-stage]') || track
  const base = stage.getBoundingClientRect()
  return {
    stageTop: Math.round(base.top),
    point: track.getAttribute('data-scene-point'),
    elements: Array.from(track.querySelectorAll('[data-scroll-bind]')).map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        cls:
          (el.getAttribute('class') || '')
            .replace(/jsx-\d+/g, '')
            .trim()
            .split(/\s+/)[0] || el.tagName.toLowerCase(),
        opacity: Number(Number(cs.opacity).toFixed(2)),
        translate: cs.translate,
        scale: cs.scale,
        x: Math.round(r.left - base.left),
        y: Math.round(r.top - base.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        hidden: el.hasAttribute('data-scene-hidden'),
        chapter: el.getAttribute('data-chapter-active'),
      }
    }),
  }
}
const norm = (v) =>
  v === 'none' || v === '0px' || v === '0px 0px' ? '0' : String(v).replace(/(\d+\.\d{1})\d+/g, '$1')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  let scenesCompared = 0,
    samples = 0,
    differences = 0
  for (const [route, file] of pages) {
    const open = async (url) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
      await page.waitForTimeout(1500)
      return page
    }
    const next = await open(nextOrigin + route)
    const html = await open(htmlOrigin + '/' + file)
    const [a, b] = [await next.evaluate(measureScenes), await html.evaluate(measureScenes)]
    const heights = [
      await next.evaluate(() => document.documentElement.scrollHeight),
      await html.evaluate(() => document.documentElement.scrollHeight),
    ]
    console.log(
      `\n${route}  —  scenes: next ${a.length}, html ${b.length} | page height: next ${heights[0]}px, html ${heights[1]}px`
    )
    if (a.length !== b.length) {
      differences += 1
      console.log('  DIFF scene count')
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      scenesCompared += 1
      const head = `  scene ${i + 1} ${a[i].id ? '#' + a[i].id : ''}: track ${a[i].trackH}/${
        b[i].trackH
      }px, pinned ${a[i].pinned}/${b[i].pinned}, animated elements ${a[i].bound}/${b[i].bound}`
      const issues = []
      if (
        Math.abs(a[i].trackH - b[i].trackH) > 2 ||
        a[i].pinned !== b[i].pinned ||
        a[i].bound !== b[i].bound
      )
        issues.push('structure differs')
      for (const stop of STOPS) {
        const go = (page) =>
          page.evaluate(
            ({ i, stop }) => {
              const t = document.querySelectorAll('[data-scene-track]')[i]
              const top = t.getBoundingClientRect().top + scrollY
              scrollTo(0, top + stop * Math.max(0, t.offsetHeight - innerHeight))
            },
            { i, stop }
          )
        await go(next)
        await go(html)
        await next.waitForTimeout(1600)
        await html.waitForTimeout(100)
        const [sa, sb] = [await next.evaluate(snapshot, i), await html.evaluate(snapshot, i)]
        samples += sa.elements.length
        if (Math.abs(sa.stageTop - sb.stageTop) > 2)
          issues.push(`@${stop} stage top ${sa.stageTop} vs ${sb.stageTop}`)
        sa.elements.forEach((ea, k) => {
          const eb = sb.elements[k]
          if (!eb) return
          const d = []
          if (Math.abs(ea.opacity - eb.opacity) > 0.03)
            d.push(`opacity ${ea.opacity} vs ${eb.opacity}`)
          if (norm(ea.translate) !== norm(eb.translate))
            d.push(`translate ${ea.translate} vs ${eb.translate}`)
          if (norm(ea.scale) !== norm(eb.scale)) d.push(`scale ${ea.scale} vs ${eb.scale}`)
          for (const key of ['x', 'y', 'w', 'h'])
            if (Math.abs(ea[key] - eb[key]) > 3) d.push(`${key} ${ea[key]} vs ${eb[key]}`)
          if (ea.hidden !== eb.hidden) d.push(`click-through ${ea.hidden} vs ${eb.hidden}`)
          if (ea.chapter !== eb.chapter) d.push(`active chapter ${ea.chapter} vs ${eb.chapter}`)
          if (d.length) issues.push(`@${stop} .${ea.cls}: ${d.join(', ')}`)
        })
      }
      differences += issues.length
      console.log(
        head +
          (issues.length
            ? `\n    ✗ ${issues.slice(0, 8).join('\n    ✗ ')}${
                issues.length > 8 ? `\n    … ${issues.length - 8} more` : ''
              }`
            : '   ✓ identical at all 5 positions')
      )
    }
    await next.close()
    await html.close()
  }
  console.log(
    `\nscenes compared: ${scenesCompared} | element samples: ${samples} | differences: ${differences}`
  )
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
