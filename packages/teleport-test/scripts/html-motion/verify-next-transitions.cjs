// Packs the page-transition site as a Next project, builds it for production
// against an installed generated project's node_modules, and watches Chrome
// navigate it: the picture flying into its twin, the ordinary transition where
// no picture flies, the back button, a picture with nowhere to land, reduced
// motion, and many page changes in a row (a leaving page that never leaves
// would stop the site).
//
// node verify-next-transitions.cjs <out-dir> [node_modules of a generated Next project]
const path = require('path')
const fs = require('fs')
const net = require('net')
const http = require('http')
const { spawn, spawnSync } = require('child_process')
const CG = path.resolve(__dirname, '../../../..')
const { packProject } = require(CG + '/packages/teleport-code-generator/dist/cjs/index.js')
const { ProjectType, PublisherType } = require(CG + '/packages/teleport-types/dist/cjs/index.js')
const { chromium } = require(path.resolve(CG, '../teleport-gui/node_modules/playwright-core'))
const { siteWith, writePictures } = require('./transition-site.cjs')
const out = process.argv[2]
const modules =
  process.argv[3] || path.join(CG, 'packages/teleport-test/dist/teleport-project-next/node_modules')

const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${
      detail !== undefined ? '   → ' + JSON.stringify(detail) : ''
    }`
  )
}

// Every View Transition the page starts, with the animations carrying it and how long it ran.
const RECORDER = () => {
  window.__tqTransitions = []
  if (typeof document.startViewTransition !== 'function') {
    return
  }
  const start = document.startViewTransition.bind(document)
  document.startViewTransition = (update) => {
    const record = { animations: [], ms: null, skipped: false }
    window.__tqTransitions.push(record)
    const began = performance.now()
    const transition = start(update)
    transition.ready
      .then(() => {
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
      })
      .catch(() => {
        record.skipped = true
      })
    const done = () => {
      record.ms = Math.round(performance.now() - began)
    }
    transition.finished.then(done, done)
    return transition
  }
}

// How far the page wrapper moved and faded while framer-motion played the ordinary transition.
const sampleWrapper = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = { minOpacity: 1, maxShift: 0 }
        const began = performance.now()
        const tick = () => {
          document.querySelectorAll('[data-tq-page-transition]').forEach((element) => {
            const style = getComputedStyle(element)
            seen.minOpacity = Math.min(seen.minOpacity, parseFloat(style.opacity))
            const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform)
            seen.maxShift = Math.max(seen.maxShift, Math.abs(matrix.m42))
          })
          if (performance.now() - began < 1200) {
            requestAnimationFrame(tick)
          } else {
            resolve(seen)
          }
        }
        requestAnimationFrame(tick)
      })
  )

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const waitForServer = async (url, ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const ok = await new Promise((resolve) =>
      http.get(url, (res) => resolve(res.statusCode === 200)).on('error', () => resolve(false))
    )
    if (ok) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

// Packs the site with this page transition, builds it for production and serves it.
const buildAndStart = async (name, pageTransition, withPictures, siteOptions) => {
  const folder = path.join(out, name)
  fs.rmSync(folder, { recursive: true, force: true })
  await packProject(siteWith(pageTransition, withPictures, siteOptions), {
    projectType: ProjectType.NEXT,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath: folder, projectSlug: 'site' },
  })
  const site = path.join(folder, 'site')
  fs.mkdirSync(path.join(site, 'public'), { recursive: true })
  writePictures(path.join(site, 'public'))
  fs.symlinkSync(modules, path.join(site, 'node_modules'), 'dir')
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  const build = spawnSync(path.join(site, 'node_modules/.bin/next'), ['build'], {
    cwd: site,
    env,
    encoding: 'utf8',
  })
  fs.writeFileSync(path.join(folder, 'build.log'), (build.stdout || '') + (build.stderr || ''))
  if (build.status !== 0) {
    throw new Error(`next build failed — see ${path.join(folder, 'build.log')}`)
  }
  const port = await freePort()
  const server = spawn(path.join(site, 'node_modules/.bin/next'), ['start', '-p', String(port)], {
    cwd: site,
    env,
    stdio: 'ignore',
  })
  const base = `http://localhost:${port}`
  if (!(await waitForServer(base + '/', 30000))) {
    server.kill()
    throw new Error('next start did not answer')
  }
  return { base, stop: () => server.kill() }
}

