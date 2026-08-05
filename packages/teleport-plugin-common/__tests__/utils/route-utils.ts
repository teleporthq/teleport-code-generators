import {
  parseDynamicPathSegments,
  pathHasDynamicSegment,
  isDynamicRoute,
} from '../../src/utils/route-utils'

describe('parseDynamicPathSegments', () => {
  it('splits a Next.js bracket segment into static text plus a param name', () => {
    // The shape every details page's `navLink` actually carries. Before this
    // was understood, the literal text "[id]" shipped inside canonical URLs,
    // og:url and sitemap entries.
    expect(parseDynamicPathSegments('/event-details/[id]')).toEqual({
      staticParts: ['/event-details/', ''],
      paramNames: ['id'],
    })
  })

  it('still splits the template-literal form', () => {
    expect(parseDynamicPathSegments('/news/' + '$' + '{' + 'slug}')).toEqual({
      staticParts: ['/news/', ''],
      paramNames: ['slug'],
    })
  })

  it('handles a full absolute URL, keeping the origin in the static text', () => {
    expect(parseDynamicPathSegments('https://example.com/rsvp-event/[id]')).toEqual({
      staticParts: ['https://example.com/rsvp-event/', ''],
      paramNames: ['id'],
    })
  })

  it('splits several parameters and keeps the text between them', () => {
    expect(parseDynamicPathSegments('/g/[guildId]/e/[eventId]/rsvp')).toEqual({
      staticParts: ['/g/', '/e/', '/rsvp'],
      paramNames: ['guildId', 'eventId'],
    })
  })

  it('mixes both spellings in one path', () => {
    expect(parseDynamicPathSegments('/a/[id]/b/' + '$' + '{' + 'slug}')).toEqual({
      staticParts: ['/a/', '/b/', ''],
      paramNames: ['id', 'slug'],
    })
  })

  it('reports no parameters for a plain static path', () => {
    expect(parseDynamicPathSegments('https://example.com/add-guild')).toEqual({
      staticParts: ['https://example.com/add-guild'],
      paramNames: [],
    })
  })

  it('always returns exactly one more static part than parameters', () => {
    for (const path of ['/a', '/a/[id]', '/a/[id]/b/[other]', '/' + '$' + '{' + 'x}']) {
      const { staticParts, paramNames } = parseDynamicPathSegments(path)
      expect(staticParts.length).toBe(paramNames.length + 1)
    }
  })

  it('rebuilding staticParts + parameters reproduces the original path', () => {
    const path = '/g/[guildId]/e/[eventId]/rsvp'
    const { staticParts, paramNames } = parseDynamicPathSegments(path)
    const rebuilt = staticParts.reduce(
      (acc, part, i) => acc + part + (i < paramNames.length ? `[${paramNames[i]}]` : ''),
      ''
    )
    expect(rebuilt).toBe(path)
  })

  it('ignores a bracket that is not a whole path segment', () => {
    // A literal bracket inside a segment or a query string is content, not a
    // route parameter — turning it into router.query would corrupt the URL.
    expect(parseDynamicPathSegments('/report[2024]/summary').paramNames).toEqual([])
    expect(parseDynamicPathSegments('/search?tags[]=a').paramNames).toEqual([])
    expect(parseDynamicPathSegments('/a/[id]x/b').paramNames).toEqual([])
  })

  it('ignores Next catch-all segments, whose value is an array', () => {
    // `router.query.slug` is a string[] for a catch-all; interpolating it into
    // a URL would emit a comma-joined path. Leaving it alone is the honest
    // outcome until a caller needs a real join.
    expect(parseDynamicPathSegments('/docs/[...slug]').paramNames).toEqual([])
    expect(parseDynamicPathSegments('/docs/[[...slug]]').paramNames).toEqual([])
  })

  it('ends a segment at anything that cannot be part of a path', () => {
    // The same template appears inside a serialized JSON-LD document, where the
    // URL ends at the closing quote rather than at a slash.
    const embedded = '{"item":"https://example.com/event-details/[id]"}'
    const { paramNames } = parseDynamicPathSegments(embedded)
    expect(paramNames).toEqual(['id'])
  })

  it('is total for empty input', () => {
    expect(parseDynamicPathSegments('')).toEqual({ staticParts: [''], paramNames: [] })
  })
})

describe('pathHasDynamicSegment', () => {
  it('is true only for a whole-segment bracket parameter', () => {
    expect(pathHasDynamicSegment('/add-character/[id]')).toBe(true)
    expect(pathHasDynamicSegment('https://example.com/profile/[id]')).toBe(true)
    expect(pathHasDynamicSegment('/add-guild')).toBe(false)
    expect(pathHasDynamicSegment('/report[2024]')).toBe(false)
    expect(pathHasDynamicSegment('')).toBe(false)
    expect(pathHasDynamicSegment(undefined as unknown as string)).toBe(false)
  })
})

describe('isDynamicRoute', () => {
  it('reads the component output options, not a URL', () => {
    expect(
      isDynamicRoute({ outputOptions: { folderPath: ['event-details'], fileName: '[id]' } })
    ).toBe(true)
    expect(isDynamicRoute({ outputOptions: { folderPath: [], fileName: 'add-guild' } })).toBe(false)
    expect(isDynamicRoute({})).toBe(false)
  })
})
