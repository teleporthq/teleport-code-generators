// Workflow node handlers are authored as ordinary Node functions and then
// serialized into the generated project via `fn.toString()`. In the GUI the
// code generators run inside a browser web-worker that webpack bundles, so a
// bare `require(...)` inside a handler is rewritten to `__webpack_require__(N)`
// — which does not exist on the Vercel Node runtime. `__non_webpack_require__`
// is webpack's escape hatch: webpack rewrites it back to the real runtime
// `require`, and in the plain tsc/dist build it is simply absent (handlers
// guard with `typeof __non_webpack_require__ !== 'undefined' ? ... : require`).
//
// Declared here so the handler sources type-check against it.
declare const __non_webpack_require__: (id: string) => any