;(async () => {
  if (!fs.existsSync(path.join(modules, 'next'))) {
    throw new Error(`No installed Next project at ${modules} — pass one as the second argument.`)
  }
  const { base, stop } = await buildAndStart(
    'next-morph',
    { preset: 'slide-up', duration: 0.3, easing: 'ease-out' },
    true
  )
  try {
    const browser = await chromium.launch({ channel: 'chrome' })
    console.log('Chrome', browser.version(), '· Next site on', base)
    const open = async (contextOptions) => {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        ...(contextOptions || {}),
      })
      const page = await context.newPage()
      await page.addInitScript(RECORDER)
      await page.goto(base + '/', { waitUntil: 'networkidle' })
      return { context, page }
    }
    const transitions = (page) => page.evaluate(() => window.__tqTransitions)
    const settle = (page) => page.waitForTimeout(1500)
    const pathname = (page) => page.evaluate(() => location.pathname)
    const byPseudo = (record, pseudo) =>
      (record.animations || []).filter((a) => a.pseudo === pseudo)

    const { context, page } = await open()

    await page.click('#card-photo')
    await settle(page)
    let records = await transitions(page)
    let flight = records[0] || {}
    const group = byPseudo(flight, '::view-transition-group(tq-morph)')[0]
    const leave = byPseudo(flight, '::view-transition-old(root)')[0]
    const arrive = byPseudo(flight, '::view-transition-new(root)')[0]
    check(
      'the card picture flies into its twin on the next page, over both halves of the preset',
      records.length === 1 &&
        !flight.skipped &&
        !!group &&
        group.duration === 600 &&
        byPseudo(flight, '::view-transition-old(tq-morph)').length > 0 &&
        byPseudo(flight, '::view-transition-new(tq-morph)').length > 0 &&
        leave &&
        leave.name === 'tq-page-leave' &&
        leave.duration === 300 &&
        arrive &&
        arrive.name === 'tq-page-arrive' &&
        arrive.delay === 300 &&
        (await pathname(page)) === '/about',
      {
        path: await pathname(page),
        group: group && [group.duration, group.from.width, group.to.width],
        leave: leave && [leave.name, leave.duration],
        arrive: arrive && [arrive.name, arrive.delay],
        ms: flight.ms,
      }
    )
    const hero = await page.evaluate(() => {
      const box = document.querySelector('#hero-photo').getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    check(
      'the flight starts at the card picture and lands exactly on the hero',
      !!group &&
        group.from.width === '300px' &&
        group.from.height === '200px' &&
        Math.abs(parseFloat(group.to.width) - hero.width) < 1 &&
        Math.abs(parseFloat(group.to.height) - hero.height) < 1,
      group && {
        from: [group.from.width, group.from.height],
        to: [group.to.width, group.to.height],
        hero,
      }
    )
    const named = await page.evaluate(
      () => Array.from(document.images).filter((image) => image.style.viewTransitionName).length
    )
    const wrappers = await page.evaluate(
      () => document.querySelectorAll('[data-tq-page-transition]').length
    )
    check(
      'once landed, nothing keeps the name and only the new page is left',
      named === 0 && wrappers === 1,
      {
        named,
        wrappers,
      }
    )

    let sampling = sampleWrapper(page)
    await page.goBack()
    let seen = await sampling
    await settle(page)
    records = await transitions(page)
    check(
      'going back plays the ordinary transition, without a flight',
      records.length === 1 && seen.minOpacity < 0.5 && (await pathname(page)) === '/',
      { transitions: records.length, seen, path: await pathname(page) }
    )

    await page.click('#stray-photo')
    await settle(page)
    records = await transitions(page)
    flight = records[1] || {}
    const stray = byPseudo(flight, '::view-transition-old(tq-morph)')
    check(
      'a picture the next page does not show leaves with its page, not over the next one',
      records.length === 2 &&
        stray.map((a) => a.name).join(' ') === 'tq-page-leave tq-morph-away' &&
        byPseudo(flight, '::view-transition-new(tq-morph)').length === 0,
      { stray: stray.map((a) => [a.name, a.duration]) }
    )

    sampling = sampleWrapper(page)
    await page.click('#to-home')
    seen = await sampling
    await settle(page)
    records = await transitions(page)
    check(
      'a link with no picture plays the ordinary transition',
      records.length === 2 &&
        seen.minOpacity < 0.5 &&
        seen.maxShift > 5 &&
        (await pathname(page)) === '/',
      { transitions: records.length, seen }
    )

    await page.click('#to-about')
    await settle(page)
    records = await transitions(page)
    check(
      'the plain text link to the same page flies the card picture too',
      records.length === 3 &&
        byPseudo(records[2], '::view-transition-group(tq-morph)').length === 1,
      { transitions: records.length }
    )

    const trail = []
    for (let round = 0; round < 4; round++) {
      await page.click('#to-home')
      await page.waitForTimeout(900)
      trail.push(await pathname(page))
      await page.click('#card-photo')
      await page.waitForTimeout(1100)
      trail.push(await pathname(page))
    }
    const rest = await page.evaluate(() => ({
      wrappers: document.querySelectorAll('[data-tq-page-transition]').length,
      named: Array.from(document.images).filter((image) => image.style.viewTransitionName).length,
    }))
    check(
      'eight page changes in a row: every one arrives, one page at a time',
      trail.join(' ') === '/ /about / /about / /about / /about' &&
        rest.wrappers === 1 &&
        rest.named === 0,
      { trail, rest }
    )
    await context.close()

    const calm = await open({ reducedMotion: 'reduce' })
    await calm.page.click('#card-photo')
    await settle(calm.page)
    check(
      'reduced motion: the page simply switches, nothing flies',
      (await transitions(calm.page)).length === 0 && (await pathname(calm.page)) === '/about',
      { transitions: (await transitions(calm.page)).length, path: await pathname(calm.page) }
    )
    await calm.context.close()
    await browser.close()
  } finally {
    stop()
  }

  // A reveal preset (Circle) on pages six screens long. The FIRST page appears
  // without its reveal and must not keep the reveal's clip on the whole page — a
  // clip left there broke the fixed header's blur and the pinned scenes while
  // scrolling. A page change must be measured on the screen: measured on the
  // page, the circle covered the screen almost at once (the new page popped in,
  // a flicker) and, leaving a scrolled page, closed on a point above the screen.
  const circle = await buildAndStart(
    'next-circle',
    { preset: 'circle', duration: 0.3, easing: 'ease-out' },
    false,
    { tall: true }
  )
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const SCREEN = { width: 1200, height: 800 }
    // CSS resolves the circle's 150% against the diagonal over root two — of the screen now
    const FULL = 1.5 * Math.sqrt((SCREEN.width ** 2 + SCREEN.height ** 2) / 2)
    const page = await browser.newPage({ viewport: SCREEN })
    await page.goto(circle.base + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const clipOf = () =>
      page.evaluate(() => document.querySelector('[data-tq-page-transition]').style.clipPath)
    const firstLoad = await clipOf()
    const unclipped = (clip) => clip === '' || clip === 'none'
    check('circle: the first page carries no clip once it is up', unclipped(firstLoad), {
      clipPath: firstLoad,
    })
    // The computed clip of every wrapper, frame by frame, with where the wrapper sits
    // on the screen: framer may run an animation in the browser, where its values
    // never reach the inline style.
    const record = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const frames = []
            const started = performance.now()
            const tick = () => {
              for (const wrapper of document.querySelectorAll('[data-tq-page-transition]')) {
                const match = /circle\(([\d.]+)px at ([\d.]+)px ([\d.]+)px\)/.exec(
                  getComputedStyle(wrapper).clipPath
                )
                frames.push({
                  t: performance.now() - started,
                  page: wrapper.getAttribute('data-tq-page-transition'),
                  radius: match ? Number(match[1]) : null,
                  // the circle's centre on the screen
                  centerY: match ? Number(match[3]) + wrapper.getBoundingClientRect().top : null,
                })
              }
              if (performance.now() - started < 1500) requestAnimationFrame(tick)
              else resolve(frames)
            }
            requestAnimationFrame(tick)
          })
      )
    const pressAt = async (selector) => {
      const box = await page.locator(selector).boundingBox()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const farthestCorner = (point) =>
      Math.max(
        ...[
          [0, 0],
          [SCREEN.width, 0],
          [0, SCREEN.height],
          [SCREEN.width, SCREEN.height],
        ].map(([x, y]) => Math.hypot(x - point.x, y - point.y))
      )

    const press = await pressAt('#to-about')
    const during = record()
    await page.mouse.click(press.x, press.y)
    const frames = await during
    const arriving = frames.filter((frame) => frame.page === '/about' && frame.radius !== null)
    const grew = arriving.some((frame) => frame.radius > 0.1 * FULL && frame.radius < 0.9 * FULL)
    // once the reveal has grown, a frame back at a closed circle is the page blinking away
    const peak = arriving.findIndex((frame) => frame.radius > 0.9 * FULL)
    const blink = peak >= 0 && arriving.slice(peak).some((frame) => frame.radius < 1)
    const settled = await clipOf()
    check(
      'circle: a page change plays the reveal to the end without blinking, and the page ends unclipped',
      grew && !blink && unclipped(settled),
      { grew, blink, lastFrames: arriving.slice(-3).map((frame) => frame.radius), settled }
    )
    // Measured on the screen: it ends at the screen's full circle (the page's is 3.4x
    // larger here), and the new page is still being revealed for a good part of the run.
    const largest = Math.max(...arriving.map((frame) => frame.radius))
    const covered = arriving.find((frame) => frame.radius >= farthestCorner(press))
    const coveredAt = covered && arriving.length ? covered.t - arriving[0].t : 0
    check(
      'circle: the arrival is measured on the screen and stays visible for most of its run',
      Math.abs(largest - FULL) < 2 && coveredAt >= 0.4 * 300,
      {
        largest: Math.round(largest),
        screenFull: Math.round(FULL),
        coveredAfterMs: Math.round(coveredAt),
      }
    )

    // Leaving a scrolled page: the circle closes on the press, on the screen.
    await page.goto(circle.base + '/', { waitUntil: 'networkidle' })
    await page.locator('#to-about-low').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const scrolledBy = await page.evaluate(() => window.scrollY)
    const lowPress = await pressAt('#to-about-low')
    const leavingFrames = record()
    await page.mouse.click(lowPress.x, lowPress.y)
    const leaving = (await leavingFrames).filter(
      (frame) => frame.page === '/' && frame.radius !== null
    )
    const off = leaving.map((frame) => Math.abs(frame.centerY - lowPress.y))
    check(
      'circle: leaving a scrolled page, the circle closes on the press, on the screen',
      scrolledBy > 2000 &&
        leaving.length > 3 &&
        Math.max(...off) < 2 &&
        leaving[0].radius > 0.9 * FULL,
      {
        scrolledBy,
        pressY: Math.round(lowPress.y),
        centreOnScreen: leaving.slice(0, 3).map((frame) => Math.round(frame.centerY)),
        firstRadius: leaving.length ? Math.round(leaving[0].radius) : null,
      }
    )
  } finally {
    circle.stop()
    await browser.close()
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
