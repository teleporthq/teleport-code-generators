import {
  browserKey,
  callRoute,
  createRouteCaller,
  fakeClock,
  fakeDatabase,
  fakeFetch,
  fakeWebPush,
  loadPushServer,
  PRIVATE_KEY,
  PUBLIC_KEY,
  pushEnv,
  sendToken,
  vapidKeyPair,
} from './_helpers/load-push-server'

const P256DH = browserKey()
const AUTH = Buffer.alloc(16, 3).toString('base64url')
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'
const USER_ID = '2f8a9d1e-4b6c-4a3f-9e21-7c5d8b0a1f34'
const KEYS_MISMATCH = /do not belong together/

const subscription = (overrides: Record<string, unknown> = {}) => ({
  endpoint: ENDPOINT,
  expirationTime: null as number | null,
  keys: { p256dh: P256DH, auth: AUTH },
  ...overrides,
})

const rows = (count: number, prefix = 'row') =>
  Array.from({ length: count }, (_value, index) => ({
    id: `${prefix}-${String(index).padStart(4, '0')}`,
    endpoint: `https://fcm.googleapis.com/fcm/send/${prefix}-${index}`,
    p256dh: P256DH,
    auth: AUTH,
  }))

describe('push subscription validation', () => {
  const server = loadPushServer(pushEnv(), fakeDatabase(), fakeWebPush())

  it('accepts a subscription from every browser push service', () => {
    ;[
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGuQyavXutnMei',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ].forEach((endpoint) => {
      expect(server.normalizeSubscription(subscription({ endpoint }))).toEqual({
        endpoint,
        p256dh: P256DH,
        auth: AUTH,
      })
    })
  })

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an internal address', 'https://169.254.169.254/latest/meta-data'],
    ['a look-alike host', 'https://fcm.googleapis.com.evil.test/send'],
    ['a host that only ends like a push service', 'https://evilpush.apple.com/x'],
    ['credentials in the URL', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['a custom port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
  ])('refuses an endpoint with %s — the server would POST to it', (_label, endpoint) => {
    expect(server.normalizeSubscription(subscription({ endpoint }))).toBeNull()
  })

  it('refuses keys that are not a P-256 point and a 16-byte secret', () => {
    const short = Buffer.alloc(10).toString('base64url')
    expect(
      server.normalizeSubscription(subscription({ keys: { p256dh: short, auth: AUTH } }))
    ).toBeNull()
    expect(
      server.normalizeSubscription(subscription({ keys: { p256dh: P256DH, auth: short } }))
    ).toBeNull()
    const compressed = Buffer.concat([Buffer.from([2]), Buffer.alloc(64)]).toString('base64url')
    expect(
      server.normalizeSubscription(subscription({ keys: { p256dh: compressed, auth: AUTH } }))
    ).toBeNull()
    expect(server.normalizeSubscription(null)).toBeNull()
  })

  it('refuses a key of the right length that is not on the curve — no notification could ever be encrypted for it', () => {
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url')
    expect(
      server.normalizeSubscription(subscription({ keys: { p256dh: offCurve, auth: AUTH } }))
    ).toBeNull()
  })

  it('takes the id of every sign-in — a users-table UUID or a provider id — within a sane length', () => {
    expect(server.normalizeUserId(USER_ID)).toBe(USER_ID)
    expect(server.normalizeUserId(' 109876543210987654321 ')).toBe('109876543210987654321')
    expect(server.normalizeUserId(42)).toBe('42')
    expect(server.normalizeUserId('')).toBeNull()
    expect(server.normalizeUserId('x'.repeat(256))).toBeNull()
    expect(server.normalizeUserId({ id: 1 })).toBeNull()
  })

  it('works only with both keys, a database, and a private key that belongs to the public one', () => {
    expect(loadPushServer(pushEnv(), fakeDatabase(), fakeWebPush()).configurationProblem()).toBe('')
    ;[
      pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: '' }),
      pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: 'teleporthq.secrets.WEB_PUSH_VAPID_PRIVATE_KEY' }),
      pushEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: '' }),
      pushEnv({ TELEPORT_DB_CONNECTION_STRING: '' }),
    ].forEach((env) => {
      expect(loadPushServer(env, fakeDatabase(), fakeWebPush()).configurationProblem()).toBe(
        'Push notifications are not set up for this site.'
      )
    })
    ;[
      pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: vapidKeyPair().privateKey }),
      pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: 'not-a-key' }),
      pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----' }),
    ].forEach((env) => {
      expect(loadPushServer(env, fakeDatabase(), fakeWebPush()).configurationProblem()).toMatch(
        KEYS_MISMATCH
      )
    })
  })

  it('knows the key the pages were built with', () => {
    expect(server.isCurrentKey(PUBLIC_KEY)).toBe(true)
    expect(server.isCurrentKey(vapidKeyPair().publicKey)).toBe(false)
    expect(server.isCurrentKey(undefined)).toBe(false)
  })

  it('accepts only the token derived from the private key', () => {
    expect(server.verifySendToken(sendToken())).toBe(true)
    expect(server.verifySendToken(sendToken('another-key'))).toBe(false)
    expect(server.verifySendToken(undefined)).toBe(false)
    expect(server.verifySendToken('short')).toBe(false)
  })
})

