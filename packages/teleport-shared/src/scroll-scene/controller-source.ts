/**
 * The parts of a scroll scene's controller that are plain DOM JavaScript, as
 * SOURCE TEXT, shared word for word by the Next export's TqScrollScene and the
 * HTML export's vanilla controller. Each block talks to its surroundings through
 * the same names in both hosts:
 *
 *   trackRef, progressRef, chapterHelpersRef, chapterStateRef,
 *   scenePointStateRef, awaitedTagsRef, restackRef   objects with a `current`
 *   pin, layout, chapterSnap, shouldReduceMotion      the scene's settings
 *
 * In React those are refs and props; in the HTML runtime they are plain objects
 * and constants of the same names. The engine (engine-source.ts) must be in
 * scope. Bodies that were React effects keep their early `return undefined` and
 * their returned cleanup, so a host wraps them in a function.
 */

/** Scene points and chapters announced as DOM events, with the stamps late listeners read. */
export const announcementsSource =
  (): string => `  // Announces the points passed on the way down, in scroll order, one
  // microtask later (the ancestors' effects, where generated listeners attach,
  // have run by then). The stamp is written with the dispatch, never before it,
  // so a listener attaching in the same effect flush sees no stamp and gets the
  // event, while one attaching later reads the stamp and nothing is announced
  // twice. The first announcement measures from below the scene, so a page
  // that opens already past a point (an anchor link, a restored scroll) counts
  // it as passed. Going up announces nothing; the next way down announces again.
  const announceScenePoints = (p) => {
    const state = scenePointStateRef.current
    const from = state.last === null ? -1 : state.last
    state.last = p
    const passed = passedScenePoints(from, p)
    if (passed.length === 0) {
      return
    }
    state.pending = state.pending.concat(passed)
    if (state.scheduled) {
      return
    }
    state.scheduled = true
    Promise.resolve().then(() => {
      const current = scenePointStateRef.current
      current.scheduled = false
      const batch = current.pending
      current.pending = []
      const track = trackRef.current
      if (!track) {
        return
      }
      for (const key of batch) {
        if (scenePointRank(key) > scenePointRank(track.getAttribute(SCENE_POINT_ATTR) || '')) {
          track.setAttribute(SCENE_POINT_ATTR, key)
        }
        track.dispatchEvent(
          new CustomEvent(SCENE_POINT_EVENT, {
            bubbles: true,
            detail: { point: key, progress: current.last },
          })
        )
      }
    })
  }

  // The chapters in document order with the moment each one is on stage —
  // the same moment chapter snap and anchor navigation aim at; a chapter
  // without a moment of its own takes the start of its even share.
  const chapterRecords = () => {
    const track = trackRef.current
    const helpers = chapterHelpersRef.current
    if (!track || !helpers) {
      return []
    }
    const chapters = helpers.chapterElements(track)
    return chapters.map((element, index) => {
      const moment = helpers.chapterProgress(element)
      return {
        element,
        moment:
          moment === null ? index / chapters.length : Math.min(1, Math.max(0, moment)),
      }
    })
  }

  // Announces chapters as the visitor passes their moments: every chapter
  // between the last announced one and the one now on stage gets its
  // tq-chapter-reached (bubbling) in travel order, so a jump past a chapter
  // still counts as reaching it. The current chapter carries
  // data-chapter-active / data-chapter-count for listeners that attach later.
  // Dispatch is deferred to a microtask: the ancestors' effects (where the
  // generated listeners attach) have run by then, and nothing is a frame late.
  const announceChapter = (p) => {
    const state = chapterStateRef.current
    if (state.records === null) {
      state.records = chapterRecords()
      state.moments = state.records.map((record) => record.moment)
      // A rebuilt list may hold NEW elements for the same chapters (a repeater
      // re-rendered): the stamp moves to the current chapter's new element
      // without announcing it again.
      const current = state.index >= 0 ? state.records[state.index] : null
      if (current && current.element !== state.element) {
        stampChapter(current.element, state.index + 1, state.records.length)
      } else if (!current && state.index >= 0) {
        state.index = -1
        state.element = null
      }
    }
    const direction = p >= state.lastProgress ? 'down' : 'up'
    state.lastProgress = p
    if (state.moments.length === 0 || !state.onScreen) {
      return
    }
    const next = activeChapterIndex(state.moments, p)
    if (next === state.index) {
      return
    }
    const from = state.index
    state.index = next
    if (next === -1) {
      stampChapter(null, 0, 0)
      return
    }
    const passed = []
    if (from < next) {
      for (let index = from + 1; index <= next; index++) {
        passed.push(index)
      }
    } else {
      for (let index = from - 1; index >= next; index--) {
        passed.push(index)
      }
    }
    stampChapter(state.records[next].element, next + 1, state.records.length)
    state.pending = { passed, progress: p, direction }
    Promise.resolve().then(() => {
      const batch = chapterStateRef.current.pending
      if (!batch) {
        return
      }
      chapterStateRef.current.pending = null
      const records = chapterStateRef.current.records || []
      for (const index of batch.passed) {
        const record = records[index]
        if (!record) {
          continue
        }
        record.element.dispatchEvent(
          new CustomEvent(CHAPTER_REACHED_EVENT, {
            bubbles: true,
            detail: {
              chapterIndex: index + 1,
              chapterCount: records.length,
              progress: batch.progress,
              direction: batch.direction,
            },
          })
        )
      }
    })
  }

  const stampChapter = (element, chapterIndex, chapterCount) => {
    const state = chapterStateRef.current
    if (state.element && state.element !== element) {
      state.element.removeAttribute(CHAPTER_ACTIVE_ATTR)
      state.element.removeAttribute(CHAPTER_COUNT_ATTR)
    }
    state.element = element
    if (element) {
      element.setAttribute(CHAPTER_ACTIVE_ATTR, String(chapterIndex))
      element.setAttribute(CHAPTER_COUNT_ATTR, String(chapterCount))
    }
  }`

