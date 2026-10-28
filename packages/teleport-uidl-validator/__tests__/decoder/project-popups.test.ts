import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a top-level field it does not name is dropped,
 * and the generator only ever sees the decoded UIDL. The popups' runtime is
 * emitted only when this entry reaches the generator whole.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    unknown
  >

const POPUP = {
  id: 'popup-1',
  componentName: 'Welcome-Popup',
  purpose: 'discount',
  layout: 'corner',
  trigger: { desktop: 'exit-intent', phone: 'scroll', delaySeconds: 20, scrollPercent: 50 },
  frequency: { kind: 'days', days: 7 },
  pages: { mode: 'except', paths: ['/about', '/fr/about'] },
  audience: 'new',
  voucherCode: 'WELCOME10',
}

const CONFIG = { popups: [POPUP], excludedPaths: ['/cart', '/orders/*'] }

describe('project decoder — popups', () => {
  it('keeps every field of the popup config', () => {
    expect(decode({ popups: CONFIG }).popups).toEqual(CONFIG)
  })

  it('drops keys the schema does not name', () => {
    expect(
      decode({ popups: { ...CONFIG, popups: [{ ...POPUP, targetId: 'product:1' }], extra: true } })
        .popups
    ).toEqual(CONFIG)
  })

  it('rejects a popup with a value the runtime does not know', () => {
    expect(() =>
      decode({ popups: { ...CONFIG, popups: [{ ...POPUP, layout: 'side' }] } })
    ).toThrow()
    expect(() => decode({ popups: { popups: [POPUP] } })).toThrow()
  })

  it('leaves a project without popups untouched', () => {
    expect(decode({}).popups).toBeUndefined()
  })
})
