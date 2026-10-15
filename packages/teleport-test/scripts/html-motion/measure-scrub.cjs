// How long a scroll video's frame takes to follow the scroll, on a throttled
// connection, in three ways of loading the clip:
//
//   streamed     the page's own <video preload="auto">, nothing held in memory
//   no-prefetch  the same with nothing fetched ahead, which is how Safari on
//                iPhone treats preload (it ignores "auto")
//   in memory    what published sites do (holdClip in teleport-shared): streamed by
//                the second through MediaSource for a fragmented clip, whole in
//                memory for any other — the `held` column says which
//
// It is the evidence for whether a clip ever needs more than being held in
// memory (a frame pack) in a given browser.
//
// node measure-scrub.cjs <site dir from pack-site.cjs, clip.mp4 inside> [mbps] [browsers]
//   mbps      connection speed, default 20
//   browsers  comma list of chrome, webkit (webkit only when Playwright's WebKit is installed)
const path = require('path')
const fs = require('fs')
const http = require('http')
const CG = path.resolve(__dirname, '../../../..')
const { chromium, webkit } = require(path.resolve(
  CG,
  '../teleport-gui/node_modules/playwright-core'
))
const root = process.argv[2]
const mbps = Number(process.argv[3]) || 20
const browsers = (process.argv[4] || 'chrome').split(',')
const LATENCY_MS = 60
const STALL_MS = 250
const STEPS = 40

const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
}
// Video bytes actually sent for the current run (a response cut short counts what left).
let videoBytes = 0
// Sends a body at the chosen speed, after the connection's latency.
const paced = (res, body) => {
  const bytesPerTick = Math.max(1024, Math.round((mbps * 1e6) / 8 / 50))
  let offset = 0
  const tick = () => {
    if (res.destroyed) {
      return
    }
    const end = Math.min(body.length, offset + bytesPerTick)
    res.write(body.subarray(offset, end))
    videoBytes += end - offset
    offset = end
    if (offset < body.length) {
      setTimeout(tick, 20)
    } else {
      res.end()
    }
  }
  setTimeout(tick, LATENCY_MS)
}
const server = http.createServer((req, res) => {
  const [pathname, query = ''] = req.url.split('?')
  const file = path.join(root, pathname === '/' ? 'index.html' : decodeURIComponent(pathname))
  if (!fs.existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  let data = fs.readFileSync(file)
  const type = types[path.extname(file)] || 'application/octet-stream'
  if (type === 'text/html') {
    let html = data.toString('utf8')
    // Without fetch the runtime cannot hold the clip and streams it as pages did before.
    // the packed page pretty-prints its head tag over two lines
    const head = /<head[^>]*>/
    if (/mode=(streamed|no-prefetch)/.test(query)) {
      html = html.replace(head, (tag) => tag + '<script>window.fetch = undefined</script>')
    }
    // Safari on iPhone ignores a request to preload: the first frame is all it fetches ahead.
    if (/mode=no-prefetch/.test(query)) {
      html = html.replace(
        head,
        (tag) =>
          tag +
          `<script>Object.defineProperty(HTMLMediaElement.prototype, 'preload', { configurable: true, get: () => 'metadata', set: () => {} })</script>`
      )
    }
    res.writeHead(200, { 'Content-Type': type })
    return res.end(html)
  }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Number(range[2]) : data.length - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${data.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Access-Control-Allow-Origin': '*',
    })
    return paced(res, data.subarray(start, end + 1))
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': data.length,
    'Access-Control-Allow-Origin': '*',
  })
  return type === 'video/mp4' ? paced(res, data) : res.end(data)
})

// The same scroll positions for every run: a visitor sweeping the scene back
// and forth, every jump a real move away from where the page starts (0).
const positions = (() => {
  let seed = 7
  const picked = []
  let previous = 0
  while (picked.length < STEPS) {
    seed = (seed * 16807) % 2147483647
    const next = Math.round((seed / 2147483647) * 1000) / 1000
    if (Math.abs(next - previous) >= 0.05) {
      picked.push(next)
      previous = next
    }
  }
  return picked
})()

