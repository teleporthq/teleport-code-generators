/**
 * The per-product discount rule, as ES5 source for embedding into generated
 * runtime code (the data-source product transform, the storefront cart
 * provider) that cannot import from this package.
 *
 * ⚠️ THIRD MIRROR. The same arithmetic exists in teleport-gui as
 * `features/e-commerce/utils/product-discounts.ts` (the editor/canvas copy) and
 * `features/workflows/templates/builders/ecommerce/product-discount-script.ts`
 * (the copy baked into the add-to-cart workflow). All three must agree to the
 * cent, or the price on the card, the price added to the cart and the price
 * stored on the order will differ. The GUI's
 * `utils/__tests__/product-discount-parity.spec.ts` pins the first two together;
 * this one is covered by `__tests__/product-discounts.test.ts` here.
 *
 * Two rules the whole feature rests on:
 *
 *  - Discounts come off the NET price, BEFORE storefront tax. Tax is a
 *    percentage of what is actually charged.
 *  - The stored `price` column never changes. A discount is a scheduled VIEW of
 *    the price, resolved on every read, so it starts and expires on its own.
 *
 * Everything is prefixed `__pd` so the block can be concatenated into any
 * generated module without colliding with its locals — including alongside the
 * `applyStorefrontTax` helpers, which it is always emitted with.
 */
export const generateProductDiscountHelperCode = (): string => `
// ── Per-product discounts ────────────────────────────────────────────────────
// Rides the product row as a JSON \`discounts\` column: an array of
// { id, type: 'percentage'|'fixed', value, startsAt, endsAt } with ISO UTC
// bounds and a HALF-OPEN [startsAt, endsAt) window, so back-to-back discounts
// hand over with no overlap and no gap.
function __pdRound2(n) { return Math.round(n * 100) / 100; }

function __pdSafe(n) {
  var x = typeof n === 'number' ? n : parseFloat(n);
  return isFinite(x) ? x : 0;
}

// A bound that was written but cannot be read makes the window meaningless, so
// the entry is dropped rather than silently becoming unbounded.
function __pdBound(value) {
  if (value === null || value === undefined || value === '') { return { ok: true, time: null }; }
  var parsed = Date.parse(String(value));
  if (!isFinite(parsed)) { return { ok: false, time: null }; }
  return { ok: true, time: parsed };
}

// The column arrives as JSON text on SQL backends and as a real array on the
// document stores, and it is hand-editable through the admin panel. Anything
// unparseable means "no discounts" rather than an exception inside a render.
function __pdParseDiscounts(raw) {
  var source = raw;
  if (typeof source === 'string') {
    if (source === '') { return []; }
    try { source = JSON.parse(source); } catch (e) { return []; }
  }
  if (Object.prototype.toString.call(source) !== '[object Array]') { return []; }
  var out = [];
  for (var i = 0; i < source.length; i++) {
    var entry = source[i];
    if (!entry || typeof entry !== 'object') { continue; }
    if (entry.type !== 'percentage' && entry.type !== 'fixed') { continue; }
    var value = __pdSafe(entry.value);
    if (value <= 0) { continue; }
    if (entry.type === 'percentage' && value > 100) { continue; }
    var start = __pdBound(entry.startsAt);
    var end = __pdBound(entry.endsAt);
    if (!start.ok || !end.ok) { continue; }
    out.push({
      type: entry.type,
      value: value,
      startTime: start.time === null ? -Infinity : start.time,
      endTime: end.time === null ? Infinity : end.time
    });
  }
  return out;
}

// Valid data has at most one live entry — the merchant panel refuses
// overlapping windows — but the column is hand-editable, so first-live-wins
// keeps the runtime deterministic instead of trusting.
function __pdResolveActive(raw, nowMs) {
  var list = __pdParseDiscounts(raw);
  var now = isFinite(nowMs) ? Number(nowMs) : Date.now();
  for (var i = 0; i < list.length; i++) {
    if (list[i].startTime <= now && now < list[i].endTime) {
      return { type: list[i].type, value: list[i].value };
    }
  }
  return null;
}

// NET in, NET out — tax is added on top of the result. Clamped at both ends: a
// fixed amount larger than the price makes the product free, never negative.
function __pdDiscountedPrice(netPrice, discount) {
  var base = __pdRound2(__pdSafe(netPrice));
  if (base <= 0) { return Math.max(0, base); }
  if (!discount) { return base; }
  var value = Math.max(0, __pdSafe(discount.value));
  var discounted = discount.type === 'percentage'
    ? base * (1 - Math.min(value, 100) / 100)
    : base - value;
  return Math.max(0, __pdRound2(discounted));
}

function __pdDiscountAmount(netPrice, discount) {
  var base = Math.max(0, __pdRound2(__pdSafe(netPrice)));
  return __pdRound2(base - __pdDiscountedPrice(base, discount));
}

// "10% off" / "$10 off" / "10 kr off" — the badge copy. Symbol-based rather
// than Intl-based, because it sits beside prices the storefront renders as a
// symbol glued to two decimals.
function __pdDiscountLabel(discount, currencySymbol, symbolPosition) {
  if (!discount) { return ''; }
  var value = __pdSafe(discount.value);
  var text = (Math.round(value * 100) / 100).toString();
  if (discount.type === 'percentage') { return text + '% off'; }
  var symbol = currencySymbol || '$';
  return (symbolPosition === 'after' ? text + ' ' + symbol : symbol + text) + ' off';
}
`
