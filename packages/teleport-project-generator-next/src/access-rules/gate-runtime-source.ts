import { toJsLiteral } from '../pwa/source-literals'
import { AccessRulesSettings } from './settings'
import { AGE_COOKIE } from './constants'

/** The editor's marks and events (`features/plugins/flows/access-rules/access-rules-markers.ts` there). */
const ROOT_ATTR = 'data-tq-age-gate'
const EVENTS = {
  confirm: 'tq-age-gate-confirm',
  birthdate: 'tq-age-gate-birthdate',
  close: 'tq-age-gate-close',
  open: 'tq-age-gate-open',
  tooYoung: 'tq-age-gate-too-young',
}

/** The editor's marks on the gate's own controls (`access-rules-markers.ts` there). */
const CONTROLS = {
  confirm: 'data-tq-age-gate-confirm',
  birthdate: 'data-tq-age-gate-birthdate',
  submit: 'data-tq-age-gate-submit',
  error: 'data-tq-age-gate-error',
}

export interface GateHeadSnippetOptions {
  /**
   * For a download that runs none of the project's workflows (HTML, React,
   * Vue, Nuxt, Angular): the snippet answers the gate's controls itself, by
   * their marks, and the style alone hides the gate — nothing tells the
   * component to close. A page's `.html` is read as its path.
   */
  withoutWorkflows?: boolean
}

/**
 * The age gate's head snippet, for a project whose gate is the editor's Age
 * Gate component: drawn open on every published page, so a visitor who must
 * confirm sees it from the first paint. Before the page paints, this marks
 * `<html data-tq-age-gate="open|hidden">` from the cookie and the page's
 * path (the style hides the gate at once for a visitor who confirmed, or on
 * a page the gate does not cover); after hydration it tells the component to
 * close or open through its workflows (`tq-age-gate-close` / `-open`), and
 * keeps telling it for a while, since the listener attaches only once the
 * page hydrated. The gate's controls run workflows that send
 * `tq-age-gate-confirm` (remember, close) and `tq-age-gate-birthdate` with
 * the date (remember and close, or `tq-age-gate-too-young`). A gated page
 * can be marked noindex. Dependency-free ES5, so it runs before any bundle.
 *
 * ⛔ Shipped inside a `<script>` in the head: no closing-tag sequence in it.
 */