describe('push subscription store', () => {
  it('upserts by endpoint for the browser holding its secret, links the signed-in user, and drops the replaced one', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    const stored = server.normalizeSubscription(subscription())

    expect(
      await server.saveSubscription(stored, {
        userId: '109876543210987654321',
        previousEndpoint: 'https://fcm.googleapis.com/fcm/send/old',
        previousAuth: 'old-secret',
      })
    ).toBe(true)

    expect(database.queries[0].text).toContain('ON CONFLICT (endpoint) DO UPDATE')
    expect(database.queries[0].text).toContain(
      'WHERE teleport_push_subscriptions.auth = EXCLUDED.auth'
    )
    expect(database.queries[0].params).toEqual([
      ENDPOINT,
      P256DH,
      AUTH,
      PUBLIC_KEY,
      '109876543210987654321',
    ])
    expect(database.queries[1]).toEqual({
      text: 'DELETE FROM teleport_push_subscriptions WHERE endpoint = $1 AND auth = $2',
      params: ['https://fcm.googleapis.com/fcm/send/old', 'old-secret'],
    })
  })

  it('changes nothing for a request that knows an endpoint but not its secret', async () => {
    const database = fakeDatabase({ upsertRowCount: 0 })
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    const saved = await server.saveSubscription(server.normalizeSubscription(subscription()), {
      userId: null,
      previousEndpoint: 'https://fcm.googleapis.com/fcm/send/old',
      previousAuth: 'old-secret',
    })
    expect(saved).toBe(false)
    expect(database.queries).toHaveLength(1)
  })

  it('never deletes a replaced endpoint without its secret, nor an arbitrary URL', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    await server.saveSubscription(server.normalizeSubscription(subscription()), {
      userId: null,
      previousEndpoint: 'https://fcm.googleapis.com/fcm/send/old',
    })
    await server.saveSubscription(server.normalizeSubscription(subscription()), {
      userId: null,
      previousEndpoint: 'https://example.com/not-a-push-service',
      previousAuth: 'secret',
    })
    expect(database.queries.filter((query) => query.text.startsWith('DELETE'))).toEqual([])
    expect(database.queries[0].params[4]).toBeNull()
  })

  it('deletes a stored subscription only with its endpoint and secret', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    expect(await server.deleteSubscription(ENDPOINT, AUTH)).toBe(true)
    expect(await server.deleteSubscription(ENDPOINT, undefined)).toBe(false)
    expect(await server.deleteSubscription('javascript:alert(1)', AUTH)).toBe(false)
    expect(database.queries).toEqual([
      {
        text: 'DELETE FROM teleport_push_subscriptions WHERE endpoint = $1 AND auth = $2',
        params: [ENDPOINT, AUTH],
      },
    ])
  })
})

