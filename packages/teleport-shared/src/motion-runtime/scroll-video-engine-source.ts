/**
 * The scroll-video maths as SOURCE TEXT: the clip window, the progress a
 * rectangle has made through the viewport, and the clip held in memory. Shared
 * word for word by the Next export (TqScrollVideo) and the HTML export's
 * vanilla controller; mirrors the canvas renderer's scroll-video-runtime and
 * its full-file buffering.
 */
export const scrollVideoEngineSource =
  (): string => `const clamp01 = (value) => Math.min(1, Math.max(0, value))

const MIN_WINDOW_SPAN = 1

const normalizeWindow = (startRaw, endRaw) => {
  const parse = (value, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback
  }
  const start = parse(startRaw, 0)
  const end = parse(endRaw, 100)
  if (end - start >= MIN_WINDOW_SPAN) {
    return { start, end }
  }
  return start <= 100 - MIN_WINDOW_SPAN
    ? { start, end: start + MIN_WINDOW_SPAN }
    : { start: 100 - MIN_WINDOW_SPAN, end: 100 }
}

// Mirrors the canvas renderer's scrollProgressForOffset for the two modes a
// scrub video needs: 'contained' (a pinned scene's stage holds while its track
// scrolls under it) and 'pass' (a plain trip through the viewport).
const progressForRect = (rect, viewportHeight, offset) => {
  const vh = viewportHeight || 1
  let raw
  if (offset === 'contained') {
    const travel = rect.height - vh
    raw = travel > 0 ? -rect.top / travel : (vh - rect.top) / (vh + rect.height)
  } else {
    raw = (vh - rect.top) / (vh + rect.height)
  }
  return clamp01(raw)
}

// Where in the clip a window progress lands. Played back to the start, the
// clip reaches its last frame halfway through the window and its first frame
// again at the end (the editor's clipPositionForWindowProgress, word for word).
const clipPositionFor = (windowProgress, backToStart) => {
  const position = clamp01(windowProgress)
  if (!backToStart) {
    return position
  }
  return position <= 0.5 ? position * 2 : (1 - position) * 2
}

// ── Holding the clip ──
// A scroll clip is consumed frame by frame at arbitrary positions, so a seek
// must never wait on the network: a streaming <video> holds only what it has
// fetched around the playhead (Safari on iPhone fetches nothing ahead), so a
// fast scroll outruns it and the frame freezes. Two ways to hold it, tried in
// order once the scene is about a screen away (the assets bucket allows the
// read from any site):
//   1. Streamed by the second. A clip the media worker made is fragmented,
//      with an index of every fragment in its first bytes. With MediaSource
//      the page keeps the seconds around the scroll position in the element
//      and fetches fragments as the position moves — a clip of any length costs
//      the same memory and is ready to scrub almost at once.
//   2. Whole, in memory: the file fetched once and played from a blob — an
//      older encode, an upload, a browser without MediaSource (an iPhone), an
//      index that could not be read.
// Either way the streamed element keeps scrubbing meanwhile; then a copy takes
// its place at the frame on screen and the streamed one lets go of its
// download. A fresh element, not a new src on the old one: engines get stuck
// after a src swap on an element that has already seeked. The page asks the
// streamed element for its first frame only (preload="metadata"), so the clip
// is not downloaded twice; where the clip cannot be held (a host that refuses,
// a whole clip too big, no fetch) it goes back to preloading the way it
// streamed before. A visitor saving data keeps the first frame only.
const MAX_BUFFERED_CLIP_BYTES = 100 * 1024 * 1024
// The first bytes of a clip: its header and, for a fragmented clip, the index.
const CLIP_HEAD_BYTES = 65536
// Streamed: the seconds kept around the scroll position — fetched in order of
// need (the second on screen, then ahead, then behind) and let go beyond it. A
// clip shorter than twice this ends up whole in the element, like before, only
// scrubbable long before it has all arrived.
const STREAM_KEEP_SECONDS = 12
// One request fetches consecutive missing fragments up to this much.
const STREAM_REQUEST_SECONDS = 2
const STREAM_REQUEST_BYTES = 6 * 1024 * 1024

// The fragment index a scrub encode carries in its first bytes (ftyp, moov,
// then a sidx naming every fragment): where each second of the clip is in the
// file. Null for a file without one, which is then held whole.
const readClipIndex = (head) => {
  const view = new DataView(head)
  const boxType = (at) => String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7))
  let at = 0
  let moovEnd = 0
  let sidx = null
  while (at + 8 <= head.byteLength) {
    const size = view.getUint32(at)
    const type = boxType(at)
    if (size < 8) {
      return null
    }
    if (type === 'moov') {
      moovEnd = at + size
    } else if (type === 'sidx') {
      sidx = { at: at, size: size }
      break
    } else if (type !== 'ftyp' && type !== 'free' && type !== 'skip') {
      break
    }
    at += size
  }
  if (!moovEnd || !sidx || sidx.at + sidx.size > head.byteLength || sidx.at < moovEnd) {
    return null
  }
  // the codec, from the avcC box inside moov: H.264, profile and level as the file says
  let codec = null
  const bytes = new Uint8Array(head)
  for (let i = 0; i < moovEnd - 8; i++) {
    if (bytes[i] === 0x61 && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x43) {
      const hex = (value) => (value < 16 ? '0' : '') + value.toString(16).toUpperCase()
      codec = 'avc1.' + hex(bytes[i + 5]) + hex(bytes[i + 6]) + hex(bytes[i + 7])
      break
    }
  }
  if (!codec) {
    return null
  }
  const body = sidx.at + 8
  const version = view.getUint8(body)
  const timescale = view.getUint32(body + 8)
  let cursor = body + 12
  let firstOffset
  if (version === 0) {
    firstOffset = view.getUint32(cursor + 4)
    cursor += 8
  } else {
    firstOffset = Number(view.getBigUint64(cursor + 8))
    cursor += 16
  }
  const count = view.getUint16(cursor + 2)
  cursor += 4
  if (!timescale || !count) {
    return null
  }
  const fragments = []
  let start = sidx.at + sidx.size + firstOffset
  let time = 0
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(cursor) & 0x7fffffff
    const duration = view.getUint32(cursor + 4) / timescale
    fragments.push({ start: start, end: start + size - 1, time: time, duration: duration })
    start += size
    time += duration
    cursor += 12
  }
  return { initEnd: moovEnd, codec: codec, fragments: fragments, duration: time }
}

// A copy of the streamed element, to take its place once it shows the frame on screen.
const copyOf = (video) => {
  const copy = video.cloneNode(false)
  copy.removeAttribute('src')
  copy.muted = true
  copy.style.opacity = '0'
  return copy
}

// Streams the clip by the second through MediaSource. Null where the browser
// cannot (no MediaSource, or not for this codec) — the clip is then held whole.
// Ranged requests go to the clip under a URL of their own: WebKit holds a second
// request for a URL it is still downloading (the streamed element's) until that
// one is done, which would delay the first second by the whole file.
const rangedUrl = (src) => src + (src.indexOf('?') >= 0 ? '&' : '?') + 'tq-stream'

const streamClip = (video, src, head, index, onSwap, signal, onFail) => {
  const MediaSourceCtor = window.MediaSource
  const mime = 'video/mp4; codecs="' + index.codec + '"'
  if (!MediaSourceCtor || typeof MediaSourceCtor.isTypeSupported !== 'function' || !MediaSourceCtor.isTypeSupported(mime)) {
    return null
  }
  const fragments = index.fragments
  const source = new MediaSourceCtor()
  const objectUrl = URL.createObjectURL(source)
  const copy = copyOf(video)
  copy.setAttribute('data-clip-held', 'stream')
  let buffer = null
  let loaded = []
  let failed = 0
  let busy = false
  let inFlight = false
  let pausedUntil = 0
  let wanted = 0
  let swapped = false
  let stopped = false
  const pending = []
  const fragmentAt = (seconds) => {
    for (let i = 0; i < fragments.length; i++) {
      if (seconds < fragments[i].time + fragments[i].duration) {
        return i
      }
    }
    return fragments.length - 1
  }
  const takeOver = () => {
    if (stopped) {
      return
    }
    copy.style.opacity = ''
    video.style.display = 'none'
    video.removeAttribute('src')
    video.load()
    onSwap(copy)
  }
  const run = () => {
    if (stopped || !buffer || busy || buffer.updating || !pending.length) {
      return
    }
    const task = pending.shift()
    busy = true
    try {
      if (task.remove) {
        buffer.remove(task.from, task.to)
      } else {
        buffer.appendBuffer(task.data)
      }
    } catch (e) {
      busy = false
      if (task.remove) {
        run()
        return
      }
      // no room for another second: let every other second go, then try once more
      if (!task.retried) {
        task.retried = true
        letGo(true)
        pending.push(task)
      } else {
        for (let i = task.from; i <= task.to; i++) {
          loaded[i] = false
        }
      }
      run()
    }
  }
  const onUpdateEnd = () => {
    busy = false
    if (stopped) {
      return
    }
    if (!swapped && loaded[fragmentAt(wanted)]) {
      swapped = true
      copy.addEventListener('seeked', takeOver, { once: true })
      copy.currentTime = wanted
    }
    run()
    fetchNext()
  }
  const letGo = (everything) => {
    const keepFrom = everything ? wanted : wanted - STREAM_KEEP_SECONDS
    const keepTo = everything ? wanted : wanted + STREAM_KEEP_SECONDS
    let from = -1
    for (let i = 0; i <= fragments.length; i++) {
      const far = i < fragments.length && loaded[i] && (fragments[i].time + fragments[i].duration < keepFrom || fragments[i].time > keepTo)
      if (far && from < 0) {
        from = i
      }
      if (!far && from >= 0) {
        for (let k = from; k < i; k++) {
          loaded[k] = false
        }
        pending.push({ remove: true, from: fragments[from].time, to: fragments[i - 1].time + fragments[i - 1].duration })
        from = -1
      }
    }
  }
  const fetchNext = () => {
    if (stopped || !buffer || inFlight || Date.now() < pausedUntil) {
      return
    }
    const at = fragmentAt(wanted)
    // the second on screen first, then ahead, then behind, out to what is kept
    const order = [at]
    for (let k = 1; k < fragments.length; k++) {
      if (at + k < fragments.length && fragments[at + k].time - wanted <= STREAM_KEEP_SECONDS) {
        order.push(at + k)
      }
      if (
        at - k >= 0 &&
        wanted - (fragments[at - k].time + fragments[at - k].duration) <= STREAM_KEEP_SECONDS
      ) {
        order.push(at - k)
      }
    }
    let first = -1
    for (let i = 0; i < order.length; i++) {
      if (!loaded[order[i]]) {
        first = order[i]
        break
      }
    }
    if (first < 0) {
      return
    }
    let last = first
    while (
      last + 1 < fragments.length &&
      !loaded[last + 1] &&
      fragments[last + 1].end - fragments[first].start < STREAM_REQUEST_BYTES &&
      fragments[last + 1].time + fragments[last + 1].duration - fragments[first].time <= STREAM_REQUEST_SECONDS
    ) {
      last++
    }
    inFlight = true
    fetch(rangedUrl(src), { headers: { range: 'bytes=' + fragments[first].start + '-' + fragments[last].end }, signal: signal })
      .then((response) => (response.status === 206 ? response.arrayBuffer() : Promise.reject(new Error('no range'))))
      .then((data) => {
        inFlight = false
        if (stopped) {
          return
        }
        for (let i = first; i <= last; i++) {
          loaded[i] = true
        }
        letGo(false)
        pending.push({ data: data, from: first, to: last })
        run()
      })
      .catch(() => {
        inFlight = false
        if (stopped) {
          return
        }
        // a second that could not be fetched: hold the clip whole instead when
        // nothing has played yet, otherwise try again in a moment
        failed++
        pausedUntil = Date.now() + 2000
        if (!swapped && failed >= 2) {
          onFail()
        }
      })
  }
  source.addEventListener('sourceopen', () => {
    if (stopped) {
      return
    }
    try {
      buffer = source.addSourceBuffer(mime)
    } catch (e) {
      onFail()
      return
    }
    buffer.mode = 'segments'
    buffer.addEventListener('updateend', onUpdateEnd)
    buffer.addEventListener('error', onFail)
    // the clip's length comes from the index, not from a header written before the fragments
    source.duration = index.duration
    pending.push({ data: head.slice(0, index.initEnd), from: 0, to: -1 })
    run()
    fetchNext()
  }, { once: true })
  copy.src = objectUrl
  video.parentNode.insertBefore(copy, video.nextSibling)
  // The streamed element's own download is let go: the copy takes over long
  // before it would show a frame (a browser may fetch the whole file for the
  // element's metadata), and its bytes would only slow the seconds down.
  video.removeAttribute('src')
  video.load()
  return {
    want: (progress) => {
      wanted = clamp01(progress) * index.duration
      fetchNext()
    },
    stop: () => {
      stopped = true
      copy.remove()
      URL.revokeObjectURL(objectUrl)
    },
  }
}

// Holds the clip whole: fetched once (or already fetched) and played from memory.
const holdWholeClip = (video, src, onSwap, signal, prefetched, onFail) => {
  let stopped = false
  let objectUrl = null
  let copy = null
  const takeOver = () => {
    if (stopped) {
      return
    }
    copy.style.opacity = ''
    video.style.display = 'none'
    video.removeAttribute('src')
    video.load()
    onSwap(copy)
  }
  const hold = (blob) => {
    if (stopped) {
      return
    }
    objectUrl = URL.createObjectURL(blob)
    copy = copyOf(video)
    copy.setAttribute('data-clip-held', 'memory')
    copy.addEventListener('loadedmetadata', () => {
      copy.addEventListener('seeked', takeOver, { once: true })
      copy.currentTime = video.currentTime
    }, { once: true })
    copy.src = objectUrl
    video.parentNode.insertBefore(copy, video.nextSibling)
  }
  if (prefetched) {
    hold(prefetched)
  } else {
    fetch(src, signal ? { signal: signal } : undefined)
      .then((response) => {
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_BUFFERED_CLIP_BYTES) {
          throw new Error('keep streaming')
        }
        return response.blob()
      })
      .then(hold)
      .catch(() => {
        if (!stopped) {
          onFail()
        }
      })
  }
  return {
    want: () => {},
    stop: () => {
      stopped = true
      if (copy) {
        copy.remove()
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    },
  }
}

const holdClip = (host, video, src, onSwap) => {
  const noHold = { want: () => {}, stop: () => {} }
  const stream = () => {
    video.preload = 'auto'
  }
  if (navigator.connection && navigator.connection.saveData) {
    return noHold
  }
  if (!src || /^(blob|data):/.test(src) || typeof fetch !== 'function' || !window.URL || !URL.createObjectURL) {
    stream()
    return noHold
  }
  let stopped = false
  let observer = null
  let holder = null
  let released = false
  let wanted = 0
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const signal = controller ? controller.signal : undefined
  const swapped = (copy) => {
    released = true
    onSwap(copy)
  }
  const giveUp = () => {
    if (!stopped && !released) {
      stream()
    }
  }
  const whole = (prefetched) => {
    holder = holdWholeClip(video, src, swapped, signal, prefetched, giveUp)
  }
  // The first bytes tell which way the clip can be held. A host that will not
  // answer a ranged request (or its cross-origin permission) still serves the
  // whole file to a plain request, the way clips were held before.
  const load = () => {
    fetch(rangedUrl(src), { headers: { range: 'bytes=0-' + (CLIP_HEAD_BYTES - 1) }, signal: signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('keep streaming')
        }
        const total = response.status === 206
          ? Number((response.headers.get('content-range') || '').split('/')[1])
          : Number(response.headers.get('content-length'))
        return response.arrayBuffer().then((head) => ({ head: head, partial: response.status === 206, total: total }))
      })
      .then((answer) => {
        if (stopped) {
          return
        }
        // a host that answered with the whole file: it is already here
        if (!answer.partial) {
          if (answer.head.byteLength > MAX_BUFFERED_CLIP_BYTES) {
            throw new Error('too big')
          }
          whole(new Blob([answer.head], { type: 'video/mp4' }))
          return
        }
        const index = readClipIndex(answer.head)
        if (index && typeof MediaSource !== 'undefined') {
          holder = streamClip(video, src, answer.head, index, swapped, signal, () => {
            if (!stopped && !released) {
              holder.stop()
              whole(null)
            }
          })
          if (holder) {
            holder.want(wanted)
            return
          }
        }
        if (answer.total > MAX_BUFFERED_CLIP_BYTES) {
          throw new Error('too big')
        }
        whole(null)
      })
      .catch((error) => {
        if (stopped) {
          return
        }
        if (String(error && error.message) === 'too big') {
          giveUp()
          return
        }
        whole(null)
      })
  }
  // A scene about a screen away loads at once — when it is there from the
  // start, when it comes near, or at the first scrub request that finds it
  // near (an observer's first word waits for a rendering update, which a page
  // still loading its media may not give for a while).
  let started = false
  const near = () => {
    const box = host.getBoundingClientRect()
    const screen = window.innerHeight || 1
    return box.bottom > -screen && box.top < screen * 2
  }
  const start = () => {
    if (started) {
      return
    }
    started = true
    if (observer) {
      observer.disconnect()
      observer = null
    }
    load()
  }
  if (near()) {
    start()
  } else if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        start()
      }
    }, { rootMargin: '100% 0px' })
    observer.observe(host)
  } else {
    start()
  }
  return {
    // where the scrub is, as clip progress (0-1, known before any metadata): a
    // streamed clip keeps the seconds around it ready
    want: (progress) => {
      wanted = progress
      if (!started && near()) {
        start()
      }
      if (holder) {
        holder.want(progress)
      }
    },
    stop: () => {
      stopped = true
      if (observer) {
        observer.disconnect()
      }
      if (controller) {
        controller.abort()
      }
      if (holder) {
        holder.stop()
      }
      video.style.display = ''
      if (video.isConnected && !video.getAttribute('src')) {
        video.setAttribute('src', src)
      }
    },
  }
}`
