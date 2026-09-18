// Packs a two-page static site per page-transition setting and watches a real browser navigate it.
const path = require('path')
const fs = require('fs')
const http = require('http')
const CG = path.resolve(__dirname, '../../../..')
const { packProject } = require(CG + '/packages/teleport-code-generator/dist/cjs/index.js')
const { ProjectType, PublisherType } = require(CG + '/packages/teleport-types/dist/cjs/index.js')
const { chromium } = require(path.resolve(CG, '../teleport-gui/node_modules/playwright-core'))
const out = process.argv[2]
const s = (content) => ({ type: 'static', content })
const el = (elementType, name, attrs, style, children) => ({
  type: 'element',
  content: {
    elementType,
    name,
    attrs,
    style: Object.fromEntries(Object.entries(style).map(([k, v]) => [k, s(v)])),
    children,
  },
})
const linkTo = (id, label, routeName) => {
  const node = el('text', id, { id: s(id) }, { padding: '16px', fontSize: '24px' }, [
    { type: 'static', content: label },
  ])
  node.content.semanticType = 'span'
  node.content.abilities = { link: { type: 'navlink', content: { routeName: s(routeName) } } }
  return node
}
const siteWith = (pageTransition) => {
  const uidl = JSON.parse(fs.readFileSync(CG + '/examples/uidl-samples/tests.json', 'utf8'))
  const [home, about] = uidl.root.node.content.children
  home.content.node.content.children = [
    el('container', 'hero', {}, { height: '140vh', background: '#f4f1ea', padding: '40px' }, [
      linkTo('to-about', 'About', 'About'),
    ]),
  ]
  about.content.node.content.children = [
    el('container', 'body', {}, { height: '100vh', background: '#dde4ee', padding: '40px' }, [
      linkTo('to-home', 'Home', 'Home'),
    ]),
  ]
  uidl.globals.settings = { ...uidl.globals.settings, pageTransition }
  return uidl
}
const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${
      detail !== undefined ? '   → ' + JSON.stringify(detail) : ''
    }`
  )
}
// Recorded on the arriving page, before its first frame: was there a transition, which animations carry it, how long it ran.
const RECORDER = () => {
  addEventListener('pagereveal', (event) => {
    const record = {
      transition: !!event.viewTransition,
      animations: [],
      navAttr: null,
      origin: null,
      ms: null,
    }
    sessionStorage.setItem('tq-probe', JSON.stringify(record))
    if (!event.viewTransition) return
    const started = performance.now()
    event.viewTransition.ready
      .then(() => {
        record.navAttr = document.documentElement.getAttribute('data-tq-nav')
        record.origin =
          document.documentElement.style.getPropertyValue('--tq-origin-x') +
          ' ' +
          document.documentElement.style.getPropertyValue('--tq-origin-y')
        record.animations = document
          .getAnimations()
          .filter((a) => a.effect && a.effect.pseudoElement)
          .map((a) => ({
            pseudo: a.effect.pseudoElement,
            name: a.animationName,
            duration: a.effect.getTiming().duration,
            delay: a.effect.getTiming().delay,
            from: a.effect.getKeyframes()[0],
            to: a.effect.getKeyframes().slice(-1)[0],
          }))
        sessionStorage.setItem('tq-probe', JSON.stringify(record))
      })
      .catch(() => {})
    const done = () => {
      record.ms = Math.round(performance.now() - started)
      sessionStorage.setItem('tq-probe', JSON.stringify(record))
    }
    event.viewTransition.finished.then(done, done)
  })
}
const pick = (frame, keys) =>
  Object.fromEntries(keys.filter((k) => frame && frame[k] !== undefined).map((k) => [k, frame[k]]))

;(async () => {
  let root = ''
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    const file = path.join(root, url === '/' ? 'index.html' : url)
    if (!fs.existsSync(file)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.js')
        ? 'text/javascript'
        : 'text/html',
    })
    res.end(fs.readFileSync(file))
  })
  await new Promise((r) => server.listen(0, r))
  const base = `http://localhost:${server.address().port}`
  const browser = await chromium.launch({ channel: 'chrome' })
  console.log('Chrome', browser.version())
  const visit = async (name, pageTransition, run, contextOptions) => {
    const folder = path.join(out, name)
    fs.rmSync(folder, { recursive: true, force: true })
    await packProject(siteWith(pageTransition), {
      projectType: ProjectType.HTML,
      publisher: PublisherType.DISK,
      publishOptions: { outputPath: folder, projectSlug: 'site' },
    })
    root = path.join(folder, 'site')
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      ...(contextOptions || {}),
    })
    const page = await context.newPage()
    await page.addInitScript(RECORDER)
    await page.goto(base + '/', { waitUntil: 'load' })
    const probe = async () => {
      await page.waitForTimeout(1500)
      return page.evaluate(() => JSON.parse(sessionStorage.getItem('tq-probe') || 'null'))
    }
    await run(page, probe, root)
    await context.close()
  }
  const byPseudo = (record, pseudo) => (record.animations || []).find((a) => a.pseudo === pseudo)

  await visit(
    'slide',
    { preset: 'slide-left', duration: 0.3, easing: 'ease-out' },
    async (page, probe, site) => {
      const css = fs.readFileSync(path.join(site, 'style.css'), 'utf8')
      check(
        'slide-left: the stylesheet opts every page into view transitions, inside the reduced-motion guard',
        /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{\s*navigation: auto;/.test(
          css
        )
      )
      await page.click('#to-about')
      let r = await probe()
      const leave = byPseudo(r, '::view-transition-old(root)')
      const arrive = byPseudo(r, '::view-transition-new(root)')
      check(
        'slide-left forward: the leaving page exits left, then the arriving page enters from the right',
        r.transition &&
          leave &&
          arrive &&
          leave.name === 'tq-page-leave' &&
          arrive.name === 'tq-page-arrive' &&
          leave.duration === 300 &&
          arrive.delay === 300 &&
          /-48px/.test(leave.to.transform) &&
          /48px/.test(arrive.from.transform) &&
          !/-48px/.test(arrive.from.transform),
        {
          leave: leave && [leave.name, leave.to.transform, leave.to.opacity],
          arrive: arrive && [arrive.name, arrive.delay, arrive.from.transform],
        }
      )
      check(
        'the two halves run one after the other (about 2 × 0.3 s)',
        r.ms >= 500 && r.ms <= 1100,
        { ms: r.ms }
      )
      await page.goBack()
      r = await probe()
      const backLeave = byPseudo(r, '::view-transition-old(root)')
      const backArrive = byPseudo(r, '::view-transition-new(root)')
      check(
        'back button: the preset plays the other way',
        r.transition &&
          r.navAttr === 'back' &&
          backLeave &&
          backLeave.name === 'tq-page-leave-back' &&
          /(^|[^-])48px/.test(backLeave.to.transform) &&
          backArrive.name === 'tq-page-arrive-back' &&
          /-48px/.test(backArrive.from.transform),
        {
          navAttr: r.navAttr,
          leave: backLeave && [backLeave.name, backLeave.to.transform],
          arrive: backArrive && [backArrive.name, backArrive.from.transform],
        }
      )
      check(
        'the direction flag is cleared once the transition is over',
        (await page.evaluate(() => document.documentElement.getAttribute('data-tq-nav'))) === null
      )
    }
  )

  await visit(
    'fade',
    { preset: 'fade', duration: 0.25, easing: 'ease' },
    async (page, probe, site) => {
      const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8')
      check('fade: no script is shipped, the stylesheet does it all', !/pagereveal/.test(html))
      await page.click('#to-about')
      const r = await probe()
      const leave = byPseudo(r, '::view-transition-old(root)')
      check('fade: plays', r.transition && leave && leave.to.opacity === '0', {
        to: leave && leave.to.opacity,
      })
    }
  )

  await visit(
    'circle',
    { preset: 'circle', duration: 0.3, easing: 'ease-in-out', options: { origin: 'click' } },
    async (page, probe) => {
      const box = await page.locator('#to-about').boundingBox()
      const x = Math.round(box.x + 10),
        y = Math.round(box.y + 10)
      await page.mouse.click(x, y)
      const r = await probe()
      const arrive = byPseudo(r, '::view-transition-new(root)')
      check(
        'circle: the reveal grows from where the visitor pressed',
        r.transition &&
          r.origin === `${x}px ${y}px` &&
          arrive &&
          /circle\(0% at/.test(arrive.from.clipPath) &&
          arrive.from.clipPath.includes(`${x}px ${y}px`),
        { origin: r.origin, from: arrive && arrive.from.clipPath }
      )
    }
  )

  await visit(
    'cover',
    { preset: 'cover', duration: 0.3, easing: 'ease-out', options: { color: '#123456' } },
    async (page, probe, site) => {
      const css = fs.readFileSync(path.join(site, 'style.css'), 'utf8')
      await page.click('#to-about')
      const r = await probe()
      const leave = byPseudo(r, '::view-transition-old(root)')
      const arrive = byPseudo(r, '::view-transition-new(root)')
      check(
        'cover: the colour sweeps up over the leaving page, then off the arriving one',
        r.transition &&
          /::view-transition-group\(root\) \{\s*background: #123456;/.test(css) &&
          leave &&
          /^inset\(0(px)? 0(px)? 100%( 0(px)?)?\)$/.test(leave.to.clipPath) &&
          arrive &&
          /^inset\(100% 0(px)? 0(px)?( 0(px)?)?\)$/.test(arrive.from.clipPath),
        { leaveTo: leave && leave.to.clipPath, arriveFrom: arrive && arrive.from.clipPath }
      )
    }
  )

  await visit(
    'skip',
    { preset: 'slide-up', duration: 0.3, easing: 'ease-out', skipRoutes: ['/about'] },
    async (page, probe, site) => {
      const about = fs.readFileSync(path.join(site, 'about.html'), 'utf8')
      const home = fs.readFileSync(path.join(site, 'index.html'), 'utf8')
      check(
        'skip: only the page that opted out carries the skip script',
        /skipTransition/.test(about) && !/skipTransition/.test(home)
      )
      await page.click('#to-about')
      let r = await probe()
      check(
        'arriving on a page that opted out: it appears at once',
        r.transition && r.ms !== null && r.ms < 120,
        { ms: r.ms }
      )
      await page.click('#to-home')
      r = await probe()
      check(
        'leaving that page still plays the transition',
        r.transition && r.ms >= 500 && !!byPseudo(r, '::view-transition-old(root)'),
        { ms: r.ms }
      )
    }
  )

  await visit(
    'calm',
    { preset: 'slide-left', duration: 0.3, easing: 'ease-out' },
    async (page, probe) => {
      await page.click('#to-about')
      const r = await probe()
      check(
        'reduced motion: pages simply switch',
        r && r.transition === false,
        r && { transition: r.transition }
      )
    },
    { reducedMotion: 'reduce' }
  )

  await visit(
    'none',
    { preset: 'none', duration: 0.3, easing: 'ease-out' },
    async (page, probe, site) => {
      check(
        'no transition chosen: nothing is added',
        !/view-transition/.test(fs.readFileSync(path.join(site, 'style.css'), 'utf8'))
      )
    }
  )

  await browser.close()
  server.close()
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