describe('push sender', () => {
  it('sends to every subscription made with the current key and removes the ones that are gone', async () => {
    const database = fakeDatabase({ selectPages: [rows(3)], deleteRowCount: 2 })
    const webPush = fakeWebPush({
      'https://fcm.googleapis.com/fcm/send/row-1': 410,
      'https://fcm.googleapis.com/fcm/send/row-2': 404,
    })
    const server = loadPushServer(pushEnv(), database, webPush)

    const result = await server.sendNotification(
      { notification: { title: 'Order shipped', body: 'On its way', url: '/orders/1' } },
      'https://shop.test'
    )

    expect(result).toEqual({ success: true, sent: 1, failed: 2, removed: 2, complete: true })
    expect(database.queries[0].text).toBe(
      'SELECT id, endpoint, p256dh, auth FROM teleport_push_subscriptions WHERE vapid_public_key = $1 ORDER BY id LIMIT 500'
    )
    expect(database.queries[0].params).toEqual([PUBLIC_KEY])
    expect(database.queries[1]).toEqual({
      text: 'DELETE FROM teleport_push_subscriptions WHERE endpoint = ANY($1)',
      params: [
        ['https://fcm.googleapis.com/fcm/send/row-1', 'https://fcm.googleapis.com/fcm/send/row-2'],
      ],
    })
    expect(JSON.parse(webPush.sends[0].payload)).toEqual({
      title: 'Order shipped',
      body: 'On its way',
      url: '/orders/1',
    })
    expect(webPush.sends[0].options).toEqual({
      TTL: 86400,
      urgency: 'normal',
      timeout: 3000,
      vapidDetails: {
        subject: 'https://shop.test',
        publicKey: PUBLIC_KEY,
        privateKey: PRIVATE_KEY,
      },
    })
  })

  it('keeps a subscription the push service refused for any other reason', async () => {
    const database = fakeDatabase({ selectPages: [rows(1)] })
    const webPush = fakeWebPush({ 'https://fcm.googleapis.com/fcm/send/row-0': 403 })
    const server = loadPushServer(pushEnv(), database, webPush)
    const result = await server.sendNotification(
      { notification: { title: 'Hi' } },
      'https://shop.test'
    )
    expect(result).toEqual({ success: true, sent: 0, failed: 1, removed: 0, complete: true })
    expect(database.queries.some((query) => query.text.startsWith('DELETE'))).toBe(false)
  })

  it('pages through a large audience', async () => {
    const database = fakeDatabase({ selectPages: [rows(500, 'a'), rows(2, 'b')] })
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    const result = await server.sendNotification(
      { notification: { title: 'Hi' } },
      'https://shop.test'
    )

    expect(result).toMatchObject({ sent: 502, complete: true })
    expect(result).not.toHaveProperty('cursor')
    expect(database.queries[1].text).toContain('AND id > $2')
    expect(database.queries[1].params).toEqual([PUBLIC_KEY, 'a-0499'])
  })

  it('stops starting sends when its time is up, and says where to resume', async () => {
    // Every send takes a second of the five the call may spend.
    const database = fakeDatabase({ selectPages: [rows(20)] })
    const webPush = fakeWebPush()
    const server = loadPushServer(pushEnv(), database, webPush, fakeClock(1000))

    const result = await server.sendNotification({ notification: { title: 'Sale' } }, 'x')

    expect(result.complete).toBe(false)
    expect(result.sent).toBeLessThan(20)
    expect(result.cursor).toBe(`row-${String((result.sent as number) - 1).padStart(4, '0')}`)
    expect(webPush.sends).toHaveLength(result.sent as number)
  })

  it('resumes after the last subscription an earlier call reached', async () => {
    const database = fakeDatabase({ selectPages: [rows(2, 'c')] })
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    await server.sendNotification({ after: 'b-0007', notification: { title: 'Sale' } }, 'x')
    expect(database.queries[0].text).toContain('AND id > $2')
    expect(database.queries[0].params).toEqual([PUBLIC_KEY, 'b-0007'])
  })

  it('narrows the audience to one user — whatever sign-in they used — or one browser', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())

    await server.sendNotification(
      { audience: 'user', userId: USER_ID, notification: { title: 'Hi' } },
      'x'
    )
    await server.sendNotification(
      { audience: 'user', userId: 109876, notification: { title: 'Hi' } },
      'x'
    )
    await server.sendNotification(
      { audience: 'subscription', endpoint: ENDPOINT, notification: { title: 'Hi' } },
      'x'
    )

    expect(database.queries[0].text).toContain('AND user_id = $2')
    expect(database.queries[0].params).toEqual([PUBLIC_KEY, USER_ID])
    expect(database.queries[1].params).toEqual([PUBLIC_KEY, '109876'])
    expect(database.queries[2].text).toContain('AND endpoint = $2')
    expect(database.queries[2].params).toEqual([PUBLIC_KEY, ENDPOINT])
  })

  it('refuses a notification without a title, or an audience it cannot resolve', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    expect(await server.sendNotification({ notification: { body: 'x' } }, 'x')).toEqual({
      success: false,
      error: 'A push notification needs a title.',
    })
    const refused = [
      { audience: 'user', userId: '  ' },
      { audience: 'subscription', endpoint: 'http://10.0.0.1/' },
      { audience: 'users', userId: USER_ID },
      { audience: 'User', userId: USER_ID },
    ]
    for (const request of refused) {
      expect(
        (await server.sendNotification({ ...request, notification: { title: 'Hi' } }, 'x')).success
      ).toBe(false)
    }
    expect(database.queries).toEqual([])
  })

  it('sends a number bound to a text field as text', async () => {
    const webPush = fakeWebPush()
    const server = loadPushServer(pushEnv(), fakeDatabase({ selectPages: [rows(1)] }), webPush)
    await server.sendNotification({ notification: { title: 1234, body: 5, tag: 7 } }, 'x')
    expect(JSON.parse(webPush.sends[0].payload)).toEqual({ title: '1234', body: '5', tag: '7' })
  })

  it('fits the notification into what a push service accepts: the image goes, then the text is shortened', async () => {
    const webPush = fakeWebPush()
    const server = loadPushServer(pushEnv(), fakeDatabase({ selectPages: [rows(1)] }), webPush)
    const longUrl = `https://images.example.com/${'a'.repeat(2000)}`

    await server.sendNotification(
      {
        notification: {
          title: '発送しました'.repeat(30),
          body: 'お届けまでしばらくお待ちください。'.repeat(60),
          url: `/orders/${'1'.repeat(1500)}`,
          image: longUrl,
          icon: longUrl,
        },
      },
      'x'
    )

    const payload = webPush.sends[0].payload
    const sent = JSON.parse(payload)
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(3993)
    expect(sent).not.toHaveProperty('image')
    expect(sent).not.toHaveProperty('icon')
    expect(sent.body.endsWith('…')).toBe(true)
    expect(sent.title).toBe('発送しました'.repeat(30))
  })

  it('refuses a notification whose title and link alone are too long to send', async () => {
    const database = fakeDatabase()
    const server = loadPushServer(pushEnv(), database, fakeWebPush())
    const result = await server.sendNotification(
      { notification: { title: 'Hi', url: `/${'製品'.repeat(1000)}` } },
      'x'
    )
    expect(result).toMatchObject({ success: false })
    expect(result.error).toContain('too long')
    expect(database.queries).toEqual([])
  })

  it('honours a zero time-to-live and ignores an unknown urgency', async () => {
    const webPush = fakeWebPush()
    const server = loadPushServer(pushEnv(), fakeDatabase({ selectPages: [rows(1)] }), webPush)
    await server.sendNotification(
      { ttl: '0', urgency: 'critical', notification: { title: 'Now or never' } },
      'https://shop.test'
    )
    expect(webPush.sends[0].options).toMatchObject({ TTL: 0, urgency: 'normal' })
  })
})

