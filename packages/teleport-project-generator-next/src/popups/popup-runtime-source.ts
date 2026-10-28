/**
 * The published site's popup runtime: an inline script in `_document`'s
 * `<head>`, right after `window.__tqPopups = <UIDLPopupConfig>` (see
 * project-plugin.ts). Dependency-free ES5, so it runs before any bundle.
 *
 * Each popup is a component instance at the end of every page (the editor's
 * mapper puts it there). Its open workflow listens for the window event
 * `workflow:custom:tq-popup-open-<id>`, and its card — drawn only while it is
 * open — carries `data-tq-popup-root="<id>"`. This script decides whether and
 * when to send that event; everything the visitor sees is the component.
 *
 * Per page view (on load and on every client-side route change, i.e. a new
 * pathname through `history.pushState`/`replaceState` or `popstate`):
 *  - nothing on an excluded path, nor on a page showing a checkout or
 *    purchase view (`data-tq-commerce-view`, checked again when it fires);
 *  - the first eligible popup: an `only` rule naming the path beats an
 *    `except` rule beats `all`, then the newer (later in the list); eligible =
 *    not shown within its frequency (`tq_popup:<id>` in localStorage, or
 *    sessionStorage for once per session) and the right audience (returning =
 *    `tq_popup_visited` was already set when this document loaded; it is set
 *    at the end of every evaluation);
 *  - its trigger armed: exit intent on computers (>= 1024px), the delay, the
 *    scroll depth, or the next frame — the phone trigger below 1024px;
 *  - one popup per page view: once it has been shown nothing else opens until
 *    the next route change.
 *
 * Opening: the event is sent again every half second (for up to ten seconds)
 * until the card is on the page — the component's listener is attached only
 * once the page has hydrated, which a head script cannot wait for. Only then
 * is the popup counted shown: the frequency is written and `popup_shown`
 * tracked.
 *
 * While a card is open: a click on a `[data-tq-popup-convert]` control or a
 * form submit inside it tracks `popup_converted` (once per opening); a
 * converting link also closes the popup right after the click (closing it
 * during the click would take the link out of the page before it can
 * navigate); `[data-tq-popup-code]` copies its code and says "Copied" for a
 * moment; Escape closes a corner or bottom popup (a centred one is a modal
 * dialog with its own Escape). Closing = clicking the card's ✕, so the
 * component's own close workflow runs.
 *
 * Analytics go through `window.tpAnalytics.track(name, { recordId })` when the
 * tracker is on the page; nothing here throws without it.
 *
 * ⛔ Shipped as the body of a template literal: no backticks, no dollar-brace,
 * and no closing-tag sequence anywhere in it.
 */
