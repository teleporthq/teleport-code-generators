/**
 * Body custom code (the slider bundle, chat widgets, the editor's slider
 * patcher) used to be written into _document as live HTML after
 * <NextScript/>, so it ran at parse time — before React hydrated the page.
 * A widget that rewrites the DOM that early (Swiper adds classes and styles
 * to every slide) makes React report a hydration mismatch on each element it
 * touched. _document now ships that code inert inside a <template>, and the
 * TqBodyCode _app sibling unpacks it in an effect, which runs only after the
 * hydration commit. <noscript> blocks stay live in the document: they exist
 * for visitors without JavaScript, who could never unpack a template.
 * NO backticks in this file's comments — the component code is a template literal.
 */
export const BODY_CODE_TEMPLATE_ATTR = 'data-tq-body-code'

const NOSCRIPT_BLOCK = /<noscript\b[\s\S]*?<\/noscript>/gi

export const splitBodyCustomCode = (body: string): { noscript: string; deferred: string } => {
  const noscript = (body.match(NOSCRIPT_BLOCK) ?? []).join('\n')
  const deferred = body.replace(NOSCRIPT_BLOCK, '').trim()
  return { noscript, deferred }
}

/** The HTML _document writes for the body custom code: live noscript, inert everything else. */
export const wrapBodyCustomCode = (body: string): string => {
  const { noscript, deferred } = splitBodyCustomCode(body)
  const template = deferred ? `<template ${BODY_CODE_TEMPLATE_ATTR}>${deferred}</template>` : ''
  return `${noscript}${noscript && template ? '\n' : ''}${template}`
}

/**
 * The unpacking as plain script, so the same code is unit-tested against a
 * DOM and shipped inside the component. Scripts are recreated because a
 * cloned script never executes: external ones keep document order
 * (async=false), inline ones run at insertion — a helper placed before a
 * library still runs first, exactly as it did at parse time.
 *
 * An inline script names the document as its source. Chromium reports no file
 * for an error thrown by a script inserted after the page was parsed (or by a
 * callback it registered), and the inline script error guard of _document
 * (teleport-shared, inline-script-error-guard) knows the project's own scripts
 * by the document's address: unnamed, a custom script that throws would cover
 * the page with the dev server's error overlay again. Data blocks (JSON-LD,
 * templates) are not scripts and stay exactly as written.
 */
export const BODY_CODE_UNPACK_SCRIPT = `(function () {
  var template = document.querySelector('template[${BODY_CODE_TEMPLATE_ATTR}]')
  if (!template || !template.content) { return }
  var fragment = document.importNode(template.content, true)
  var scripts = Array.prototype.slice.call(fragment.querySelectorAll('script'))
  var namedAfterTheDocument = '\\n//# source' + 'URL=' + String(document.URL).split('#')[0]
  var runsAsScript = function (type) {
    return type === '' || type === 'module' || type.indexOf('javascript') !== -1 || type.indexOf('ecmascript') !== -1
  }
  scripts.forEach(function (old) {
    var script = document.createElement('script')
    Array.prototype.forEach.call(old.attributes, function (attr) {
      script.setAttribute(attr.name, attr.value)
    })
    script.async = false
    var inline = !old.getAttribute('src') && runsAsScript((old.getAttribute('type') || '').trim().toLowerCase())
    script.textContent = inline ? old.textContent + namedAfterTheDocument : old.textContent
    old.parentNode.replaceChild(script, old)
  })
  template.parentNode.replaceChild(fragment, template)
})()`

export const generateBodyCodeComponentCode = (): string => `import { useEffect } from 'react'

// Runs the project's body custom code after React has hydrated the page.
// _document ships it inert inside <template ${BODY_CODE_TEMPLATE_ATTR}>; running it at
// parse time let widget scripts (the slider bundle) rewrite the slides before
// hydration, and React reported every touched element as a mismatch.
export default function TqBodyCode() {
  useEffect(() => {
    ${BODY_CODE_UNPACK_SCRIPT}
  }, [])
  return null
}
`