const sweep = (page, steps) =>
  page.evaluate(
    async ({ steps, stall }) => {
      const track = document.getElementById('film')
      const top = track.getBoundingClientRect().top + scrollY
      const onScreen = () =>
        Array.from(document.querySelectorAll('#clip video')).find(
          (video) => getComputedStyle(video).display !== 'none'
        )
      const lags = []
      for (const p of steps) {
        const video = onScreen()
        const began = performance.now()
        // A jump the engine did not need to seek for (no `seeking` soon after) is not counted.
        const lag = await new Promise((resolve) => {
          let sought = false
          const onSeeking = () => {
            sought = true
          }
          const finish = (value) => {
            clearTimeout(timer)
            clearTimeout(noSeek)
            video.removeEventListener('seeking', onSeeking)
            video.removeEventListener('seeked', done)
            resolve(value)
          }
          const done = () => finish(performance.now() - began)
          const timer = setTimeout(() => finish(3000), 3000)
          const noSeek = setTimeout(() => {
            if (!sought && !video.seeking) {
              finish(null)
            }
          }, 200)
          video.addEventListener('seeking', onSeeking)
          video.addEventListener('seeked', done)
          scrollTo(0, top + p * (track.offsetHeight - innerHeight))
        })
        if (lag !== null) {
          lags.push(Math.round(lag))
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      return {
        lags,
        stall,
        memory: onScreen().currentSrc.startsWith('blob:'),
        held: onScreen().getAttribute('data-clip-held') || 'streamed by the browser',
      }
    },
    { steps, stall: STALL_MS }
  )

const summary = (lags) => {
  const sorted = [...lags].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    seeks: lags.length,
    median: at(0.5),
    p90: at(0.9),
    worst: sorted[sorted.length - 1],
    stalls: lags.filter((lag) => lag >= STALL_MS).length,
  }
}

;(async () => {
  await new Promise((resolve) => server.listen(0, resolve))
  const base = `http://localhost:${server.address().port}`
  const size = fs.statSync(path.join(root, 'clip.mp4')).size
  console.log(
    `clip ${(size / 1e6).toFixed(1)} MB · ${mbps} Mbps · ${LATENCY_MS} ms latency · ${STEPS} jumps`
  )
  const rows = []
  for (const name of browsers) {
    let browser
    try {
      browser =
        name === 'webkit'
          ? await webkit.launch({ headless: !process.env.HEADED })
          : await chromium.launch({ channel: 'chrome' })
    } catch (e) {
      console.log(`${name}: not available here (${String(e.message).split('\n')[0]})`)
      continue
    }
    for (const mode of ['streamed', 'no-prefetch', 'in-memory']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      const page = await context.newPage()
      videoBytes = 0
      await page.goto(`${base}/?mode=${mode}`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => document.getElementById('film').scrollIntoView())
      const loaded = Date.now()
      // In memory: measured once the copy has taken the streamed element's place.
      const ready =
        mode === 'in-memory'
          ? () => {
              const shown = Array.from(document.querySelectorAll('#clip video')).filter(
                (video) => getComputedStyle(video).display !== 'none'
              )
              return shown.length === 1 && shown[0].currentSrc.startsWith('blob:')
            }
          : () => document.querySelector('#clip video').readyState >= 1
      await page.waitForFunction(ready, null, { timeout: 120000 })
      const waited = Date.now() - loaded
      const run = await sweep(page, positions)
      // what the visit downloaded of the clip by the end of the sweep, in clip sizes
      const downloaded = Math.round((videoBytes / size) * 100) / 100
      // the same sweep again, once whatever the page fetches ahead has settled
      const settled = summary((await sweep(page, positions)).lags)
      rows.push({
        browser: name,
        mode,
        readyAfterMs: waited,
        held: run.held,
        downloaded,
        ...summary(run.lags),
        settledMedian: settled.median,
        settledP90: settled.p90,
        settledStalls: settled.stalls,
      })
      await context.close()
    }
    await browser.close()
  }
  console.table(rows)
  server.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