describe('/api/push/subscriptions', () => {
  const saveRequest = (
    headers: Record<string, string> = {},
    body: Record<string, unknown> = {}
  ) => ({
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', ...headers },
    body: { subscription: subscription(), applicationServerKey: PUBLIC_KEY, ...body },
  })

  it('saves a valid subscription and links it to the signed-in user from the session', async () => {
    const database = fakeDatabase()
    const response = await callRoute('subscriptions', saveRequest(), {
      env: pushEnv({ NEXTAUTH_SECRET: 'secret' }),
      database,
      session: { id: USER_ID },
    })
    expect(response).toMatchObject({ statusCode: 200, body: { saved: true } })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(database.queries[0].params[4]).toBe(USER_ID)
  })

  it('links a visitor who signed in with Google by the id the session carries', async () => {
    const database = fakeDatabase()
    await callRoute('subscriptions', saveRequest(), {
      env: pushEnv({ NEXTAUTH_SECRET: 'secret' }),
      database,
      session: { id: '109876543210987654321', email: 'ana@example.com' },
    })
    expect(database.queries[0].params[4]).toBe('109876543210987654321')
  })

  it('refuses a cross-site request — another site cannot link its device to a visitor', async () => {
    expect(
      (await callRoute('subscriptions', saveRequest({ 'sec-fetch-site': 'cross-site' }))).statusCode
    ).toBe(403)
    const withOrigin = await callRoute('subscriptions', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
      body: { subscription: subscription(), applicationServerKey: PUBLIC_KEY },
    })
    expect(withOrigin.statusCode).toBe(403)
  })

  it('refuses an invalid subscription and any other method', async () => {
    const invalid = await callRoute(
      'subscriptions',
      saveRequest({}, { subscription: subscription({ endpoint: 'https://127.0.0.1/' }) })
    )
    expect(invalid.statusCode).toBe(400)

    const get = await callRoute('subscriptions', { method: 'GET' })
    expect(get.statusCode).toBe(405)
    expect(get.headers.allow).toBe('POST, DELETE')
  })

  it('refuses a subscription made with keys that have since been replaced', async () => {
    const database = fakeDatabase()
    const stale = await callRoute(
      'subscriptions',
      saveRequest({}, { applicationServerKey: vapidKeyPair().publicKey }),
      { database }
    )
    expect(stale.statusCode).toBe(409)
    expect((stale.body as { error: string }).error).toContain('Reload the page')
    expect(
      (await callRoute('subscriptions', saveRequest({}, { applicationServerKey: undefined })))
        .statusCode
    ).toBe(409)
    expect(database.queries).toEqual([])
  })

  it('refuses to relink a subscription stored with another secret', async () => {
    const response = await callRoute('subscriptions', saveRequest(), {
      database: fakeDatabase({ upsertRowCount: 0 }),
    })
    expect(response.statusCode).toBe(409)
  })

  it('answers 503 when push is not set up or the keys do not match, and names the missing table', async () => {
    expect(
      (
        await callRoute('subscriptions', saveRequest(), {
          env: pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: '' }),
        })
      ).statusCode
    ).toBe(503)
    const mismatched = await callRoute('subscriptions', saveRequest(), {
      env: pushEnv({ WEB_PUSH_VAPID_PRIVATE_KEY: vapidKeyPair().privateKey }),
    })
    expect(mismatched.statusCode).toBe(503)
    expect((mismatched.body as { error: string }).error).toMatch(KEYS_MISMATCH)
    const missingTable = await callRoute('subscriptions', saveRequest(), {
      database: fakeDatabase({ failWith: { code: '42P01', message: 'relation does not exist' } }),
    })
    expect(missingTable.statusCode).toBe(503)
    expect((missingTable.body as { error: string }).error).toContain('Set up push notifications')
  })

  it('forgets a subscription on DELETE for the browser holding its secret', async () => {
    const response = await callRoute('subscriptions', {
      method: 'DELETE',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: { endpoint: ENDPOINT, auth: AUTH },
    })
    expect(response).toMatchObject({ statusCode: 200, body: { deleted: true } })
  })

  it('stops one client from filling the table', async () => {
    const save = createRouteCaller('subscriptions')
    const request = saveRequest({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await save(request)).statusCode).toBe(200)
    }
    const limited = await save(request)
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBe('600')
    expect((await save(saveRequest({ 'x-forwarded-for': '198.51.100.4' }))).statusCode).toBe(200)
  })
})

