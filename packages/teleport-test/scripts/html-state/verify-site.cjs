// Drives the packed state fixture in Chromium: clicks, tabs, keyboard, a visitor
// without JavaScript, a blocked runtime and layout stability on load.
// node verify-site.cjs <site-dir>   (pack it first with pack-site.cjs)
// Borrows Playwright from the sibling teleport-gui checkout, like ../html-motion.
const { chromium } = require(require('path').resolve(
  __dirname,
  '../../../../../teleport-gui/node_modules/playwright-core'
))
const http = require('http')
const fs = require('fs')
const path = require('path')
const root = process.argv[2]
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0].split('#')[0])
  const file = path.join(root, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    return res.end('nf')
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${
      detail !== undefined
        ? '   → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
        : ''
    }`
  )
}

// What a visitor sees: an element is on screen when it has a box.
const look = () => {
  const rendered = (element) => element.getClientRects().length > 0
  const [first, second] = document.querySelectorAll('[data-tq-scope="Navigation"]')
  const within = (scope, id) => rendered(scope.querySelector('#' + id))
  return {
    navOne: ['burger-open', 'burger-close', 'menu'].map((id) => within(first, id)),
    navTwo: ['burger-open', 'burger-close', 'menu'].map((id) => within(second, id)),
    panels: [0, 1, 2].map((index) => rendered(document.getElementById('panel-' + index))),
    activeTabs: [0, 1, 2].map((index) =>
      document.getElementById('tab-' + index).classList.contains('tab-active')
    ),
    prices: ['price-monthly', 'price-yearly'].map((id) => rendered(document.getElementById(id))),
    slotBadge: rendered(document.getElementById('slot-badge')),
  }
}
const DEFAULT_LOOK = {
  navOne: [true, false, false],
  navTwo: [true, false, false],
  panels: [true, false, false],
  activeTabs: [true, false, false],
  prices: [true, false],
  slotBadge: false,
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Where every bound element sits, to compare the first paint with the running page.
const layout = () =>
  Array.from(
    document.querySelectorAll('[data-tq-if], [data-tq-on-click], [data-tq-class], [data-tq-scope]')
  ).map((element) => {
    const box = element.getBoundingClientRect()
    return [element.id || element.tagName, box.x, box.y, box.width, box.height].join(':')
  })

;(async () => {
  await new Promise((r) => server.listen(0, r))
  const base = `http://localhost:${server.address().port}`
  const browser = await chromium.launch()
  const hermetic = async (context) => {
    // fonts and the sample's unpkg scripts never load: the check measures this site alone
    await context.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
    return context
  }

  // ---------- 1. a visitor with JavaScript
  const context = await hermetic(
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  )
  await context.addInitScript(() => {
    window.__shifts = []
    new PerformanceObserver((list) =>
      list.getEntries().forEach((entry) => window.__shifts.push(entry.value))
    ).observe({ type: 'layout-shift', buffered: true })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))
  page.on('console', (message) => {
    if (message.type() === 'warning' && /tq-state/.test(message.text())) errors.push(message.text())
  })
  await page.goto(base + '/', { waitUntil: 'load' })
  await page.waitForTimeout(600)

  check('the runtime booted', await page.evaluate(() => window.__tqStateRuntime === true))
  const firstLook = await page.evaluate(look)
  check(
    'the page opens on the default branch of every condition',
    same(firstLook, DEFAULT_LOOK),
    firstLook
  )
  const shifts = await page.evaluate(() => window.__shifts)
  check(
    'no layout shift while the page loads',
    shifts.reduce((sum, value) => sum + value, 0) === 0,
    shifts
  )
  const runningLayout = await page.evaluate(layout)
  check(
    'a hidden menu stays hidden although its class says display: flex',
    await page.evaluate(() => {
      const menu = document.querySelector('#menu')
      menu.removeAttribute('hidden')
      const authored = getComputedStyle(menu).display
      menu.setAttribute('hidden', '')
      return authored === 'flex' && getComputedStyle(menu).display === 'none'
    })
  )

  await page.locator('#burger').first().click()
  const afterBurger = await page.evaluate(look)
  check(
    'the burger opens its own menu; the second navigation is untouched',
    same(afterBurger.navOne, [false, true, true]) && same(afterBurger.navTwo, [true, false, false]),
    { navOne: afterBurger.navOne, navTwo: afterBurger.navTwo }
  )
  check(
    'the open menu shows with its own display: flex',
    (await page.evaluate(() => getComputedStyle(document.querySelector('#menu')).display)) ===
      'flex'
  )

  await page.locator('#tab-2').click()
  await page.waitForTimeout(200)
  const afterTab = await page.evaluate(look)
  check(
    'the shift observer works: the taller panel moves what follows it',
    (await page.evaluate(() => window.__shifts.length)) > 0
  )
  const tabColors = await page.evaluate(() =>
    [0, 1, 2].map((index) => getComputedStyle(document.getElementById('tab-' + index)).color)
  )
  check(
    'a tab click shows its panel and moves the active class',
    same(afterTab.panels, [false, false, true]) &&
      same(afterTab.activeTabs, [false, false, true]) &&
      tabColors[2] === 'rgb(204, 0, 0)' &&
      tabColors[0] !== 'rgb(204, 0, 0)',
    { panels: afterTab.panels, activeTabs: afterTab.activeTabs, tabColors }
  )

  await page.locator('#billing-switch').click()
  const afterBilling = await page.evaluate(look)
  check(
    'the price switch flips both prices, and the slotted badge reads the page state',
    same(afterBilling.prices, [false, true]) &&
      afterBilling.slotBadge === true &&
      same(afterBilling.navOne, [false, true, true]),
    { prices: afterBilling.prices, slotBadge: afterBilling.slotBadge }
  )

  const secondBurger = page.locator('#burger').nth(1)
  await secondBurger.focus()
  await page.keyboard.press('Enter')
  const afterEnter = await page.evaluate(look)
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.keyboard.press(' ')
  const afterSpace = await page.evaluate(look)
  check(
    'Enter and Space work the focused burger, without scrolling the page',
    same(afterEnter.navTwo, [false, true, true]) &&
      same(afterSpace.navTwo, [true, false, false]) &&
      scrollBefore === (await page.evaluate(() => scrollY)),
    { afterEnter: afterEnter.navTwo, afterSpace: afterSpace.navTwo }
  )
  check('no script errors and no unreadable binding', errors.length === 0, errors)
  await context.close()

  // ---------- 2. a visitor without JavaScript
  const noJs = await hermetic(
    await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
  )
  const plain = await noJs.newPage()
  await plain.goto(base + '/', { waitUntil: 'load' })
  const plainLook = await plain.evaluate(look).catch((error) => ({ error: String(error) }))
  check(
    'without JavaScript only the default branches show',
    same(plainLook, DEFAULT_LOOK),
    plainLook
  )
  await noJs.close()

  // ---------- 3. the runtime file never arrives
  const blockedContext = await hermetic(
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  )
  await blockedContext.route('**/tq-state.js', (route) => route.abort())
  const blocked = await blockedContext.newPage()
  await blocked.goto(base + '/', { waitUntil: 'load' })
  await blocked.waitForTimeout(300)
  check(
    'runtime blocked: only the default branches show',
    same(await blocked.evaluate(look), DEFAULT_LOOK)
  )
  const firstPaintLayout = await blocked.evaluate(layout)
  check(
    'the running page sits exactly where its first paint did',
    same(firstPaintLayout, runningLayout),
    firstPaintLayout.filter((entry, index) => entry !== runningLayout[index]).slice(0, 5)
  )
  await blocked.locator('#burger').first().click()
  check(
    'runtime blocked: a click changes nothing and nothing breaks',
    same(await blocked.evaluate(look), DEFAULT_LOOK)
  )
  await blockedContext.close()

  await browser.close()
  server.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
