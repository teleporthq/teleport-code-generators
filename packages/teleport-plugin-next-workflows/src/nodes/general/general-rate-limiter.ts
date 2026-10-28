import { NodeHandlerGenerator, ServerHandlerOptions } from '../types'
import {
  generateSecurityRuntimeVar,
  serverHandlerPrefix,
  VISITOR_KEY_CODE,
} from './visitor-request'

/**
 * Counts in the app's shared, durable limiter (`rateLimit` in
 * `utils/security-runtime.js`), so every instance of a serverless app counts
 * together and a redeploy or cold start resets nothing. The 'ip' strategy
 * reads the visitor's address only where the host guarantees it (an IPv6
 * visitor counts by its /64). Without the runtime the request is refused.
 */
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

  if (!maxRequests || typeof maxRequests !== 'number' || maxRequests < 1) {
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

  var security = __rateLimitSecurity;
  if (!security || typeof security.rateLimit !== 'function' || typeof security.clientIp !== 'function') {
    console.error('[rate-limiter] request refused: the security runtime is not available');
    return {
      __earlyResponse: {
        status: 500,
        headers: {},
        body: { error: 'Internal Server Error', message: 'Rate limiting is not available.' }
      }
    };
  }

  var identifier;
  if (strategy === 'ip') {
    identifier = __visitorKeyOf(security, context.__request);
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

  var result;
  try {
    result = await security.rateLimit({
      key: JSON.stringify(['workflow-rate-limiter', String(config.__nodeId), strategy, identifier]),
      limit: Math.floor(maxRequests),
      windowSeconds: Math.max(1, Math.ceil(windowMs / 1000))
    });
  } catch (err) {
    console.error('[rate-limiter] request refused:', err && err.message ? err.message : err);
    return {
      __earlyResponse: {
        status: 500,
        headers: {},
        body: { error: 'Internal Server Error', message: 'Rate limiting is not available.' }
      }
    };
  }

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

  return { allowed: true };
}`

export const generalRateLimiter: NodeHandlerGenerator = {
  nodeType: 'general-rate-limiter',
  executionEnv: 'server',
  generateHandler(): string {
    return `async function general_rate_limiter() {
  throw new Error('general-rate-limiter must run on the server');
}`
  },
  generateServerHandler(options?: ServerHandlerOptions): string {
    return (
      generateSecurityRuntimeVar('__rateLimitSecurity', serverHandlerPrefix(options)) +
      '\n' +
      VISITOR_KEY_CODE +
      '\n' +
      RATE_LIMIT_HANDLER_CODE
    )
  },
}