describe('/api/push/send', () => {
  const authorized = { 'x-teleport-push-token': sendToken() }

  it('sends only for a caller holding the token derived from the private key', async () => {
    const webPush = fakeWebPush()
    const request = { notification: { title: 'Sale' } }

    const refused = await callRoute('send', { method: 'POST', body: request })
    expect(refused.statusCode).toBe(401)

    const forged = await callRoute('send', {
      method: 'POST',
      headers: { 'x-teleport-push-token': sendToken('guessed') },
      body: request,
    })
    expect(forged.statusCode).toBe(401)

    const accepted = await callRoute(
      'send',
      { method: 'POST', headers: authorized, body: request },
      { webPush, database: fakeDatabase({ selectPages: [rows(1)] }) }
    )
    expect(accepted).toMatchObject({
      statusCode: 200,
      body: { success: true, sent: 1, complete: true },
    })
    expect(webPush.sends[0].options.vapidDetails).toMatchObject({ subject: 'https://shop.test' })
  })

  it('answers 400 for a request it cannot send', async () => {
    const response = await callRoute('send', {
      method: 'POST',
      headers: authorized,
      body: { notification: {} },
    })
    expect(response.statusCode).toBe(400)
  })

  it('says why it cannot send when the keys do not match', async () => {
    const response = await callRoute(
      'send',
      { method: 'POST', headers: authorized, body: { notification: { title: 'Sale' } } },
      { env: pushEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: vapidKeyPair().publicKey }) }
    )
    expect(response.statusCode).toBe(503)
    expect((response.body as { error: string }).error).toMatch(KEYS_MISMATCH)
  })

  it('hands the rest of a large audience to a new call of itself, which resumes where this one stopped', async () => {
    const fetch = fakeFetch()
    const response = await callRoute(
      'send',
      {
        method: 'POST',
        headers: { ...authorized, 'x-forwarded-proto': 'https' },
        body: { audience: 'all', notification: { title: 'Sale' } },
      },
      { database: fakeDatabase({ selectPages: [rows(20)] }), clock: fakeClock(1000), fetch }
    )

    expect(response.body).toMatchObject({ success: true, complete: false })
    expect(response.body).not.toHaveProperty('cursor')
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].url).toBe('https://shop.test/api/push/send')
    expect((fetch.calls[0].init.headers as Record<string, string>)['x-teleport-push-token']).toBe(
      sendToken()
    )
    const relayed = JSON.parse(fetch.calls[0].init.body as string)
    const sent = (response.body as { sent: number }).sent
    expect(relayed).toEqual({
      audience: 'all',
      notification: { title: 'Sale' },
      after: `row-${String(sent - 1).padStart(4, '0')}`,
      relay: 1,
    })
  })

  it('stops relaying after a hundred calls', async () => {
    const fetch = fakeFetch()
    await callRoute(
      'send',
      {
        method: 'POST',
        headers: authorized,
        body: { relay: 100, notification: { title: 'Sale' } },
      },
      { database: fakeDatabase({ selectPages: [rows(20)] }), clock: fakeClock(1000), fetch }
    )
    expect(fetch.calls).toEqual([])
  })

  it('relays nothing once everyone was reached', async () => {
    const fetch = fakeFetch()
    await callRoute(
      'send',
      { method: 'POST', headers: authorized, body: { notification: { title: 'Sale' } } },
      { database: fakeDatabase({ selectPages: [rows(3)] }), fetch }
    )
    expect(fetch.calls).toEqual([])
  })
})
