// jest 26's node sandbox exposes none of the browser globals the upload
// handlers use — no `fetch`, no `FormData`, no `Blob`, no `atob` and no
// `AbortController`. The first four have always been stubbed by the tests that
// need them; this is the fifth, added when `file-storage-upload` grew a timeout.
//
// It is a TEST-ONLY absence: `AbortController` has been available in every
// browser since 2017 and in Node since 14, which is why the generated handler
// uses it unguarded.

type AbortListener = () => void

class AbortSignalStub {
  public aborted = false
  public reason: unknown = undefined
  private listeners: AbortListener[] = []

  public addEventListener(type: string, listener: AbortListener): void {
    if (type === 'abort') {
      this.listeners.push(listener)
    }
  }

  public removeEventListener(type: string, listener: AbortListener): void {
    if (type === 'abort') {
      this.listeners = this.listeners.filter((entry) => entry !== listener)
    }
  }

  /** @internal — driven by the controller, never by the code under test. */
  public dispatchAbort(reason: unknown): void {
    if (this.aborted) {
      return
    }
    this.aborted = true
    this.reason = reason
    for (const listener of this.listeners.slice()) {
      listener()
    }
  }
}

export class AbortControllerStub {
  public readonly signal = new AbortSignalStub()

  public abort(reason?: unknown): void {
    this.signal.dispatchAbort(reason)
  }
}

/** The browser globals the file-storage upload handler expects to exist. */
export const installUploadGlobals = (overrides: Record<string, unknown> = {}): void => {
  const globals = globalThis as Record<string, unknown>
  globals.AbortController = AbortControllerStub
  for (const [name, value] of Object.entries(overrides)) {
    globals[name] = value
  }
}

export const removeUploadGlobals = (names: string[]): void => {
  const globals = globalThis as Record<string, unknown>
  for (const name of ['AbortController', ...names]) {
    delete globals[name]
  }
}
