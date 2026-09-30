/**
 * The currency a cart is priced in, as ES5 source for generated runtime code
 * (the add-to-cart node, the storefront cart provider, the cart total and the
 * checkout's server pricing step) that cannot import from this package.
 *
 * Every product carries its own currency, and nothing converts between them:
 * an order is recorded and charged in ONE currency, so a cart holds products
 * of one currency only — the same way it holds one kind of line (see the kind
 * rule beside it in `cart-add-item`). The cart's currency is the currency of
 * its lines; a line that names none (a cart saved before lines carried it)
 * takes no part in the rule.
 *
 * ⚠️ PAIRED with teleport-gui's cart simulator
 * (`features/e-commerce/utils/cart-kinds.ts`): the refusal reason and message
 * must stay byte-identical to what the published store toasts.
 *
 * ⛔ Every helper takes ONE parameter. The block is appended to a serialized
 * handler whose entry point a minified build finds by arity (a 2-param
 * declaration wins — see `resolveHandlerEntryName`), so a 2-param helper would
 * be called in place of the handler. Everything is prefixed `__cc` so the block
 * can be concatenated into any generated module without colliding with its
 * locals.
 */

/** The reason an add-to-cart refusal answers for a line of another currency. */
export const MIXED_CURRENCY_REASON = 'mixed-currency'

export const generateCartCurrencyHelperCode = (): string => `
// ── Cart currency ────────────────────────────────────────────────────────────
// A three-letter ISO code, upper-cased, or '' for anything else.
function __ccCode(value) {
  var code = String(value == null ? '' : value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

// The currency of the cart: the first line that names one, or ''.
function __ccCartCurrency(lines) {
  if (!lines || typeof lines.length !== 'number') { return ''; }
  for (var i = 0; i < lines.length; i++) {
    var code = __ccCode(lines[i] ? lines[i].currency : '');
    if (code) { return code; }
  }
  return '';
}

// Every currency the lines name, in the order they first appear.
function __ccCurrencies(lines) {
  var codes = [];
  if (!lines || typeof lines.length !== 'number') { return codes; }
  for (var i = 0; i < lines.length; i++) {
    var code = __ccCode(lines[i] ? lines[i].currency : '');
    if (code && codes.indexOf(code) === -1) { codes.push(code); }
  }
  return codes;
}

// Why a line priced in \`input.currency\` cannot join \`input.lines\` (the OTHER
// lines of the cart), or null when it can.
function __ccCurrencyRefusal(input) {
  var lineCurrency = __ccCode(input ? input.currency : '');
  var cartCurrency = __ccCartCurrency(input ? input.lines : null);
  if (!lineCurrency || !cartCurrency || lineCurrency === cartCurrency) { return null; }
  return {
    added: false,
    reason: '${MIXED_CURRENCY_REASON}',
    message: 'Products priced in ' + lineCurrency + ' need a separate order. Complete your current order or remove the items priced in ' + cartCurrency + ' from your cart first.'
  };
}

// What the checkout says when a cart still holds several currencies (a cart
// merged at sign-in, or a product whose currency changed after it was added).
function __ccMixedCartMessage(codes) {
  var named = codes.length > 1 ? codes.slice(0, -1).join(', ') + ' and ' + codes[codes.length - 1] : codes.join('');
  return 'Your cart holds products priced in ' + named + '. Each currency needs its own order: remove the products priced in one of them and try again.';
}
`