/** Body of `restack`: every real grid item of a chapters stage goes into the same cell. */
export const restackBodySource =
  (): string => `    if (layout !== 'chapters' || !trackRef.current) {
      return
    }
    const stage = trackRef.current.querySelector(':scope > [data-scene-stage]')
    if (!stage) {
      return
    }
    const place = (el) => {
      // Duck-typed, never instanceof — mirrors the editor runtime, where
      // canvas elements belong to another realm and instanceof always fails.
      if (!el || el.nodeType !== 1 || el.tagName === 'STYLE') {
        return
      }
      if (!el.style || typeof el.style.removeProperty !== 'function') {
        return
      }
      let display = ''
      try {
        display = getComputedStyle(el).display
      } catch (e) {
        // detached node — skip
      }
      if (display === 'contents') {
        // A pre-upgrade pass may have pinned this wrapper as a box — clean up.
        if (el.style.gridArea) {
          el.style.removeProperty('grid-area')
        }
        if (el.shadowRoot) {
          Array.from(el.shadowRoot.children).forEach(place)
          return
        }
        if (typeof el.assignedElements === 'function') {
          const assigned = el.assignedElements({ flatten: true })
          ;(assigned.length > 0 ? assigned : Array.from(el.children)).forEach(place)
          return
        }
        Array.from(el.children).forEach(place)
        return
      }
      const tag = el.tagName.toLowerCase()
      if (
        tag.includes('-') &&
        typeof customElements !== 'undefined' &&
        !customElements.get(tag) &&
        !awaitedTagsRef.current.has(tag)
      ) {
        awaitedTagsRef.current.add(tag)
        customElements
          .whenDefined(tag)
          .then(() => restackRef.current && restackRef.current())
          .catch(() => undefined)
      }
      el.style.gridArea = '1 / 1'
    }
    Array.from(stage.children).forEach(place)`

/** Chapter geometry: where a chapter is on stage, which children are chapters, how to scroll there. */
export const chapterHelpersSource = (): string => `  if (chapterHelpersRef.current === null) {
    const chapterProgress = (chapterRoot) => {
      // 1. The author's own snap point ("Snap here" on the timeline) wins.
      const override = parseFloat(chapterRoot.getAttribute('data-chapter-moment') || '')
      if (Number.isFinite(override)) {
        return Math.min(1, Math.max(0, override))
      }
      // 2. The settled moment — everything arrived, nothing leaving — read
      //    from the root's and every descendant's lanes.
      const boundLanes = []
      const boundElements = [chapterRoot].concat(
        Array.from(chapterRoot.querySelectorAll('[' + SCROLL_BIND_ATTR + ']'))
      )
      for (const element of boundElements) {
        const lanes = parseScrollBind(element.getAttribute(SCROLL_BIND_ATTR))
        for (const lane of lanes) {
          boundLanes.push(lane)
        }
      }
      const settled = settledMomentForLanes(boundLanes)
      if (settled !== null) {
        return settled
      }
      // 3. Through-motion only (a crossing line): the window's middle.
      const recorded = String(chapterRoot.getAttribute('data-chapter-window') || '')
        .split(',')
        .map((part) => parseFloat(part))
      if (recorded.length === 2 && recorded.every((value) => Number.isFinite(value))) {
        return (recorded[0] + recorded[1]) / 2
      }
      const lanes = parseScrollBind(chapterRoot.getAttribute(SCROLL_BIND_ATTR))
      const stops = lanes.flatMap((lane) => lane.at)
      if (stops.length === 0) {
        return null
      }
      return (Math.min.apply(null, stops) + Math.max.apply(null, stops)) / 2
    }
    chapterHelpersRef.current = {
      stageOf: (track) => track.querySelector(':scope > [data-scene-stage]'),
      chapterProgress,
      // The chapters: the stage's children when the scene pins, the track's own
      // children when it does not. Never the style tag, never a backdrop: the
      // background video, a bare media child (img / video / picture) or any
      // child marked data-scene-backdrop is the scene's background — it sits
      // under the chapters and owns no story window.
      chapterElements: (track) => {
        const stage = chapterHelpersRef.current.stageOf(track)
        const host = stage || track
        return Array.from(host.children).filter(
          (child) =>
            !!child.getAttribute &&
            child.tagName !== 'STYLE' &&
            child.tagName !== 'IMG' &&
            child.tagName !== 'VIDEO' &&
            child.tagName !== 'PICTURE' &&
            !child.hasAttribute('data-scroll-video') &&
            !child.hasAttribute('data-scene-backdrop') &&
            !child.hasAttribute('data-scene-stage')
        )
      },
      chapterMoments: (track) => {
        const moments = []
        for (const child of chapterHelpersRef.current.chapterElements(track)) {
          const progress = chapterProgress(child)
          if (progress !== null) {
            moments.push(Math.min(1, Math.max(0, progress)))
          }
        }
        return moments.sort((a, b) => a - b)
      },
      scrollToProgress: (track, progress, behavior) => {
        const rect = track.getBoundingClientRect()
        const trackTop = rect.top + window.scrollY
        const travel = Math.max(0, track.offsetHeight - window.innerHeight)
        window.scrollTo({
          top: trackTop + Math.min(1, Math.max(0, progress)) * travel,
          behavior,
        })
      },
    }
  }`

