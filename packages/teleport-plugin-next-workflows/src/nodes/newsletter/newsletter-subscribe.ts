import { NodeHandlerGenerator, ServerHandlerOptions } from '../types'
import { serverHandlerPrefix } from '../general/visitor-request'
import { newsletterHelperSpecifier } from '../../newsletter/newsletter-scope'

/** What the step fails with on a site whose newsletter is not generated. */
export const NEWSLETTER_NOT_SET_UP_MESSAGE =
  'The newsletter is not set up on this site. Switch on Newsletter, then publish again.'

/** What the step fails with when the site's database does not answer. */
export const NEWSLETTER_TRY_AGAIN_MESSAGE =
  'We could not add you to the newsletter. Please try again in a moment.'

/**
 * Server node. Adds the address a visitor typed to the newsletter through the
 * site's helper (`utils/newsletter/newsletter.js`), which decides everything:
 * double opt-in, an unsubscribed address only ever mailed a confirmation link,
 * the per-address limit, the event and the welcome email. `website` is the
 * form's honeypot: filled, nothing is written. Every run answers
 * `{ ok: true, pending }` after the same minimum time, whatever happened to
 * the address. The visitor limit is the step's `visitorLimit` (scope
 * `newsletter-signup`), which the feature builders declare.
 *
 * The helper is a static `require` (Next's server build bundles it), emitted
 * only where the route's place is known; elsewhere the step refuses.
 */
const generateSubscribeHandler = (
  relativePrefix: string | null
): string => `var __newsletterHelper = typeof __newsletterHelper !== 'undefined' ? __newsletterHelper : ${
  relativePrefix
    ? `(function () { try { return require('${newsletterHelperSpecifier(
        relativePrefix
      )}'); } catch (_e) { return null; } })()`
    : 'null'
};

async function newsletter_subscribe(config, context) {
  var newsletter = __newsletterHelper;
  if (!newsletter) {
    throw new Error(${JSON.stringify(NEWSLETTER_NOT_SET_UP_MESSAGE)});
  }
  var startedAt = Date.now();
  var answer = newsletter.publicSubscribeAnswer();
  var trap = config && config.website != null ? String(config.website).trim() : '';
  if (!trap) {
    var email = newsletter.normalizeEmail(config && config.email);
    if (!email) {
      throw new Error('Enter a valid email address.');
    }
    try {
      await newsletter.withNewsletterDb(function (db) {
        return newsletter.subscribeNewsletterPerson({
          db: db,
          email: email,
          signUpPoint: newsletter.visitorSignUpPoint(config && config.signUpPoint),
          req: context && context.__request,
        });
      });
    } catch (err) {
      // Logged by code and message only (never a database row); the visitor
      // is told nothing about the database.
      console.error('[newsletter] sign-up failed:', newsletter.safeError(err));
      throw new Error(${JSON.stringify(NEWSLETTER_TRY_AGAIN_MESSAGE)});
    }
  }
  await newsletter.waitUntilElapsed(startedAt, newsletter.NEWSLETTER_MIN_RESPONSE_MS);
  return { ok: answer.ok === true, pending: answer.pending === true };
}`

export const newsletterSubscribe: NodeHandlerGenerator = {
  nodeType: 'newsletter-subscribe',
  executionEnv: 'server',
  generateHandler(): string {
    return generateSubscribeHandler(null)
  },
  generateServerHandler(options?: ServerHandlerOptions): string {
    return generateSubscribeHandler(serverHandlerPrefix(options))
  },
}
