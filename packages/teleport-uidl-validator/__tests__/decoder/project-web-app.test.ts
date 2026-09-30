import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a top-level field it does not name is dropped,
 * and the generator only ever sees the decoded UIDL. The installable app and
 * Web Push reach NextPwaProjectPlugin / NextWebPushProjectPlugin only through
 * these two entries.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    unknown
  >

const INSTALLABLE_APP = {
  installable: true,
  name: 'Northwind Coffee',
  shortName: 'Northwind',
  description: 'Fresh roasts, delivered.',
  themeColor: '#0f766e',
  backgroundColor: '#ffffff',
  installBanner: true,
  cacheContent: true,
  networkOnlyPaths: ['/checkout', '/orders/*'],
  icons: { any192: 'AAA', any512: 'BBB', maskable512: 'CCC', appleTouch180: 'DDD' },
  screenshots: [
    {
      src: 'https://cdn.example.com/phone.jpg',
      width: 780,
      height: 1688,
      type: 'image/jpeg',
      formFactor: 'narrow',
    },
    {
      src: 'https://cdn.example.com/computer.jpg',
      width: 1280,
      height: 800,
      type: 'image/jpeg',
      formFactor: 'wide',
    },
  ],
}

describe('project decoder — installable app and Web Push', () => {
  it('keeps an installable app with every field', () => {
    expect(decode({ pwa: INSTALLABLE_APP }).pwa).toEqual(INSTALLABLE_APP)
  })

  it('keeps an installable app without icons, screenshots or description', () => {
    const withoutOptional: Record<string, unknown> = { ...INSTALLABLE_APP }
    delete withoutOptional.icons
    delete withoutOptional.screenshots
    delete withoutOptional.description
    expect(decode({ pwa: withoutOptional }).pwa).toEqual(withoutOptional)
  })

  it('rejects a screenshot for a form factor browsers do not know', () => {
    const screenshots = [{ ...INSTALLABLE_APP.screenshots[1], formFactor: 'tablet' }]
    expect(() => decode({ pwa: { ...INSTALLABLE_APP, screenshots } })).toThrow()
  })

  it('keeps a request to retire the worker', () => {
    expect(decode({ pwa: { installable: false } }).pwa).toEqual({ installable: false })
  })

  it('rejects an installable app missing a required field', () => {
    const incomplete: Record<string, unknown> = { ...INSTALLABLE_APP }
    delete incomplete.themeColor
    expect(() => decode({ pwa: incomplete })).toThrow()
  })

  it('keeps the Web Push public key', () => {
    expect(decode({ webPush: { vapidPublicKey: 'BPublicKey' } }).webPush).toEqual({
      vapidPublicKey: 'BPublicKey',
    })
  })

  it('leaves a project without either untouched', () => {
    const decoded = decode({})
    expect(decoded.pwa).toBeUndefined()
    expect(decoded.webPush).toBeUndefined()
  })
})
