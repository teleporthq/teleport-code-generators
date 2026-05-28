import { NodeHandlerGenerator } from '../types'

const RATE_LIMIT_STORE_CODE = `var __rateLimitStore = new Map();

function __rateLimitCleanup(currentWindowKey) {
  if (__rateLimitStore.size <= 10000) return;
  var keysToDelete = [];
  __rateLimitStore.forEach(function(val, key) {
    var lastColon = key.lastIndexOf(':');
    if (lastColon === -1) return;
    var keyWindow = parseInt(key.substring(lastColon + 1), 10);
    if (isNaN(keyWindow) || keyWindow < currentWindowKey - 1) {
      keysToDelete.push(key);
    }
  });
  for (var d = 0; d < keysToDelete.length; d++) {
    __rateLimitStore.delete(keysToDelete[d]);
  }
}

function __getClientIp(req) {
  if (!req) return 'unknown';
  var forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) {
    var first = (typeof forwarded === 'string' ? forwarded : forwarded[0] || '').split(',')[0].trim();
    if (first) return __normalizeIp(first);
  }
  var realIp = req.headers && req.headers['x-real-ip'];
  if (realIp) {
    var val = typeof realIp === 'string' ? realIp : realIp[0] || '';
    if (val) return __normalizeIp(val.trim());
  }
  if (req.socket && req.socket.remoteAddress) {
    return __normalizeIp(req.socket.remoteAddress);
  }
  if (req.connection && req.connection.remoteAddress) {
    return __normalizeIp(req.connection.remoteAddress);
  }
  return 'unknown';
}

function __normalizeIp(ip) {
  if (!ip) return 'unknown';
  var cleaned = ip.replace(/^\\[|\\]$/g, '').toLowerCase();
  if (cleaned === '::1' || cleaned === '::ffff:127.0.0.1') return '127.0.0.1';
  if (cleaned.indexOf('::ffff:') === 0) return cleaned.substring(7);
  return cleaned;
}

function __checkRateLimit(key, maxRequests, windowMs) {
  var now = Date.now();
  var windowKey = Math.floor(now / windowMs);
  var storeKey = key + ':' + windowKey;
  var windowExpiresSec = Math.ceil((((windowKey + 1) * windowMs) - now) / 1000);

  var entry = __rateLimitStore.get(storeKey);
  if (!entry) {
    entry = { count: 0 };
  }
  entry.count += 1;
  __rateLimitStore.set(storeKey, entry);

  __rateLimitCleanup(windowKey);

  var allowed = entry.count <= maxRequests;
  var remaining = Math.max(0, maxRequests - entry.count);

  return {
    allowed: allowed,
    remaining: remaining,
    retryAfter: allowed ? 0 : windowExpiresSec
  };
}`

const RATE_LIMIT_HANDLER_CODE = `
async function general_rate_limiter(config, context) {
  var strategy = config.strategy;
  var maxRequests = config.maxRequests;
  var windowMs = config.windowMs;
  var message = config.message || 'Too many requests. Please try again later.';

  if (!strategy || (strategy !== 'ip' && strategy !== 'key')) {
    return {
      __earlyResponse: {
        status: 500,
        headers: {},
        body: { error: 'Internal Server Error', message: 'Invalid rate limiter strategy: ' + String(strategy) }
      }
    };
  }

  if (!maxRequests || typeof maxRequests !== 'number' || maxRequests <= 0) {
    return {
      __earlyResponse: {
        status: 500,
        headers: {},
        body: { error: 'Internal Server Error', message: 'Invalid rate limiter maxRequests value.' }
      }
    };
  }

  if (!windowMs || typeof windowMs !== 'number' || windowMs <= 0) {
    return {
      __earlyResponse: {
        status: 500,
        headers: {},
        body: { error: 'Internal Server Error', message: 'Invalid rate limiter windowMs value.' }
      }
    };
  }

  var identifier;
  if (strategy === 'ip') {
    identifier = (context.__request && context.__request.ip) || 'unknown';
  } else {
    identifier = config.key;
    if (identifier === undefined || identifier === null || identifier === '') {
      return {
        __earlyResponse: {
          status: 500,
          headers: {},
          body: { error: 'Internal Server Error', message: 'Rate limit key could not be resolved.' }
        }
      };
    }
    identifier = String(identifier);
  }

  var fullKey = 'rate_limit:' + config.__nodeId + ':' + identifier;
  var result = __checkRateLimit(fullKey, maxRequests, windowMs);

  if (!result.allowed) {
    return {
      __earlyResponse: {
        status: 429,
        headers: { 'Retry-After': String(result.retryAfter) },
        body: {
          error: 'Too Many Requests',
          message: message,
          retryAfter: result.retryAfter
        }
      }
    };
  }

  return { allowed: true, remaining: result.remaining };
}`

export const generalRateLimiter: NodeHandlerGenerator = {
  nodeType: 'general-rate-limiter',
  executionEnv: 'server',
  generateHandler(): string {
    return `async function general_rate_limiter() {
  throw new Error('general-rate-limiter must run on the server');
}`
  },
  generateServerHandler(): string {
    return RATE_LIMIT_STORE_CODE + '\n' + RATE_LIMIT_HANDLER_CODE
  },
}
