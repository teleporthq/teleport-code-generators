import { NodeHandlerGenerator, handlerToString } from '../types'

/**
 * Calls an outside HTTP(S) API from the server. The URL may come from the
 * visitor (the editor binds it to page state or a form field), so the server
 * only ever connects to a public address:
 *
 * - http and https only;
 * - `localhost`, `*.internal` and `metadata.*` names are refused, and every
 *   address a name resolves to must be public: loopback, private, link-local
 *   (the 169.254.169.254 metadata service), CGNAT, unique-local, multicast and
 *   reserved ranges are refused. The check runs in the connection's own DNS
 *   lookup, so the address checked is the address connected to (a name that
 *   answers a public address first and a private one next gains nothing);
 * - redirects are followed by hand, at most 3, each hop checked the same way;
 *   credentials are not carried to another origin;
 * - 10 s for the whole call, and a response body of at most 2 MB.
 */
async function general_http_request(config: any, context: Record<string, unknown>) {
  const MAX_TIMEOUT_MS = 10000
  const MAX_REDIRECTS = 3
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
  const NOT_ALLOWED = 'The request URL is not allowed'
  const method = String(config.method || 'GET').toUpperCase()
  const headers = config.headers || []
  const queryParams = config.queryParams || []
  const body = config.body
  const bodyType = config.bodyType || 'json'
  const requestedTimeout = Number(config.timeout)
  const timeout = requestedTimeout > 0 ? Math.min(requestedTimeout, MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS

  const __nodeRequire =
    typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
  const net = __nodeRequire('net')
  const dns = __nodeRequire('dns')
  const http = __nodeRequire('http')
  const https = __nodeRequire('https')
  const zlib = __nodeRequire('zlib')
  // Read off the global, never named bare: this body ships as source after the
  // editor's browser bundle, which rewrites a bare Buffer into its own shim.
  const __Buffer = (globalThis as any).Buffer

  function failure(code: string) {
    const error: any = new Error(code)
    error.code = code
    return error
  }

  function isBlockedIPv4(ip: string) {
    const o = ip.split('.').map(Number)
    return (
      o[0] === 0 ||
      o[0] === 10 ||
      o[0] === 127 ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127) ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 192 && o[1] === 0 && (o[2] === 0 || o[2] === 2)) ||
      (o[0] === 192 && o[1] === 88 && o[2] === 99) ||
      (o[0] === 198 && (o[1] === 18 || o[1] === 19)) ||
      (o[0] === 198 && o[1] === 51 && o[2] === 100) ||
      (o[0] === 203 && o[1] === 0 && o[2] === 113) ||
      o[0] >= 224
    )
  }

  // The eight 16-bit groups of an IPv6 address, a trailing dotted IPv4 part
  // included; null when it is not one.
  function ipv6Groups(ip: string) {
    let text = ip
    const groups: number[] = []
    const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
    if (dotted) {
      if (!net.isIPv4(dotted[1])) {
        return null
      }
      const o = dotted[1].split('.').map(Number)
      text = text.slice(0, text.length - dotted[1].length) + '0:0'
      groups.push(o[0] * 256 + o[1], o[2] * 256 + o[3])
    }
    const halves = text.split('::')
    if (halves.length > 2) {
      return null
    }
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    const missing = 8 - head.length - tail.length
    if (missing < 0 || (halves.length === 1 && missing !== 0)) {
      return null
    }
    const all = head.concat(new Array(missing).fill('0'), tail).map(function (group) {
      return parseInt(group, 16)
    })
    if (all.some(isNaN)) {
      return null
    }
    if (dotted) {
      all[6] = groups[0]
      all[7] = groups[1]
    }
    return all
  }

  function isBlockedIPv6(ip: string) {
    const g = ipv6Groups(ip)
    if (!g) {
      return true
    }
    const embeddedIPv4 = [
      Math.floor(g[6] / 256),
      g[6] % 256,
      Math.floor(g[7] / 256),
      g[7] % 256,
    ].join('.')
    const zeroUpTo = function (n: number) {
      return g.slice(0, n).every(function (group) {
        return group === 0
      })
    }
    // IPv4-mapped (::ffff:a.b.c.d), SIIT (::ffff:0:a.b.c.d) and NAT64
    // (64:ff9b::a.b.c.d): the IPv4 address decides.
    if (zeroUpTo(5) && g[5] === 0xffff) {
      return isBlockedIPv4(embeddedIPv4)
    }
    if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) {
      return isBlockedIPv4(embeddedIPv4)
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isBlockedIPv4(embeddedIPv4)
    }
    return (
      zeroUpTo(6) || // ::, ::1, IPv4-compatible
      (g[0] === 0x64 && g[1] === 0xff9b) || // local-use NAT64
      (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) || // discard-only
      (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) || // Teredo, documentation
      g[0] === 0x2002 || // 6to4
      (g[0] >= 0xfc00 && g[0] <= 0xfdff) || // unique local fc00::/7
      (g[0] >= 0xfe80 && g[0] <= 0xfebf) || // link-local fe80::/10
      (g[0] >= 0xfec0 && g[0] <= 0xfeff) || // site-local fec0::/10
      g[0] >= 0xff00 // multicast ff00::/8
    )
  }

  function isBlockedAddress(address: string) {
    const ip = String(address || '').split('%')[0]
    const version = net.isIP(ip)
    if (version === 4) {
      return isBlockedIPv4(ip)
    }
    if (version === 6) {
      return isBlockedIPv6(ip.toLowerCase())
    }
    return true
  }

  function isBlockedName(hostname: string) {
    const name = hostname.replace(/\.$/, '').toLowerCase()
    return (
      !name ||
      name === 'localhost' ||
      /\.localhost$/.test(name) ||
      name === 'internal' ||
      /\.internal$/.test(name) ||
      /^metadata(\.|$)/.test(name)
    )
  }

  function assertAllowed(target: any) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw failure('ERR_URL_NOT_ALLOWED')
    }
    if (target.username || target.password) {
      throw failure('ERR_URL_NOT_ALLOWED')
    }
    const host = target.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) ? isBlockedAddress(host) : isBlockedName(host)) {
      throw failure('ERR_URL_NOT_ALLOWED')
    }
  }

  // The connection's DNS lookup: every address the name has must be public,
  // and the one returned is the one the socket connects to.
  function publicLookup(hostname: string, options: any, callback: any) {
    dns.lookup(hostname, { all: true, verbatim: true }, function (err: any, addresses: any) {
      if (err) {
        callback(err)
        return
      }
      const list = Array.isArray(addresses) ? addresses : []
      if (
        list.length === 0 ||
        list.some(function (entry: any) {
          return isBlockedAddress(entry.address)
        })
      ) {
        callback(failure('ERR_URL_NOT_ALLOWED'))
        return
      }
      const family = options && typeof options === 'object' ? options.family : options
      const usable =
        family === 4 || family === 6
          ? list.filter(function (entry: any) {
              return entry.family === family
            })
          : list
      if (usable.length === 0) {
        callback(failure('ENOTFOUND'))
        return
      }
      if (options && options.all) {
        callback(null, usable)
        return
      }
      callback(null, usable[0].address, usable[0].family)
    })
  }

  function send(target: any, sendMethod: string, sendHeaders: any, payload: any, deadline: number) {
    return new Promise(function (resolve: any, reject: any) {
      const transport = target.protocol === 'https:' ? https : http
      let settled = false
      let request: any = null
      // The decoder too: after a refusal it must stop inflating what it holds.
      let decoder: any = null
      const finish = function (err: any, value?: any) {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        if (err) {
          if (decoder) {
            decoder.destroy()
          }
          if (request) {
            request.destroy()
          }
          reject(err)
        } else {
          resolve(value)
        }
      }
      const timer = setTimeout(function () {
        finish(failure('ETIMEDOUT'))
      }, Math.max(1, deadline - Date.now()))
      try {
        request = transport.request(
          {
            protocol: target.protocol,
            hostname: target.hostname.replace(/^\[|\]$/g, ''),
            port: target.port || undefined,
            path: target.pathname + target.search,
            method: sendMethod,
            headers: sendHeaders,
            lookup: publicLookup,
            agent: false,
          },
          function (response: any) {
            const status = response.statusCode || 0
            const location = response.headers.location
            if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && location) {
              response.resume()
              finish(null, { status, location })
              return
            }
            const encoding = String(response.headers['content-encoding'] || '')
              .trim()
              .toLowerCase()
            const hasBody = sendMethod !== 'HEAD' && status !== 204 && status !== 304
            let stream = response
            if (hasBody && (encoding === 'gzip' || encoding === 'x-gzip')) {
              stream = response.pipe(zlib.createGunzip())
            } else if (hasBody && encoding === 'deflate') {
              stream = response.pipe(zlib.createInflate())
            } else if (hasBody && encoding === 'br') {
              stream = response.pipe(zlib.createBrotliDecompress())
            }
            decoder = stream === response ? null : stream
            const chunks: any[] = []
            let size = 0
            stream.on('data', function (chunk: any) {
              size += chunk.length
              if (size > MAX_RESPONSE_BYTES) {
                finish(failure('ERR_RESPONSE_TOO_LARGE'))
                return
              }
              chunks.push(chunk)
            })
            stream.on('error', function (err: any) {
              if (size === 0) {
                finish(null, { status, response, buffer: __Buffer.alloc(0) })
                return
              }
              finish(err)
            })
            stream.on('end', function () {
              finish(null, { status, response, buffer: __Buffer.concat(chunks) })
            })
          }
        )
        request.on('error', function (err: any) {
          finish(err)
        })
        if (payload) {
          request.write(payload)
        }
        request.end()
      } catch (err) {
        finish(err)
      }
    })
  }

  try {
    let target = new URL(config.url)
    for (let i = 0; i < queryParams.length; i++) {
      if (queryParams[i].key) {
        target.searchParams.append(queryParams[i].key, queryParams[i].value || '')
      }
    }

    // Hop-by-hop and routing headers are the client's, never the author's.
    const RESERVED_HEADERS = [
      'host',
      'connection',
      'content-length',
      'transfer-encoding',
      'keep-alive',
      'upgrade',
      'te',
      'trailer',
      'expect',
      'proxy-authorization',
      'proxy-connection',
    ]
    const fetchHeaders: Record<string, string> = {}
    for (let h = 0; h < headers.length; h++) {
      const key = headers[h].key
      if (key && RESERVED_HEADERS.indexOf(String(key).toLowerCase()) === -1) {
        fetchHeaders[key] = headers[h].value || ''
      }
    }

    // The body as bytes, typed the way fetch types it unless the author set a
    // type (no Response / FormData global needed).
    let payload: any = null
    let inferredType = ''
    if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
      if (bodyType === 'json') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json'
        payload = typeof body === 'string' ? body : JSON.stringify(body)
      } else if (bodyType === 'form-data') {
        // multipart/form-data with every field as text, as FormData sends a plain value.
        const boundary =
          '----TeleportFormBoundary' + Date.now().toString(16) + Math.random().toString(16).slice(2)
        const fieldName = function (name: string) {
          return name.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
        }
        let multipart = ''
        if (typeof body === 'object') {
          const keys = Object.keys(body)
          for (let f = 0; f < keys.length; f++) {
            multipart +=
              '--' +
              boundary +
              '\r\nContent-Disposition: form-data; name="' +
              fieldName(keys[f]) +
              '"\r\n\r\n' +
              String(body[keys[f]]) +
              '\r\n'
          }
        }
        payload = multipart + '--' + boundary + '--\r\n'
        inferredType = 'multipart/form-data; boundary=' + boundary
      } else if (bodyType === 'x-www-form-urlencoded') {
        fetchHeaders['Content-Type'] =
          fetchHeaders['Content-Type'] || 'application/x-www-form-urlencoded'
        if (typeof body === 'object') {
          const params = new URLSearchParams()
          const bKeys = Object.keys(body)
          for (let u = 0; u < bKeys.length; u++) {
            params.append(bKeys[u], body[bKeys[u]])
          }
          payload = params.toString()
        } else {
          payload = String(body)
        }
      } else if (bodyType === 'raw') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'text/plain'
        payload = String(body)
      } else if (bodyType === 'binary') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/octet-stream'
        payload = body
      } else {
        payload = typeof body === 'string' ? body : JSON.stringify(body)
      }
      if (typeof payload === 'string') {
        inferredType = inferredType || 'text/plain;charset=UTF-8'
        payload = __Buffer.from(payload, 'utf8')
      } else if (__Buffer.isBuffer(payload)) {
        // already bytes
      } else if (ArrayBuffer.isView(payload)) {
        payload = __Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      } else if (payload instanceof ArrayBuffer) {
        payload = __Buffer.from(payload)
      } else if (payload && typeof payload.arrayBuffer === 'function') {
        payload = __Buffer.from(await payload.arrayBuffer())
      } else {
        payload = __Buffer.from(String(payload), 'utf8')
      }
      const hasType = Object.keys(fetchHeaders).some(function (key) {
        return key.toLowerCase() === 'content-type'
      })
      if (inferredType && !hasType) {
        fetchHeaders['Content-Type'] = inferredType
      }
    }

    const deadline = Date.now() + timeout
    let currentMethod = method
    let currentHeaders: Record<string, string> = {
      'Accept-Encoding': 'gzip, deflate, br',
      ...fetchHeaders,
    }
    let result: any = null
    for (let hop = 0; ; hop++) {
      assertAllowed(target)
      const sendHeaders = { ...currentHeaders }
      if (payload) {
        sendHeaders['Content-Length'] = String(payload.length)
      }
      result = await send(target, currentMethod, sendHeaders, payload, deadline)
      if (!result.location) {
        break
      }
      if (hop >= MAX_REDIRECTS) {
        throw failure('ERR_TOO_MANY_REDIRECTS')
      }
      const next = new URL(result.location, target)
      if (
        (result.status === 303 && currentMethod !== 'HEAD') ||
        ((result.status === 301 || result.status === 302) && currentMethod === 'POST')
      ) {
        currentMethod = 'GET'
        payload = null
        currentHeaders = Object.keys(currentHeaders).reduce(function (kept: any, key) {
          if (key.toLowerCase() !== 'content-type') {
            kept[key] = currentHeaders[key]
          }
          return kept
        }, {})
      }
      if (next.origin !== target.origin) {
        currentHeaders = Object.keys(currentHeaders).reduce(function (kept: any, key) {
          if (['authorization', 'cookie'].indexOf(key.toLowerCase()) === -1) {
            kept[key] = currentHeaders[key]
          }
          return kept
        }, {})
      }
      target = next
    }

    const responseHeaders = {}
    Object.keys(result.response.headers).forEach(function (key) {
      const value = result.response.headers[key]
      responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value
    })

    const text = result.buffer.toString('utf8')
    const contentType = String(result.response.headers['content-type'] || '')
    let responseBody: any = text
    if (contentType.indexOf('application/json') !== -1) {
      try {
        responseBody = JSON.parse(text)
      } catch (e) {
        responseBody = text
      }
    }

    // The output shape MUST match the general-http-request schema in
    // packages/workflow-schema/src/types/node-context-schemas.json. The GUI
    // exposes "body" as the bindable field, so downstream nodes look up
    // <httpNode>.body. Returning "data" here breaks every workflow that
    // chains a loop / transform off the HTTP response, silently iterating
    // an empty array because "body" is undefined.
    return {
      status: result.status,
      statusText: result.response.statusMessage || '',
      headers: responseHeaders,
      body: responseBody,
    }
  } catch (err: unknown) {
    const code = err && (err as any).code
    if (code === 'ETIMEDOUT') {
      return {
        status: 0,
        statusText: 'Request Timeout',
        headers: {},
        body: null,
        error: 'Request timed out after ' + timeout + 'ms',
      }
    }
    if (code === 'ERR_URL_NOT_ALLOWED') {
      return { status: 0, statusText: 'Not Allowed', headers: {}, body: null, error: NOT_ALLOWED }
    }
    if (code === 'ERR_TOO_MANY_REDIRECTS') {
      return {
        status: 0,
        statusText: 'Too Many Redirects',
        headers: {},
        body: null,
        error: 'The request was redirected more than ' + MAX_REDIRECTS + ' times',
      }
    }
    if (code === 'ERR_RESPONSE_TOO_LARGE') {
      return {
        status: 0,
        statusText: 'Response Too Large',
        headers: {},
        body: null,
        error: 'The response is larger than 2 MB',
      }
    }
    return {
      status: 0,
      statusText: 'Network Error',
      headers: {},
      body: null,
      error: (err as Error).message,
    }
  }
}
export const generalHttpRequest: NodeHandlerGenerator = {
  nodeType: 'general-http-request',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(general_http_request)
  },
}