/** Body of the anchor-navigation effect: a hash that points into a pinned scene scrolls to that chapter. */
export const anchorNavigationBodySource = (): string => `    const track = trackRef.current
    if (!track || !pin || typeof window === 'undefined') {
      return undefined
    }
    const helpers = chapterHelpersRef.current
    const chapterRootFor = (target) => {
      const stage = helpers.stageOf(track)
      if (!stage || !stage.contains(target)) {
        return null
      }
      let current = target
      while (current && current.parentElement !== stage) {
        current = current.parentElement
      }
      return current
    }
    const scrollToChapter = (id, behavior) => {
      const target = id ? document.getElementById(id) : null
      const chapterRoot = target ? chapterRootFor(target) : null
      if (!chapterRoot) {
        return false
      }
      const progress = helpers.chapterProgress(chapterRoot)
      if (progress === null) {
        return false
      }
      helpers.scrollToProgress(track, progress, behavior)
      return true
    }
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null
      if (!anchor) {
        return
      }
      const href = anchor.getAttribute('href') || ''
      const hashIndex = href.indexOf('#')
      if (hashIndex === -1) {
        return
      }
      const beforeHash = href.slice(0, hashIndex)
      if (beforeHash && beforeHash !== window.location.pathname) {
        return
      }
      const id = decodeURIComponent(href.slice(hashIndex + 1))
      if (scrollToChapter(id, 'smooth')) {
        event.preventDefault()
        try {
          window.history.pushState(null, '', '#' + id)
        } catch (e) {
          // history can refuse in sandboxed frames; the scroll already happened
        }
      }
    }
    const onHashChange = () => {
      scrollToChapter(decodeURIComponent(window.location.hash.slice(1)), 'smooth')
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('hashchange', onHashChange)
    let settleTimer = 0
    const initialId = decodeURIComponent(window.location.hash.slice(1))
    if (initialId) {
      window.requestAnimationFrame(() => scrollToChapter(initialId, 'auto'))
      // late images/fonts shift the track's document position — one correction
      settleTimer = window.setTimeout(() => scrollToChapter(initialId, 'auto'), 350)
    }
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('hashchange', onHashChange)
      window.clearTimeout(settleTimer)
    }`

/** Body of the gentle chapter-snap effect: a visitor who pauses mid-scene settles on the nearest chapter. */
export const gentleSnapBodySource = (): string => `    const track = trackRef.current
    if (!track || !pin || chapterSnap !== 'gentle' || typeof window === 'undefined') {
      return undefined
    }
    if (shouldReduceMotion) {
      return undefined
    }
    const helpers = chapterHelpersRef.current
    let settleTimer = 0
    let suppressUntil = 0
    let lastProgress = progressRef.current
    let direction = 0
    const settle = () => {
      if (Date.now() < suppressUntil) {
        return
      }
      const progress = progressRef.current
      if (progress <= 0.001 || progress >= 0.999) {
        return
      }
      const moments = helpers.chapterMoments(track)
      if (moments.length === 0) {
        return
      }
      // Settle in the direction the visitor was travelling: a short scroll
      // forward lands on the next chapter, never back on the one just left.
      const ahead = moments.filter((moment) =>
        direction > 0 ? moment >= progress - 0.02 : direction < 0 ? moment <= progress + 0.02 : true
      )
      const candidates = ahead.length > 0 ? ahead : moments
      let nearest = candidates[0]
      for (const moment of candidates) {
        if (Math.abs(moment - progress) < Math.abs(nearest - progress)) {
          nearest = moment
        }
      }
      if (Math.abs(nearest - progress) < 0.005) {
        return
      }
      suppressUntil = Date.now() + 900
      helpers.scrollToProgress(track, nearest, 'smooth')
    }
    const onScroll = () => {
      window.clearTimeout(settleTimer)
      const progress = progressRef.current
      if (progress !== lastProgress) {
        direction = progress > lastProgress ? 1 : -1
        lastProgress = progress
      }
      if (Date.now() < suppressUntil) {
        return
      }
      settleTimer = window.setTimeout(settle, 180)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(settleTimer)
    }`