export const POPUP_RUNTIME_SOURCE = `(function () {
  var config = window.__tqPopups;
  if (!config || !config.popups || !config.popups.length) {
    return;
  }
  var POPUPS = config.popups;
  var EXCLUDED_PATHS = config.excludedPaths || [];
  var OPEN_EVENT_PREFIX = 'workflow:custom:tq-popup-open-';
  var ROOT_ATTR = 'data-tq-popup-root';
  var CODE_ATTR = 'data-tq-popup-code';
  var CONVERT_SELECTOR = '[data-tq-popup-convert]';
  var CLOSE_SELECTOR = '[data-thq="thq-modal-close-button"]';
  var CHECKOUT_SELECTOR = '[data-tq-commerce-view="begin_checkout"],[data-tq-commerce-view="purchase"]';
  var FREQUENCY_PREFIX = 'tq_popup:';
  var VISITED_KEY = 'tq_popup_visited';
  var DESKTOP_QUERY = '(min-width: 1024px)';
  var DESKTOP_MIN_WIDTH = 1024;
  var DAY_MS = 86400000;
  var OPEN_RETRY_MS = 500;
  var OPEN_ATTEMPTS = 20;
  var COPIED_LABEL = 'Copied';
  var COPIED_MS = 1500;
  var SHOW_TEXT = 4;

  var run = 0;
  var cleanups = [];
  var currentPath = null;
  var openings = {};

  function read(area, key) {
    try {
      var store = window[area];
      return store ? store.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function write(area, key, value) {
    try {
      var store = window[area];
      if (store) {
        store.setItem(key, value);
      }
    } catch (e) {}
  }

  var returning = read('localStorage', VISITED_KEY) !== null;

  function track(name, id) {
    try {
      var analytics = window.tpAnalytics;
      if (analytics && typeof analytics.track === 'function') {
        analytics.track(name, { recordId: id });
      }
    } catch (e) {}
  }

  function later(fn, ms) {
    var token = run;
    var timer = window.setTimeout(function () {
      if (token === run) {
        fn();
      }
    }, ms);
    cleanups.push(function () {
      window.clearTimeout(timer);
    });
  }

  function nextFrame(fn) {
    if (typeof window.requestAnimationFrame !== 'function') {
      later(fn, 0);
      return;
    }
    var token = run;
    var frame = window.requestAnimationFrame(function () {
      if (token === run) {
        fn();
      }
    });
    cleanups.push(function () {
      window.cancelAnimationFrame(frame);
    });
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(function () {
      target.removeEventListener(type, handler, options);
    });
  }

  function cancel() {
    run++;
    var pending = cleanups;
    cleanups = [];
    for (var i = 0; i < pending.length; i++) {
      try {
        pending[i]();
      } catch (e) {}
    }
  }

  function normalizePath(path) {
    var clean = String(path || '/').split('?')[0].split('#')[0] || '/';
    while (clean.length > 1 && clean.charAt(clean.length - 1) === '/') {
      clean = clean.slice(0, -1);
    }
    return clean;
  }

  function pathMatches(path, pattern) {
    if (typeof pattern !== 'string' || !pattern) {
      return false;
    }
    if (pattern.charAt(pattern.length - 1) === '*') {
      return path.indexOf(pattern.slice(0, -1)) === 0;
    }
    return path === normalizePath(pattern);
  }

  function matchesAny(path, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      if (pathMatches(path, patterns[i])) {
        return true;
      }
    }
    return false;
  }

  function pageRank(popup, path) {
    var rule = popup.pages || {};
    var paths = rule.paths || [];
    if (rule.mode === 'only') {
      return matchesAny(path, paths) ? 3 : 0;
    }
    if (rule.mode === 'except') {
      return matchesAny(path, paths) ? 0 : 2;
    }
    return 1;
  }

  function storageAreaFor(popup) {
    return popup.frequency && popup.frequency.kind === 'session' ? 'sessionStorage' : 'localStorage';
  }

  function shownRecently(popup) {
    var frequency = popup.frequency || {};
    var last = read(storageAreaFor(popup), FREQUENCY_PREFIX + popup.id);
    if (last === null) {
      return false;
    }
    if (frequency.kind === 'once' || frequency.kind === 'session') {
      return true;
    }
    var shownAt = Number(last);
    if (!shownAt) {
      return false;
    }
    return Date.now() - shownAt < (Number(frequency.days) || 0) * DAY_MS;
  }

  function audienceAllows(popup) {
    if (popup.audience === 'new') {
      return !returning;
    }
    if (popup.audience === 'returning') {
      return returning;
    }
    return true;
  }

  function pickPopup(path) {
    var ranked = [];
    for (var i = 0; i < POPUPS.length; i++) {
      var rank = pageRank(POPUPS[i], path);
      if (rank > 0) {
        ranked.push({ popup: POPUPS[i], rank: rank, index: i });
      }
    }
    ranked.sort(function (a, b) {
      return b.rank - a.rank || b.index - a.index;
    });
    for (var j = 0; j < ranked.length; j++) {
      if (!shownRecently(ranked[j].popup) && audienceAllows(ranked[j].popup)) {
        return ranked[j].popup;
      }
    }
    return null;
  }

  function popupById(id) {
    for (var i = 0; i < POPUPS.length; i++) {
      if (POPUPS[i].id === id) {
        return POPUPS[i];
      }
    }
    return null;
  }

  function checkoutOnScreen() {
    return !!document.querySelector(CHECKOUT_SELECTOR);
  }

  function isComputer() {
    try {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia(DESKTOP_QUERY).matches;
      }
    } catch (e) {}
    return window.innerWidth >= DESKTOP_MIN_WIDTH;
  }

  function scrolledPercent() {
    var root = document.documentElement;
    var height = Math.max(root.scrollHeight || 0, document.body ? document.body.scrollHeight || 0 : 0);
    var room = height - window.innerHeight;
    if (room <= 0) {
      return 100;
    }
    var top = window.pageYOffset || root.scrollTop || 0;
    return (top / room) * 100;
  }

  function cardOf(id) {
    var cards = document.querySelectorAll('[' + ROOT_ATTR + ']');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute(ROOT_ATTR) === id) {
        return cards[i];
      }
    }
    return null;
  }

  function onPage(element) {
    return !!element && document.documentElement.contains(element);
  }

  function closeCard(card) {
    var button = card.querySelector(CLOSE_SELECTOR);
    if (onPage(button)) {
      button.click();
    }
  }

  function markShown(popup) {
    write(storageAreaFor(popup), FREQUENCY_PREFIX + popup.id, String(Date.now()));
    openings[popup.id] = { converted: false };
    track('popup_shown', popup.id);
  }

  function openPopup(popup) {
    var attempts = 0;
    var settled = false;
    var observer = null;
    function settle() {
      settled = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }
    function checkCard() {
      if (!settled && cardOf(popup.id)) {
        settle();
        markShown(popup);
      }
    }
    function send() {
      if (settled) {
        return;
      }
      if (checkoutOnScreen()) {
        settle();
        return;
      }
      attempts++;
      window.dispatchEvent(new window.CustomEvent(OPEN_EVENT_PREFIX + popup.id, { detail: {} }));
      checkCard();
      if (settled) {
        return;
      }
      if (attempts < OPEN_ATTEMPTS) {
        later(send, OPEN_RETRY_MS);
      } else {
        settle();
      }
    }
    if (typeof window.MutationObserver === 'function') {
      observer = new window.MutationObserver(checkCard);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      cleanups.push(settle);
    }
    send();
  }

  function arm(popup) {
    var fired = false;
    function fire() {
      if (fired) {
        return;
      }
      fired = true;
      if (!checkoutOnScreen()) {
        openPopup(popup);
      }
    }
    var trigger = popup.trigger || {};
    var kind = isComputer() ? trigger.desktop : trigger.phone;
    if (kind === 'exit-intent') {
      listen(document, 'mouseout', function (event) {
        if (!event.relatedTarget && event.clientY <= 0) {
          fire();
        }
      });
    } else if (kind === 'scroll') {
      var depth = Number(trigger.scrollPercent) || 0;
      listen(
        window,
        'scroll',
        function () {
          if (scrolledPercent() >= depth) {
            fire();
          }
        },
        { passive: true }
      );
    } else if (kind === 'delay') {
      later(fire, Math.max(0, Number(trigger.delaySeconds) || 0) * 1000);
    } else {
      nextFrame(fire);
    }
  }

  function evaluate() {
    cancel();
    currentPath = normalizePath(window.location.pathname);
    try {
      if (!matchesAny(currentPath, EXCLUDED_PATHS) && !checkoutOnScreen()) {
        var popup = pickPopup(currentPath);
        if (popup) {
          arm(popup);
        }
      }
    } catch (e) {}
    write('localStorage', VISITED_KEY, '1');
  }

  function onRouteChange() {
    try {
      var path = normalizePath(window.location.pathname);
      if (path === currentPath) {
        return;
      }
      cancel();
      currentPath = path;
      later(evaluate, 0);
    } catch (e) {}
  }

  function patchHistory(method) {
    var history = window.history;
    var original = history && history[method];
    if (typeof original !== 'function') {
      return;
    }
    history[method] = function () {
      var result = original.apply(this, arguments);
      onRouteChange();
      return result;
    };
  }

  function elementOf(target) {
    if (!target) {
      return null;
    }
    return target.nodeType === 1 ? target : target.parentElement || null;
  }

  function cardAround(element) {
    return element && typeof element.closest === 'function' ? element.closest('[' + ROOT_ATTR + ']') : null;
  }

  function converted(id) {
    var opening = openings[id];
    if (opening && opening.converted) {
      return;
    }
    openings[id] = { converted: true };
    track('popup_converted', id);
  }

  function labelNode(element) {
    var walker = document.createTreeWalker(element, SHOW_TEXT);
    var node = walker.nextNode();
    while (node && !String(node.nodeValue).trim()) {
      node = walker.nextNode();
    }
    return node;
  }

  function sayCopied(button) {
    var node = labelNode(button);
    if (!node) {
      return;
    }
    if (button.__tqCopiedTimer) {
      window.clearTimeout(button.__tqCopiedTimer);
    } else {
      button.__tqCopiedLabel = node.nodeValue;
    }
    node.nodeValue = COPIED_LABEL;
    button.__tqCopiedTimer = window.setTimeout(function () {
      button.__tqCopiedTimer = null;
      if (node.nodeValue === COPIED_LABEL) {
        node.nodeValue = button.__tqCopiedLabel;
      }
    }, COPIED_MS);
  }

  function copyWithTextarea(text, host) {
    var parent = onPage(host) ? host : document.body;
    var focused = document.activeElement;
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    parent.appendChild(area);
    var copied = false;
    try {
      area.focus();
      area.select();
      copied = document.execCommand('copy') === true;
    } catch (e) {}
    parent.removeChild(area);
    if (focused && typeof focused.focus === 'function') {
      focused.focus();
    }
    return copied;
  }

  function copyCode(button, card) {
    var code = button.getAttribute(CODE_ATTR);
    if (!code) {
      return;
    }
    function fallback() {
      if (copyWithTextarea(code, card)) {
        sayCopied(button);
      }
    }
    try {
      var clipboard = window.navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(code).then(function () {
          sayCopied(button);
        }, fallback);
        return;
      }
    } catch (e) {}
    fallback();
  }

  function onClick(event) {
    try {
      var target = elementOf(event.target);
      var card = cardAround(target);
      if (!card) {
        return;
      }
      var codeButton = target.closest('[' + CODE_ATTR + ']');
      if (codeButton && card.contains(codeButton)) {
        copyCode(codeButton, card);
      }
      var control = target.closest(CONVERT_SELECTOR);
      if (control && card.contains(control)) {
        converted(card.getAttribute(ROOT_ATTR));
        var link = target.closest('a[href]');
        if (link && card.contains(link)) {
          window.setTimeout(function () {
            closeCard(card);
          }, 0);
        }
      }
    } catch (e) {}
  }

  function onSubmit(event) {
    try {
      var card = cardAround(elementOf(event.target));
      if (card) {
        converted(card.getAttribute(ROOT_ATTR));
      }
    } catch (e) {}
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') {
      return;
    }
    try {
      var cards = document.querySelectorAll('[' + ROOT_ATTR + ']');
      for (var i = 0; i < cards.length; i++) {
        var popup = popupById(cards[i].getAttribute(ROOT_ATTR));
        if (popup && (popup.layout === 'corner' || popup.layout === 'bottom')) {
          closeCard(cards[i]);
        }
      }
    } catch (e) {}
  }

  try {
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('keydown', onKeyDown);
    patchHistory('pushState');
    patchHistory('replaceState');
    window.addEventListener('popstate', onRouteChange);
    currentPath = normalizePath(window.location.pathname);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', evaluate);
    } else {
      evaluate();
    }
  } catch (e) {}
})();`
