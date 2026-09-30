/**
 * The discount engine — vouchers and automatic (code-less) discounts on a cart
 * — as ES5 source for embedding into generated runtime code (the storefront
 * provider, the `cart-get-total` workflow handler) that cannot import from
 * this package.
 *
 * ⚠️ THIRD MIRROR. The same arithmetic exists in teleport-gui as
 * `features/e-commerce/utils/discount-engine/discount-engine.ts` (the
 * editor/canvas copy) and
 * `features/workflows/templates/builders/ecommerce/discount-engine-script.ts`
 * (the copy baked into the checkout workflows, whose text this file carries
 * verbatim). All three must agree to the cent, or the discount the shopper
 * sees, the discount the payment provider charges and the discount stored on
 * the order will differ. `__tests__/utils/discount-engine.ts` runs this copy
 * over a fixture table that is byte-identical with the GUI's parity spec.
 *
 * The rules, in one place:
 *  - discounts are taken on the GROSS eligible subtotal, gross unit price
 *    rounded per unit before multiplying;
 *  - rules stack sequentially on what is left of their eligible lines, each
 *    rounding once, clamped to that remainder;
 *  - combinable rules price together by priority, a combinable voucher last;
 *    an exclusive discount (`stackable: false`, a rule or the voucher) is
 *    priced on its own; when several sets save something the shopper's
 *    `choice` picks one and every one comes back as `options`, otherwise the
 *    set that saves the most wins — a tie going to an exclusive voucher, then
 *    exclusive rules by priority, then the combination; a voucher left out is
 *    rejected `not-stackable` when it would have applied alone, else for its
 *    own reason;
 *  - free shipping waives the fee once; a gift-card line is never eligible;
 *  - `legacy` reproduces the pre-engine voucher rule for an older checkout.
 *
 * Everything is prefixed `__de` and declared as `var … = function` EXPRESSIONS
 * so the block can be spliced INTO a serialized handler body — the entry-point
 * resolver would otherwise mistake a declared 2-argument function for the
 * handler itself.
 */