export const buildGateHeadSnippet = (
  settings: AccessRulesSettings,
  runtime: { gatedPaths: string[]; unavailablePaths: string[] },
  options: GateHeadSnippetOptions = {}
): string => {
  const { withoutWorkflows = false } = options
  const staticPath = withoutWorkflows
    ? `
    p = p.replace(/\\/index\\.html$/, '/').replace(/\\.html$/, '');`
    : ''
  const settleBody = withoutWorkflows
    ? `
    return;`
    : `
    var tries = 0;
    (function tick() {
      var shown = !!(document.body && document.body.querySelector(ROOT));
      if (shown === open) return;
      tell(open ? EVENTS.open : EVENTS.close);
      if (++tries < 40) setTimeout(tick, 250);
    })();`
  const controls = withoutWorkflows
    ? `
  // No workflow runs here: the gate's own controls are answered by their marks.
  var CONTROLS = ${toJsLiteral(CONTROLS)};
  function control(event, mark) {
    var target = event.target;
    return target && target.closest ? target.closest('[' + mark + ']') : null;
  }
  document.addEventListener('click', function (event) {
    if (control(event, CONTROLS.confirm)) {
      confirmed();
      return;
    }
    var submit = control(event, CONTROLS.submit);
    if (!submit) return;
    var gate = submit.closest(ROOT) || document;
    var field = gate.querySelector('[' + CONTROLS.birthdate + ']');
    var text = field && typeof field.value === 'string' ? field.value : '';
    if (!text) {
      if (field && field.reportValidity) field.reportValidity();
      return;
    }
    if (years(text) >= S.minimumAge) {
      confirmed();
      return;
    }
    var error = gate.querySelector('[' + CONTROLS.error + ']');
    if (error) error.removeAttribute('hidden');
  });`
    : ''
  const client = {
    enabled: settings.ageGateEnabled,
    minimumAge: settings.minimumAge,
    scope: settings.ageGateScope,
    pages: runtime.gatedPaths,
    // The plugin's Unavailable page: a blocked visitor is served it at the address they asked for, never behind the gate.
    ungated: runtime.unavailablePaths,
    rememberSeconds: settings.rememberDays * 86400,
    noindex: !settings.allowCrawlers,
  }
  const style = `html[${ROOT_ATTR}="hidden"] [${ROOT_ATTR}]{display:none!important}html[${ROOT_ATTR}="open"]{overflow:hidden}`
  const script = `(function () {
  var S = ${toJsLiteral(client)};
  var COOKIE = ${toJsLiteral(AGE_COOKIE)};
  var ATTR = ${toJsLiteral(ROOT_ATTR)};
  var ROOT = '[' + ATTR + ']';
  var PREFIX = 'workflow:custom:';
  var EVENTS = ${toJsLiteral(EVENTS)};
  var html = document.documentElement;
  function cookie() {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && parts[i].slice(0, eq) === COOKIE) {
        try { return decodeURIComponent(parts[i].slice(eq + 1)); } catch (e) { return ''; }
      }
    }
    return '';
  }
  function remember() {
    var value = COOKIE + '=' + encodeURIComponent(String(S.minimumAge)) + '; Path=/; SameSite=Lax';
    if (S.rememberSeconds > 0) value += '; Max-Age=' + S.rememberSeconds;
    if (location.protocol === 'https:') value += '; Secure';
    document.cookie = value;
  }
  function path() {
    var p = location.pathname;${staticPath}
    return p.length > 1 ? p.replace(/\\/+$/, '').toLowerCase() : p;
  }
  function matches(p, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i];
      if (pattern.slice(-2) === '/*') {
        var base = pattern.slice(0, -2) || '/';
        if (p === base || p.indexOf(base === '/' ? '/' : base + '/') === 0) return true;
      } else if (pattern.slice(-1) === '*') {
        if (p.indexOf(pattern.slice(0, -1)) === 0) return true;
      } else if (p === pattern) {
        return true;
      }
    }
    return false;
  }
  function gated(p) {
    if (!S.enabled || matches(p, S.ungated)) return false;
    return S.scope !== 'pages' || matches(p, S.pages);
  }
  function wanted() {
    return gated(path()) && cookie() !== String(S.minimumAge);
  }
  function tell(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(PREFIX + name, { detail: detail || {} }));
    } catch (e) {}
  }
  // The component answers only once hydrated: ask until the gate matches.
  // Looked for inside the body: <html> carries the same attribute as its mark.
  function settle(open) {${settleBody}
  }
  function noindex() {
    if (!S.noindex || !gated(path()) || document.querySelector('meta[name="robots"][' + ATTR + ']')) return;
    var meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    meta.setAttribute(ATTR, '');
    document.head.appendChild(meta);
  }
  function apply() {
    var open = wanted();
    html.setAttribute(ATTR, open ? 'open' : 'hidden');
    settle(open);
    noindex();
  }
  function confirmed() {
    remember();
    html.setAttribute(ATTR, 'hidden');
    settle(false);
  }
  function years(text) {
    var birth = new Date(text + 'T00:00:00');
    if (isNaN(birth.getTime())) return -1;
    var now = new Date();
    var age = now.getFullYear() - birth.getFullYear();
    var early = now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
    return early ? age - 1 : age;
  }
  window.addEventListener(PREFIX + EVENTS.confirm, confirmed);
  window.addEventListener(PREFIX + EVENTS.birthdate, function (event) {
    var detail = event && event.detail;
    var text = typeof detail === 'string' ? detail : detail && typeof detail.value === 'string' ? detail.value : '';
    if (!text) return;
    if (years(text) >= S.minimumAge) confirmed();
    else tell(EVENTS.tooYoung);
  });${controls}
  html.setAttribute(ATTR, wanted() ? 'open' : 'hidden');
  function onRoute() {
    setTimeout(apply, 0);
  }
  var push = history.pushState;
  var replace = history.replaceState;
  history.pushState = function () {
    push.apply(this, arguments);
    onRoute();
  };
  history.replaceState = function () {
    replace.apply(this, arguments);
    onRoute();
  };
  window.addEventListener('popstate', onRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();`
  return `<style>${style}</style><script>${script}</script>`
}
