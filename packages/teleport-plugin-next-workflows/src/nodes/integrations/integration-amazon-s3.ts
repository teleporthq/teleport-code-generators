import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_amazon_s3(config: any, context: Record<string, unknown>) {
  const accessKeyId = config.accessKeyId
  const secretAccessKey = config.secretAccessKey
  const region = config.region
  const action = config.action
  const bucket = config.bucket

  async function getSignatureKey(key, dateStamp, regionName, serviceName) {
    const enc = new TextEncoder()
    const kDate = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        enc.encode('AWS4' + key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      ),
      enc.encode(dateStamp)
    )
    const kRegion = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey('raw', kDate, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]),
      enc.encode(regionName)
    )
    const kService = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey('raw', kRegion, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]),
      enc.encode(serviceName)
    )
    const kSigning = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey('raw', kService, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]),
      enc.encode('aws4_request')
    )
    return kSigning
  }

  async function sha256Hex(data) {
    const enc = new TextEncoder()
    const hash = await crypto.subtle.digest(
      'SHA-256',
      typeof data === 'string' ? enc.encode(data) : data
    )
    return Array.from(new Uint8Array(hash))
      .map(function (b) {
        return b.toString(16).padStart(2, '0')
      })
      .join('')
  }

  async function signRequest(method, path, queryString, headers, payload) {
    const now = new Date()
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
    const dateStamp = amzDate.substring(0, 8)
    headers['x-amz-date'] = amzDate
    headers.host = bucket + '.s3.' + region + '.amazonaws.com'

    const sortedHeaders = Object.keys(headers).sort()
    const signedHeaders = sortedHeaders.join(';')
    const canonicalHeaders = sortedHeaders
      .map(function (k) {
        return k.toLowerCase() + ':' + headers[k].trim() + '\n'
      })
      .join('')
    const payloadHash = await sha256Hex(payload || '')
    headers['x-amz-content-sha256'] = payloadHash

    const canonicalRequest =
      method +
      '\n' +
      path +
      '\n' +
      (queryString || '') +
      '\n' +
      canonicalHeaders +
      '\n' +
      signedHeaders +
      '\n' +
      payloadHash
    const credentialScope = dateStamp + '/' + region + '/s3/aws4_request'
    const stringToSign =
      'AWS4-HMAC-SHA256\n' +
      amzDate +
      '\n' +
      credentialScope +
      '\n' +
      (await sha256Hex(canonicalRequest))
    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3')
    const enc = new TextEncoder()
    const signatureRaw = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]),
      enc.encode(stringToSign)
    )
    const signature = Array.from(new Uint8Array(signatureRaw))
      .map(function (b) {
        return b.toString(16).padStart(2, '0')
      })
      .join('')

    headers.Authorization =
      'AWS4-HMAC-SHA256 Credential=' +
      accessKeyId +
      '/' +
      credentialScope +
      ', SignedHeaders=' +
      signedHeaders +
      ', Signature=' +
      signature
    return headers
  }

  const host = bucket + '.s3.' + region + '.amazonaws.com'

  switch (action) {
    case 'upload-file': {
      const key = config.key
      const body = config.body
      const contentType = config.contentType || 'application/octet-stream'
      const headers = { 'Content-Type': contentType }
      const signed = await signRequest('PUT', '/' + key, '', headers, body)
      const response = await fetch('https://' + host + '/' + key, {
        method: 'PUT',
        headers: signed,
        body,
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to upload file' }
      }
      return { success: true, key }
    }
    case 'get-object': {
      const key = config.key
      const headers = {}
      const signed = await signRequest('GET', '/' + key, '', headers, '')
      const response = await fetch('https://' + host + '/' + key, {
        method: 'GET',
        headers: signed,
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to get object' }
      }
      const data = await response.arrayBuffer()
      return { success: true, body: data, contentType: response.headers.get('content-type') }
    }
    case 'list-objects': {
      const prefix = config.prefix || ''
      let qs = 'list-type=2'
      if (prefix) {
        qs = qs + '&prefix=' + encodeURIComponent(prefix)
      }
      if (config.maxKeys) {
        qs = qs + '&max-keys=' + config.maxKeys
      }
      const headers = {}
      const signed = await signRequest('GET', '/', qs, headers, '')
      const response = await fetch('https://' + host + '/?' + qs, {
        method: 'GET',
        headers: signed,
      })
      if (!response.ok) {
        const errText = await response.text()
        return { success: false, error: errText || 'Failed to list objects' }
      }
      const listBodyText = await response.text()
      return { success: true, body: listBodyText }
    }
    case 'download-file': {
      const key = config.key
      const headers: Record<string, string> = {}
      const signed = await signRequest('GET', '/' + key, '', headers, '')
      const response = await fetch('https://' + host + '/' + key, {
        method: 'GET',
        headers: signed,
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to download file' }
      }
      const data = await response.arrayBuffer()
      return { success: true, body: data, contentType: response.headers.get('content-type') }
    }
    case 'delete-file': {
      const key = config.key
      const headers: Record<string, string> = {}
      const signed = await signRequest('DELETE', '/' + key, '', headers, '')
      const response = await fetch('https://' + host + '/' + key, {
        method: 'DELETE',
        headers: signed,
      })
      if (!response.ok && response.status !== 204) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to delete file' }
      }
      return { success: true }
    }
    case 'get-presigned-url': {
      const key = config.key
      const expiresIn = config.expiresIn || 3600
      const now = new Date()
      const amzDate = now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')
      const dateStamp = amzDate.substring(0, 8)
      const credentialScope = dateStamp + '/' + region + '/s3/aws4_request'
      const canonicalUri = '/' + key.split('/').map(encodeURIComponent).join('/')
      const signedHeaders = 'host'
      const payloadHash = 'UNSIGNED-PAYLOAD'
      const canonicalRequest =
        'GET\n' + canonicalUri + '\n\nhost:' + host + '\n\n' + signedHeaders + '\n' + payloadHash
      const stringToSign =
        'AWS4-HMAC-SHA256\n' +
        amzDate +
        '\n' +
        credentialScope +
        '\n' +
        (await sha256Hex(canonicalRequest))
      const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3')
      const enc = new TextEncoder()
      const signatureRaw = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
          'sign',
        ]),
        enc.encode(stringToSign)
      )
      const signature = Array.from(new Uint8Array(signatureRaw))
        .map(function (b: number) {
          return b.toString(16).padStart(2, '0')
        })
        .join('')
      const url =
        'https://' +
        host +
        canonicalUri +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=' +
        encodeURIComponent(accessKeyId + '/' + credentialScope) +
        '&X-Amz-Date=' +
        amzDate +
        '&X-Amz-Expires=' +
        expiresIn +
        '&X-Amz-SignedHeaders=host&X-Amz-Signature=' +
        signature
      return { success: true, url }
    }
    case 'copy-object': {
      const sourceKey = config.sourceKey || config.source
      const destKey = config.key || config.destKey
      const copySource = encodeURIComponent(bucket + '/' + sourceKey)
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'x-amz-copy-source': copySource,
      }
      if (config.contentType) {
        headers['x-amz-metadata-directive'] = 'REPLACE'
      }
      const signed = await signRequest('PUT', '/' + destKey, '', headers, '')
      const response = await fetch('https://' + host + '/' + destKey, {
        method: 'PUT',
        headers: signed,
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to copy object' }
      }
      return { success: true, key: destKey }
    }
    case 'set-acl': {
      const key = config.key
      const acl = config.acl || 'private'
      const qs = 'acl'
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'x-amz-acl': acl,
      }
      const signed = await signRequest('PUT', '/' + key, qs, headers, '')
      const response = await fetch('https://' + host + '/' + key + '?acl', {
        method: 'PUT',
        headers: signed,
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text || 'Failed to set ACL' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-amazon-s3 action: ' + action)
  }
}
export const integrationAmazonS3: IntegrationHandlerGenerator = {
  nodeType: 'integration-amazon-s3',
  executionEnv: 'server',
  secretFields: ['accessKeyId', 'secretAccessKey', 'region'],
  generateHandler(): string {
    return handlerToString(integration_amazon_s3)
  },
}