export const generateDiscountEngineHelperCode = (): string =>
  [
    'var __deRound2 = function (n) { return Math.round(n * 100) / 100; };',
    'var __deSafe = function (n) {',
    '  var x = typeof n === "number" ? n : parseFloat(n);',
    '  return isFinite(x) ? x : 0;',
    '};',
    'var __deIsArray = function (v) { return Object.prototype.toString.call(v) === "[object Array]"; };',
    // Per-UNIT gross rounding before multiplying by quantity, as every money
    // rule in the store does.
    'var __deGrossUnit = function (netUnitPrice, taxRatePercent) {',
    '  var net = __deSafe(netUnitPrice);',
    '  if (taxRatePercent > 0) { return __deRound2(net * (1 + taxRatePercent / 100)); }',
    '  return net;',
    '};',
    // TEXT columns holding a JSON array (or, on a document store, a real array).
    // Anything unreadable means "nothing listed", never an exception in a
    // checkout.
    'var __deStringArray = function (raw) {',
    '  var source = raw;',
    '  if (typeof source === "string") {',
    '    if (source === "") { return []; }',
    '    try { source = JSON.parse(source); } catch (e) { return []; }',
    '  }',
    '  if (!__deIsArray(source)) { return []; }',
    '  var out = [];',
    '  for (var i = 0; i < source.length; i++) {',
    '    if (source[i] === null || source[i] === undefined || source[i] === "") { continue; }',
    '    out.push(String(source[i]));',
    '  }',
    '  return out;',
    '};',
    // Booleans arrive differently per driver (true / "t" / 1), so normalise once.
    'var __deBool = function (value, fallback) {',
    '  if (typeof value === "boolean") { return value; }',
    '  if (typeof value === "number") { return value !== 0; }',
    '  if (typeof value === "string") {',
    '    var s = value.toLowerCase();',
    '    if (s === "true" || s === "t" || s === "1" || s === "yes") { return true; }',
    '    if (s === "false" || s === "f" || s === "0" || s === "no") { return false; }',
    '  }',
    '  return fallback;',
    '};',
    'var __deNullableNumber = function (value) {',
    '  if (value === null || value === undefined || value === "") { return null; }',
    '  var x = typeof value === "number" ? value : parseFloat(value);',
    '  return isFinite(x) ? x : null;',
    '};',
    // Maps a `teleport_vouchers` or `teleport_discounts` row onto the rule shape.
    // `discount_type` is kept as read: a type this build does not know prices as
    // a no-op, never as a percentage.
    'var __deNormalizeRule = function (row, source) {',
    '  if (!row || typeof row !== "object") { return null; }',
    '  var priority = __deNullableNumber(row.priority);',
    '  var code = row.code ? String(row.code) : "";',
    '  return {',
    '    id: row.id ? String(row.id) : "",',
    '    source: source === "voucher" ? "voucher" : "automatic",',
    '    code: code,',
    '    name: row.name ? String(row.name) : code,',
    '    discountType: row.discount_type ? String(row.discount_type) : "percentage",',
    '    discountValue: __deSafe(row.discount_value),',
    '    appliesToAllProducts: __deBool(row.applies_to_all_products, true),',
    '    productIds: __deStringArray(row.product_ids),',
    '    categoryIds: __deStringArray(row.category_ids),',
    '    minOrderValue: __deNullableNumber(row.min_order_value),',
    '    minQuantity: __deNullableNumber(row.min_quantity),',
    '    firstOrderOnly: __deBool(row.first_order_only, false),',
    '    buyQuantity: __deNullableNumber(row.buy_quantity),',
    '    getQuantity: __deNullableNumber(row.get_quantity),',
    '    stackable: __deBool(row.stackable, true),',
    '    priority: priority === null ? 100 : priority',
    '  };',
    '};',
    // Cart lines as `cart-get-items` / the provider hold them: NET prices,
    // categories and the gift-card flag stamped by the add-to-cart node and the
    // provider's hydration. A caller with server product rows overlays those.
    'var __deLinesFromCart = function (cartItems) {',
    '  var lines = [];',
    '  if (!__deIsArray(cartItems)) { return lines; }',
    '  for (var i = 0; i < cartItems.length; i++) {',
    '    var item = cartItems[i];',
    '    if (!item || typeof item !== "object") { continue; }',
    '    lines.push({',
    '      productId: item.productId ? String(item.productId) : "",',
    '      unitPrice: __deSafe(item.price),',
    '      quantity: Math.max(0, Math.floor(__deSafe(item.quantity))),',
    '      categoryIds: __deStringArray(item.categoryIds),',
    '      isGiftCard: __deBool(item.isGiftCard, false),',
    // A recurring line is billed by the provider at the plan price every
    // cycle, so no discount ever touches it and no gift card pays for it.
    '      isRecurring: __deBool(item.isRecurring, false),',
    '      isDigital: __deBool(item.isDigital, false)',
    '    });',
    '  }',
    '  return lines;',
    '};',
    'var __deWorkingLines = function (lines, taxRatePercent) {',
    '  var working = [];',
    '  if (!__deIsArray(lines)) { return working; }',
    '  for (var i = 0; i < lines.length; i++) {',
    '    var line = lines[i];',
    '    if (!line || typeof line !== "object") { continue; }',
    '    var quantity = Math.max(0, Math.floor(__deSafe(line.quantity)));',
    '    if (quantity === 0) { continue; }',
    '    var unitGross = __deGrossUnit(line.unitPrice, taxRatePercent);',
    '    working.push({',
    '      productId: line.productId ? String(line.productId) : "",',
    '      quantity: quantity,',
    '      categoryIds: __deIsArray(line.categoryIds) ? line.categoryIds.map(String) : [],',
    '      isGiftCard: line.isGiftCard === true,',
    '      isRecurring: line.isRecurring === true,',
    '      remaining: unitGross * quantity',
    '    });',
    '  }',
    '  return working;',
    '};',
    'var __deCloneLines = function (lines) {',
    '  var out = [];',
    '  for (var i = 0; i < lines.length; i++) {',
    '    var l = lines[i];',
    '    out.push({ productId: l.productId, quantity: l.quantity, categoryIds: l.categoryIds, isGiftCard: l.isGiftCard, isRecurring: l.isRecurring, remaining: l.remaining });',
    '  }',
    '  return out;',
    '};',
    'var __deIsEligible = function (line, rule, legacy) {',
    '  if (line.isGiftCard || line.isRecurring) { return false; }',
    '  if (rule.appliesToAllProducts) { return true; }',
    '  if (rule.productIds.indexOf(line.productId) !== -1) { return true; }',
    '  if (legacy) { return false; }',
    '  for (var i = 0; i < rule.categoryIds.length; i++) {',
    '    if (line.categoryIds.indexOf(rule.categoryIds[i]) !== -1) { return true; }',
    '  }',
    '  return false;',
    '};',
    'var __deCompareRules = function (a, b) {',
    '  if (a.priority !== b.priority) { return a.priority < b.priority ? -1 : 1; }',
    '  if (a.name !== b.name) { return a.name < b.name ? -1 : 1; }',
    '  if (a.id !== b.id) { return a.id < b.id ? -1 : 1; }',
    '  return 0;',
    '};',
    'var __deRejected = function (reason, eligibleProductIds) {',
    '  return { rejection: reason, goodsDiscount: 0, shippingDiscount: 0, eligibleProductIds: eligibleProductIds };',
    '};',
    /*
     * Prices one rule against what is left of its eligible lines and, when it
     * applies, takes its amount off those lines. Mirrors `evaluateRule` in the
     * TypeScript twin field for field.
     */
    'var __deEvaluateRule = function (rule, lines, params) {',
    '  var eligible = [];',
    '  var eligibleProductIds = [];',
    '  var eligibleUnits = 0;',
    '  for (var i = 0; i < lines.length; i++) {',
    '    if (!__deIsEligible(lines[i], rule, params.legacy)) { continue; }',
    '    eligible.push(lines[i]);',
    '    eligibleUnits += lines[i].quantity;',
    '    if (eligibleProductIds.indexOf(lines[i].productId) === -1) { eligibleProductIds.push(lines[i].productId); }',
    '  }',
    '  if (!params.legacy) {',
    '    if (rule.minOrderValue !== null && params.cartGoodsGross < rule.minOrderValue) { return __deRejected("min-order", eligibleProductIds); }',
    '    if (rule.minQuantity !== null && eligibleUnits < rule.minQuantity) { return __deRejected("min-quantity", eligibleProductIds); }',
    '    if (rule.firstOrderOnly && params.isFirstOrder !== true) { return __deRejected("first-order", eligibleProductIds); }',
    '  }',
    '  if (rule.discountType === "free_shipping") {',
    '    var waived = __deRound2(Math.max(0, __deSafe(params.shippingPrice)));',
    '    if (params.shippingWaived || waived <= 0) { return __deRejected("no-op", eligibleProductIds); }',
    '    return { rejection: "", goodsDiscount: 0, shippingDiscount: waived, eligibleProductIds: eligibleProductIds };',
    '  }',
    '  var base = 0;',
    '  for (var b = 0; b < eligible.length; b++) { base += eligible[b].remaining; }',
    '  var roundedBase = __deRound2(base);',
    '  if (roundedBase <= 0) { return __deRejected("no-op", eligibleProductIds); }',
    '  if (rule.discountType === "percentage" || rule.discountType === "fixed") {',
    '    var value = Math.max(0, __deSafe(rule.discountValue));',
    '    var raw = rule.discountType === "percentage" ? (base * Math.min(value, 100)) / 100 : value;',
    '    var amount = Math.min(__deRound2(raw), roundedBase);',
    '    if (amount <= 0) { return __deRejected("no-op", eligibleProductIds); }',
    '    for (var p = 0; p < eligible.length; p++) {',
    '      eligible[p].remaining -= (eligible[p].remaining / base) * amount;',
    '    }',
    '    return { rejection: "", goodsDiscount: amount, shippingDiscount: 0, eligibleProductIds: eligibleProductIds };',
    '  }',
    '  if (rule.discountType === "buy_x_get_y" && !params.legacy) {',
    '    var buy = Math.floor(__deSafe(rule.buyQuantity));',
    '    var get = Math.floor(__deSafe(rule.getQuantity));',
    '    if (buy < 1 || get < 1) { return __deRejected("no-op", eligibleProductIds); }',
    '    var units = [];',
    '    for (var u = 0; u < eligible.length; u++) {',
    '      var unitValue = eligible[u].remaining / eligible[u].quantity;',
    '      for (var q = 0; q < eligible[u].quantity; q++) {',
    '        units.push({ line: eligible[u], value: unitValue, order: units.length });',
    '      }',
    '    }',
    '    units.sort(function (a, b) {',
    '      if (a.value !== b.value) { return a.value < b.value ? -1 : 1; }',
    '      return a.order - b.order;',
    '    });',
    '    var freeUnits = Math.floor(units.length / (buy + get)) * get;',
    '    var bogo = 0;',
    '    for (var f = 0; f < freeUnits; f++) {',
    '      bogo += units[f].value;',
    '      units[f].line.remaining -= units[f].value;',
    '    }',
    '    bogo = Math.min(__deRound2(bogo), roundedBase);',
    '    if (bogo <= 0) { return __deRejected("no-op", eligibleProductIds); }',
    '    return { rejection: "", goodsDiscount: bogo, shippingDiscount: 0, eligibleProductIds: eligibleProductIds };',
    '  }',
    '  return __deRejected("no-op", eligibleProductIds);',
    '};',
    /*
     * Prices one set of discounts that may share the order, sequentially on a
     * copy of the lines. Mirrors `priceCandidate` in the TypeScript twin.
     */
    'var __dePriceCandidate = function (candidate, lines, params) {',
    '  var working = __deCloneLines(lines);',
    '  var applied = [];',
    '  var shippingWaived = false;',
    '  var automaticGoods = 0;',
    '  var automaticShipping = 0;',
    '  var voucherGoods = 0;',
    '  var voucherShipping = 0;',
    '  var holdsVoucher = false;',
    '  var voucherApplied = false;',
    '  var voucherRejection = "";',
    '  var eligibleProductIds = [];',
    '  for (var c = 0; c < candidate.length; c++) {',
    '    var rule = candidate[c];',
    '    var isVoucher = rule.source === "voucher";',
    '    var evaluation = __deEvaluateRule(rule, working, {',
    '      cartGoodsGross: params.cartGoodsGross, shippingPrice: params.shippingPrice, shippingWaived: shippingWaived, isFirstOrder: params.isFirstOrder, legacy: params.legacy',
    '    });',
    '    if (isVoucher) { holdsVoucher = true; eligibleProductIds = evaluation.eligibleProductIds; }',
    '    if (evaluation.rejection !== "") {',
    '      if (isVoucher) { voucherRejection = evaluation.rejection; }',
    '      continue;',
    '    }',
    '    applied.push({ id: rule.id, source: isVoucher ? "voucher" : "automatic", code: isVoucher ? rule.code : "", name: rule.name, goodsDiscount: evaluation.goodsDiscount, shippingDiscount: evaluation.shippingDiscount, eligibleProductIds: evaluation.eligibleProductIds });',
    '    if (isVoucher) {',
    '      voucherApplied = true;',
    '      voucherGoods += evaluation.goodsDiscount;',
    '      voucherShipping += evaluation.shippingDiscount;',
    '    } else {',
    '      automaticGoods += evaluation.goodsDiscount;',
    '      automaticShipping += evaluation.shippingDiscount;',
    '    }',
    '    if (evaluation.shippingDiscount > 0) { shippingWaived = true; }',
    '  }',
    '  return {',
    '    applied: applied,',
    '    automaticGoods: automaticGoods,',
    '    automaticShipping: automaticShipping,',
    '    voucherGoods: voucherGoods,',
    '    voucherShipping: voucherShipping,',
    '    holdsVoucher: holdsVoucher,',
    '    voucherApplied: voucherApplied,',
    '    voucherRejection: voucherRejection,',
    '    eligibleProductIds: eligibleProductIds,',
    '    total: __deRound2(__deRound2(automaticGoods + voucherGoods) + __deRound2(Math.min(params.shippingPrice, automaticShipping + voucherShipping)))',
    '  };',
    '};',
    /*
     * THE rule. Mirrors `resolveCartDiscounts`: every set of discounts that may
     * share the order is priced on its own — each exclusive discount alone, the
     * combinable ones together. When several sets save something the shopper's
     * `choice` picks one and every one is offered back as `options`; otherwise
     * the set that saves the most wins, a tie going to the set listed first.
     */
    'var __deDescribeOption = function (applied) {',
    '  var names = [];',
    '  for (var d = 0; d < applied.length; d++) { names.push(applied[d].source === "voucher" ? "Code " + applied[d].code : applied[d].name); }',
    '  return names.join(", ");',
    '};',
    'var __deResolve = function (input) {',
    '  var legacy = input.legacy === true;',
    '  var taxRatePercent = __deSafe(input.taxRatePercent);',
    '  var lines = __deWorkingLines(input.lines, taxRatePercent);',
    '  var shippingPrice = Math.max(0, __deSafe(input.shippingPrice));',
    '  var isFirstOrder = input.customer && typeof input.customer.isFirstOrder === "boolean" ? input.customer.isFirstOrder : null;',
    '  var cartGoodsGross = 0;',
    '  for (var g = 0; g < lines.length; g++) { if (!lines[g].isGiftCard && !lines[g].isRecurring) { cartGoodsGross += lines[g].remaining; } }',
    '  cartGoodsGross = __deRound2(cartGoodsGross);',
    '  var voucher = input.voucher || null;',
    '  var rules = legacy || !__deIsArray(input.rules) ? [] : input.rules.slice().sort(__deCompareRules);',
    '  var params = { cartGoodsGross: cartGoodsGross, shippingPrice: shippingPrice, isFirstOrder: isFirstOrder, legacy: legacy };',
    '  var candidates = [];',
    '  var combination = [];',
    '  if (voucher && !legacy && !voucher.stackable) { candidates.push({ key: "voucher", rules: [voucher] }); }',
    '  for (var r = 0; r < rules.length; r++) {',
    '    if (rules[r].stackable) { combination.push(rules[r]); } else { candidates.push({ key: rules[r].id, rules: [rules[r]] }); }',
    '  }',
    '  if (voucher && (legacy || voucher.stackable)) { combination.push(voucher); }',
    '  candidates.push({ key: "combination", rules: combination });',
    '  var priced = [];',
    '  for (var k = 0; k < candidates.length; k++) { priced.push({ key: candidates[k].key, pricing: __dePriceCandidate(candidates[k].rules, lines, params) }); }',
    '  var winner = priced[0];',
    '  for (var w = 1; w < priced.length; w++) { if (priced[w].pricing.total > winner.pricing.total) { winner = priced[w]; } }',
    '  var choosable = [];',
    '  for (var s = 0; s < priced.length; s++) { if (priced[s].pricing.total > 0) { choosable.push(priced[s]); } }',
    '  var options = [];',
    '  var choice = "";',
    '  if (choosable.length > 1) {',
    '    for (var p = 0; p < choosable.length; p++) { if (choosable[p].key === input.choice) { winner = choosable[p]; } }',
    '    choice = winner.key;',
    '    for (var o = 0; o < choosable.length; o++) {',
    '      options.push({ key: choosable[o].key, label: __deDescribeOption(choosable[o].pricing.applied), saving: choosable[o].pricing.total, selected: choosable[o] === winner });',
    '    }',
    '  }',
    '  var best = winner.pricing;',
    '  var voucherRejection = best.voucherRejection;',
    '  var eligibleProductIds = best.eligibleProductIds;',
    '  if (voucher && !best.holdsVoucher) {',
    '    var alone = __dePriceCandidate([voucher], lines, params);',
    '    voucherRejection = alone.voucherApplied ? "not-stackable" : alone.voucherRejection;',
    '    eligibleProductIds = alone.eligibleProductIds;',
    '  }',
    '  return {',
    '    applied: best.applied,',
    '    goodsDiscount: __deRound2(best.automaticGoods + best.voucherGoods),',
    '    shippingDiscount: __deRound2(Math.min(shippingPrice, best.automaticShipping + best.voucherShipping)),',
    '    automaticGoodsDiscount: __deRound2(best.automaticGoods),',
    '    automaticShippingDiscount: __deRound2(best.automaticShipping),',
    '    voucherGoodsDiscount: __deRound2(best.voucherGoods),',
    '    voucherShippingDiscount: __deRound2(best.voucherShipping),',
    '    voucherApplied: best.voucherApplied,',
    '    voucherRejection: voucherRejection,',
    '    eligibleProductIds: eligibleProductIds,',
    '    options: options,',
    '    choice: choice',
    '  };',
    '};',
    // The provider's published minimums, in major units; default 0.50.
    'var __deMinimumCharge = function (currency) {',
    '  var table = { USD: 0.5, EUR: 0.5, GBP: 0.3, AUD: 0.5, CAD: 0.5, NZD: 0.5, SGD: 0.5, CHF: 0.5, BRL: 0.5, INR: 0.5, AED: 2, BGN: 1, CZK: 15, DKK: 2.5, HKD: 4, HUF: 175, JPY: 50, MXN: 10, MYR: 2, NOK: 3, PLN: 2, RON: 2, SEK: 3, THB: 10 };',
    '  var code = String(currency || "").toUpperCase();',
    '  return typeof table[code] === "number" ? table[code] : 0.5;',
    '};',
    // How much of an order a gift card pays. Mirrors `resolveGiftCardTender`.
    'var __deTender = function (input) {',
    '  var balance = Math.max(0, __deSafe(input.balance));',
    '  var total = Math.max(0, __deRound2(__deSafe(input.total)));',
    // A recurring cart whose first charge is a free trial has nothing for a
    // card to pay, and neither has one whose checkout cannot hand the provider
    // a reduced first charge; otherwise the card pays part of the first charge
    // only, and the provider keeps at least its minimum to collect the payment
    // method that bills every later cycle.
    '  var recurringRefused = input.hasRecurringLines && !input.recurringTenderAllowed;',
    '  if (input.hasGiftCardLines || input.hasRecurringTrial || recurringRefused || balance <= 0 || total <= 0) { return { applied: 0, amountDue: total }; }',
    '  var minimum = __deMinimumCharge(input.currency);',
    '  var applied = Math.min(balance, total);',
    '  if (input.hasRecurringLines) { applied = Math.min(applied, Math.max(0, __deRound2(total - minimum))); }',
    '  var remaining = __deRound2(total - applied);',
    '  if (remaining > 0 && remaining < minimum) { applied = Math.max(0, __deRound2(total - minimum)); }',
    '  applied = __deRound2(applied);',
    '  return { applied: applied, amountDue: __deRound2(total - applied) };',
    '};',
  ].join('\n')

