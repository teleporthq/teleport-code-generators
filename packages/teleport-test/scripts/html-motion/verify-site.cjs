const { chromium } = require(require('path').resolve(
  __dirname,
  '../../../../../teleport-gui/node_modules/playwright-core'
))
const http = require('http')
const fs = require('fs')
const path = require('path')
const root = process.argv[2]
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
}
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0].split('#')[0])
  const file = path.join(root, url === '/' ? 'index.html' : url)
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    return res.end('nf')
  }
  const data = fs.readFileSync(file)
  const range = req.headers.range
  const type = types[path.extname(file)] || 'application/octet-stream'
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range)
    const start = Number(m[1])
    const end = m[2] ? Number(m[2]) : data.length - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${data.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    })
    return res.end(data.subarray(start, end + 1))
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': data.length,
  })
  res.end(data)
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
const near = (a, b, tol) => Math.abs(a - b) <= tol

;(async () => {
  await new Promise((r) => server.listen(0, r))
  const base = `http://localhost:${server.address().port}`
  const browser = await chromium.launch()

  // ---------- 1. a normal visitor
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => {
    if (!/unpkg\.com/.test(e.stack || '')) errors.push((e.stack || String(e)).slice(0, 300))
  })

  await page.addInitScript(() => {
    window.__events = []
    document.addEventListener('tq-chapter-reached', (e) =>
      window.__events.push({ type: 'chapter', id: e.target.id, detail: e.detail })
    )
    document.addEventListener('tq-scene-point-passed', (e) =>
      window.__events.push({ type: 'point', id: e.target.id, point: e.detail.point })
    )
  })
  await page.goto(base + '/', { waitUntil: 'load' })
  await page.waitForTimeout(700)
  check(
    'runtime booted and the page is flagged',
    await page.evaluate(
      () =>
        window.__tqMotionRuntime === true &&
        document.documentElement.hasAttribute('data-tq-motion-on')
    )
  )
  check(
    'load entrance finished visible',
    await page.evaluate(() => {
      const e = document.getElementById('load-fade')
      return e.hasAttribute('data-motion-ready') && getComputedStyle(e).opacity === '1'
    })
  )

  const geo = await page.evaluate(() => {
    const track = document.getElementById('story')
    const stage = track.querySelector('[data-scene-stage]')
    return {
      trackH: track.offsetHeight,
      vh: innerHeight,
      stagePos: getComputedStyle(stage).position,
      stageDisplay: getComputedStyle(stage).display,
      trackTop: track.getBoundingClientRect().top + scrollY,
    }
  })
  check(
    'scene track is three screens tall and the stage is a sticky grid',
    near(geo.trackH, geo.vh * 3, 2) && geo.stagePos === 'sticky' && geo.stageDisplay === 'grid',
    geo
  )

  const scrollToProgress = async (id, p) => {
    await page.evaluate(
      ({ id, p }) => {
        const t = document.getElementById(id)
        const top = t.getBoundingClientRect().top + scrollY
        scrollTo(0, top + p * (t.offsetHeight - innerHeight))
      },
      { id, p }
    )
    await page.waitForTimeout(250)
  }
  const chapterState = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ['chapter-one', 'chapter-two', 'chapter-three'].map((id) => {
          const e = document.getElementById(id)
          const cs = getComputedStyle(e)
          const r = e.getBoundingClientRect()
          return [
            id,
            {
              opacity: Number(cs.opacity).toFixed(2),
              translate: cs.translate,
              hidden: e.hasAttribute('data-scene-hidden'),
              active: e.getAttribute('data-chapter-active'),
              top: Math.round(r.top),
              h: Math.round(r.height),
            },
          ]
        })
      )
    )

  await scrollToProgress('story', 0.1)
  let st = await chapterState()
  const stageTop = await page.evaluate(() =>
    Math.round(document.querySelector('#story [data-scene-stage]').getBoundingClientRect().top)
  )
  check('stage stays pinned at the top while the track scrolls', stageTop === 0, { stageTop })
  check(
    'progress 0.10: chapter one visible, two and three hidden and click-through',
    st['chapter-one'].opacity === '1.00' &&
      st['chapter-two'].opacity === '0.00' &&
      st['chapter-two'].hidden &&
      st['chapter-three'].hidden,
    st
  )
  check(
    'chapters share one grid cell (same vertical centre)',
    near(
      st['chapter-one'].top + st['chapter-one'].h / 2,
      st['chapter-two'].top + st['chapter-two'].h / 2,
      30
    ),
    [st['chapter-one'].top, st['chapter-two'].top]
  )
  await scrollToProgress('story', 0.5)
  st = await chapterState()
  check(
    'progress 0.50: chapter two on stage, stamped active',
    st['chapter-two'].opacity === '1.00' &&
      st['chapter-one'].opacity === '0.00' &&
      st['chapter-two'].active === '2',
    st
  )
  await scrollToProgress('story', 0.9)
  st = await chapterState()
  check(
    'progress 0.90: chapter three arrived and rests',
    st['chapter-three'].opacity === '1.00' &&
      /^0px( 0px)?$/.test(st['chapter-three'].translate) &&
      st['chapter-three'].active === '3',
    st
  )
  const backdrop = await page.evaluate(() => {
    const e = document.getElementById('backdrop')
    const cs = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    return {
      position: cs.position,
      z: cs.zIndex,
      w: Math.round(r.width),
      h: Math.round(r.height),
      vw: innerWidth,
      vh: innerHeight,
    }
  })
  check(
    'backdrop fills the stage underneath the chapters',
    backdrop.position === 'absolute' &&
      backdrop.z === '-1' &&
      near(backdrop.w, backdrop.vw, 20) &&
      near(backdrop.h, backdrop.vh, 2),
    backdrop
  )
  const events = await page.evaluate(() => window.__events)
  const chapterIds = events.filter((e) => e.type === 'chapter').map((e) => e.id)
  const points = events.filter((e) => e.type === 'point' && e.id === 'story').map((e) => e.point)
  check(
    'chapters were announced in order',
    JSON.stringify(chapterIds.slice(0, 3)) ===
      JSON.stringify(['chapter-one', 'chapter-two', 'chapter-three']),
    chapterIds
  )
  check(
    'scene points were announced and stamped',
    points.includes('quarter') &&
      points.includes('half') &&
      points.includes('three-quarters') &&
      (await page.evaluate(() =>
        document.getElementById('story').getAttribute('data-scene-point')
      )) === 'three-quarters',
    points
  )

  // anchor navigation into the pinned scene
  await page.evaluate(() => scrollTo(0, 0))
  await page.waitForTimeout(200)
  await page.click('#jump')
  {
    let last = -1
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150)
      const y = await page.evaluate(() => scrollY)
      if (y === last) break
      last = y
    }
  }
  const anchor = await page.evaluate(() => {
    const t = document.getElementById('story')
    const top = t.getBoundingClientRect().top + scrollY
    return { progress: (scrollY - top) / (t.offsetHeight - innerHeight), hash: location.hash }
  })
  check(
    "an anchor link into the scene lands on that chapter's moment",
    near(anchor.progress, 0.695, 0.02) && anchor.hash === '#chapter-three',
    anchor
  )

  // in-view entrance
  const before = await page.evaluate(() => {
    const e = document.getElementById('slide')
    const cs = getComputedStyle(e)
    return {
      opacity: cs.opacity,
      translate: cs.translate,
      ready: e.hasAttribute('data-motion-ready'),
      visibility: cs.visibility,
    }
  })
  check(
    'below the fold: the entrance waits at its start state',
    before.ready && before.opacity === '0' && before.translate === '0px 40px',
    before
  )
  await page.evaluate(() => document.getElementById('slide').scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(1100)
  const after = await page.evaluate(() => {
    const e = document.getElementById('slide')
    const cs = getComputedStyle(e)
    return { opacity: cs.opacity, translate: cs.translate }
  })
  check(
    'in view: the entrance played to rest',
    after.opacity === '1' && (after.translate === 'none' || after.translate === '0px'),
    after
  )

  // stagger in place
  const cascade = await page.evaluate(() => {
    const grid = document.getElementById('grid')
    return {
      kids: Array.from(grid.children).map((c) => c.id),
      delays: Array.from(grid.children).map((c) =>
        getComputedStyle(c).transitionDelay.split(',')[0].trim()
      ),
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      widths: Array.from(grid.children).map((c) => Math.round(c.getBoundingClientRect().width)),
    }
  })
  check(
    "stagger adds no wrapper: the cards are still the grid's own three items, each with its delay",
    JSON.stringify(cascade.kids) === JSON.stringify(['card-a', 'card-b', 'card-c']) &&
      cascade.columns === 3 &&
      JSON.stringify(cascade.delays) === JSON.stringify(['0s', '0.1s', '0.2s']) &&
      cascade.widths.every((w) => w > 300),
    cascade
  )
  await page.evaluate(() => document.getElementById('cascade').scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(1300)
  check(
    'cascade played',
    await page.evaluate(() =>
      Array.from(document.getElementById('grid').children).every(
        (c) => getComputedStyle(c).opacity === '1'
      )
    )
  )

  // hover
  await page.evaluate(() => document.getElementById('hover').scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  await page.hover('#hover')
  await page.waitForTimeout(500)
  const hoverScale = await page.evaluate(
    () => getComputedStyle(document.getElementById('hover')).scale
  )
  await page.mouse.move(5, 5)
  await page.waitForTimeout(500)
  const restScale = await page.evaluate(
    () => getComputedStyle(document.getElementById('hover')).scale
  )
  check(
    'hover scales up and releases',
    hoverScale === '1.2' && (restScale === 'none' || restScale === '1'),
    { hoverScale, restScale }
  )

  // scroll linked
  const linked = []
  for (const block of ['end', 'center', 'start']) {
    await page.evaluate(
      (b) => document.getElementById('linked').scrollIntoView({ block: b }),
      block
    )
    await page.waitForTimeout(200)
    linked.push(
      await page.evaluate(() => Number(getComputedStyle(document.getElementById('linked')).opacity))
    )
  }
  check(
    'scroll-linked motion follows the scroll position',
    linked[0] < linked[1] && linked[1] < linked[2],
    linked
  )

  // scroll video: once its scene is near, the clip is held in memory and a copy playing from it
  // takes the streamed element's place (bufferWholeClip in teleport-shared)
  await scrollToProgress('film', 0.02)
  const held = await page
    .waitForFunction(
      () => {
        const videos = Array.from(document.querySelectorAll('#clip video'))
        const shown = videos.filter((v) => getComputedStyle(v).display !== 'none')
        return (
          shown.length === 1 &&
          shown[0].currentSrc.startsWith('blob:') &&
          shown[0].readyState >= 1 && {
            videos: videos.length,
            streamedReleased: !videos[0].getAttribute('src'),
          }
        )
      },
      null,
      { timeout: 15000 }
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  check(
    'scroll video: the clip is held in memory, one element on screen, the streamed one let go',
    !!held && held.videos === 2 && held.streamedReleased,
    held
  )
  const videoAt = async (p) => {
    await scrollToProgress('film', p)
    await page.waitForTimeout(300)
    return page.evaluate(() => {
      const v = Array.from(document.querySelectorAll('#clip video')).find(
        (candidate) => getComputedStyle(candidate).display !== 'none'
      )
      return {
        t: Number(v.currentTime.toFixed(2)),
        d: Number((v.duration || 0).toFixed(2)),
        src: v.getAttribute('src'),
        pos: getComputedStyle(v).position,
      }
    })
  }
  const v0 = await videoAt(0.02),
    v5 = await videoAt(0.5),
    v9 = await videoAt(0.98)
  check(
    'scroll video scrubs with the scene',
    v0.d > 0 && v0.t < v5.t && v5.t < v9.t && near(v5.t, v5.d / 2, 0.25) && v0.pos === 'absolute',
    { v0, v5, v9 }
  )
  check('no script errors on the page', errors.length === 0, errors.slice(0, 3))
  await page.close()

  // ---------- 2. a visitor who asked for less motion
  const calm = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await calm.emulateMedia({ reducedMotion: 'reduce' })
  await calm.goto(base + '/', { waitUntil: 'load' })
  await calm.waitForTimeout(500)
  const calmState = await calm.evaluate(() => ({
    three: getComputedStyle(document.getElementById('chapter-three')).opacity,
    one: getComputedStyle(document.getElementById('chapter-one')).opacity,
    slide: getComputedStyle(document.getElementById('slide')).opacity,
    slideVisible: getComputedStyle(document.getElementById('slide')).visibility,
  }))
  check(
    'reduced motion: the story rests on its final state and nothing waits hidden',
    calmState.three === '1' &&
      calmState.one === '0' &&
      calmState.slide === '1' &&
      calmState.slideVisible === 'visible',
    calmState
  )
  await calm.close()

  // ---------- 3. a visitor without JavaScript
  const noJsContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 800 },
  })
  const noJs = await noJsContext.newPage()
  await noJs.goto(base + '/', { waitUntil: 'load' })
  const plain = await noJs
    .$eval('#story', (track) => {
      const stage = track.querySelector('[data-scene-stage]')
      const tops = ['chapter-one', 'chapter-two', 'chapter-three'].map((id) =>
        Math.round(document.getElementById(id).getBoundingClientRect().top)
      )
      return {
        stagePos: getComputedStyle(stage).position,
        tops,
        slideVisible: getComputedStyle(document.getElementById('slide')).visibility,
      }
    })
    .catch((e) => ({ error: String(e) }))
  check(
    'without JavaScript: chapters read one after another and nothing is hidden',
    plain.stagePos === 'static' &&
      plain.tops[0] < plain.tops[1] &&
      plain.tops[1] < plain.tops[2] &&
      plain.slideVisible === 'visible',
    plain
  )
  await noJsContext.close()

  // ---------- 4. the runtime file never arrives
  const blocked = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await blocked.route('**/tq-motion.js', (route) => route.abort())
  await blocked.goto(base + '/', { waitUntil: 'load' })
  const early = await blocked.evaluate(
    () => getComputedStyle(document.getElementById('slide')).visibility
  )
  await blocked.waitForTimeout(4300)
  const late = await blocked.evaluate(() => ({
    visibility: getComputedStyle(document.getElementById('slide')).visibility,
    flagged: document.documentElement.hasAttribute('data-tq-motion-on'),
  }))
  check(
    'runtime blocked: content is released after the failsafe',
    early === 'hidden' && late.visibility === 'visible' && !late.flagged,
    { early, late }
  )
  await blocked.close()

  await browser.close()
  server.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