/** The automatic-discount rules table the storefront reads. */
export const DISCOUNTS_TABLE = 'teleport_discounts'

/**
 * How many live automatic rules any reader loads — the storefront feed, the
 * place-order workflow and the editor — each ordered the way the engine
 * applies them (priority, name, id), so all three price the same set. The
 * editor refuses a live rule past it.
 */
export const DISCOUNT_RULES_LIMIT = 500

/**
 * The applied gift card the checkout keeps beside the cart — display data
 * returned by the Apply Gift Card workflow (`{ id, last4, balance, currency,
 * checkedAt }`), never the full code, never trusted for money. ⚠️
 * `cart-get-total` and `cart-clear` spell the same key out as a literal — a
 * serialized handler has no module scope to import it from.
 */
export const GIFT_CARD_STORAGE_KEY = 'workflow_gift_card'

/** Broadcast when the applied gift card changes. */
export const GIFT_CARD_CHANGED_EVENT = 'teleport:gift-card-changed'

/**
 * Broadcast by the place-order workflow when the server priced the order
 * differently from the summary, so the provider re-reads rules and customer.
 */
export const DISCOUNTS_REFRESH_EVENT = 'teleport:discounts-refresh'

/** Broadcast once the checkout page-load workflow has written `customer`. */
export const CUSTOMER_CHANGED_EVENT = 'teleport:customer-changed'

/**
 * The localStorage key holding the set of discounts the shopper chose when
 * several could apply but not together (a `DiscountOption.key`: an exclusive
 * rule's id, `voucher`, or `combination`). ⚠️ `cart-get-total` and `cart-clear`
 * spell the key out as a literal — a serialized handler has no module scope.
 */
export const DISCOUNT_CHOICE_STORAGE_KEY = 'workflow_discount_choice'

/** Broadcast when the shopper's discount choice changes. */
export const DISCOUNT_CHOICE_CHANGED_EVENT = 'teleport:discount-choice-changed'
