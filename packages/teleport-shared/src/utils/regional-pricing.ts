/**
 * Regional pricing — shipping zones and tax jurisdictions — as ES5 source for
 * the generated storefront (the cart provider and the `cart-get-total` workflow
 * handler), which cannot import from this package at runtime.
 *
 * ⚠️ SECOND MIRROR. The editor/canvas copy is teleport-gui's
 * `features/e-commerce/utils/regional-pricing/`, and the two must agree to the
 * cent or the canvas previews one delivery fee and the published store charges
 * another. The GUI's `regional-pricing-parity.spec.ts` and this package's
 * `__tests__/utils/regional-pricing.ts` run the SAME fixture table against their
 * respective copies.
 *
 * The rules the feature rests on:
 *
 *  - The store's Delivery Settings price every delivered order — the flat fee
 *    and, when switched on, the free-delivery threshold — and a zone OVERRIDES
 *    them for the countries it lists (a rest-of-world zone, for every country
 *    no other zone lists). No active tax row means the store's single default
 *    rate. Empty tables reproduce what the store charged before regions existed.
 *  - Tax stays folded into the prices a shopper reads, exactly like the store
 *    default: `goodsTax` is only the tax ADDED on top. A region whose prices
 *    already include tax contributes to the breakdown, never to the total.
 *  - Shipping tax, when a region charges it, is folded into the shipping amount.
 *  - Tax follows the checkout address for every order. Fulfilment only decides
 *    shipping: a store-pickup order never pays it, and is never refused for an
 *    address no zone covers.
 *  - A zone with no active rate charges the store's delivery fee under its own
 *    threshold and cash-on-delivery rule. A zone whose rates exist but none
 *    fits the basket is NO-RATE, which checkout refuses rather than pricing at 0.
 *  - A zone marked "do not ship" is UNAVAILABLE: the merchant's explicit
 *    refusal (on a rest-of-world zone, "only my zones"). Store pickup is never
 *    refused, since a pickup order is never priced as a delivery.
 *
 * Everything is prefixed `__rp` so the block can be concatenated into any
 * generated module without colliding with its locals.
 */
export const generateRegionalPricingHelperCode = (): string => `
// ── Regional pricing: shipping zones + tax jurisdictions ─────────────────────
// Every helper is a function EXPRESSION, never a declaration: this block is
// spliced into serialized workflow handlers, whose entry point is found by
// scanning for declared functions of handler arity — a declared two-argument
// helper would be mistaken for the entry once a minifier renames it.
// Currencies whose smallest unit is the whole unit (Stripe's zero-decimal list).
var __RP_ZERO_DECIMAL_CURRENCIES = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];

var __rpDecimals = function (currency) {
  var code = String(currency || '').toUpperCase();
  return __RP_ZERO_DECIMAL_CURRENCIES.indexOf(code) === -1 ? 2 : 0;
};

var __rpRound = function (value, decimals) {
  var factor = decimals === 0 ? 1 : 100;
  var n = Number(value);
  return Math.round((isFinite(n) ? n : 0) * factor) / factor;
};

// A finite number, or null for anything that is not one — including '' and
// null, which a nullable DECIMAL column hands back for "not set".
var __rpNumber = function (value) {
  if (value === null || value === undefined || value === '') return null;
  var n = typeof value === 'number' ? value : parseFloat(value);
  return isFinite(n) ? n : null;
};

// Booleans arrive differently per driver (true / 't' / 1 / 'true').
var __rpBool = function (value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    var s = value.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === 'f' || s === '0' || s === 'no') return false;
  }
  return fallback;
};

var __rpText = function (value) {
  return value === null || value === undefined ? '' : String(value).trim();
};

// A state / region name as matched: case- and spacing-insensitive, so a buyer's
// "new  york" still finds the "New York" row.
var __rpRegion = function (value) {
  return __rpText(value).replace(/\\s+/g, ' ').toLowerCase();
};

var __rpStringArray = function (raw) {
  if (Object.prototype.toString.call(raw) === '[object Array]') return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  var text = raw.trim();
  if (text.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(text);
      return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return text.split(/[\\s,;]+/);
};

// ISO 3166-1 alpha-2 codes, upper-cased and de-duplicated. Accepts a JSON array
// or a comma/space/semicolon separated list, which is what a merchant types
// into the generated admin.
var __rpParseCountries = function (raw) {
  var entries = __rpStringArray(raw);
  var codes = [];
  for (var i = 0; i < entries.length; i++) {
    var code = __rpText(entries[i]).toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && codes.indexOf(code) === -1) codes.push(code);
  }
  return codes;
};

var __rpByOrder = function (a, b) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

var __rpRows = function (rows) {
  return Object.prototype.toString.call(rows) === '[object Array]' ? rows : [];
};

var __rpNormalizeZones = function (rows) {
  var zones = [];
  var list = __rpRows(rows);
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== 'object' || !__rpBool(row.is_active, true)) continue;
    var id = __rpText(row.id);
    if (!id) continue;
    var threshold = __rpNumber(row.free_shipping_threshold);
    zones.push({
      id: id,
      name: __rpText(row.name),
      countries: __rpParseCountries(row.countries),
      isRestOfWorld: __rpBool(row.is_rest_of_world, false),
      doNotShip: __rpBool(row.do_not_ship, false),
      freeShippingThreshold: threshold === null || threshold < 0 ? null : threshold,
      codEnabled: __rpBool(row.cod_enabled, true),
      sortOrder: __rpNumber(row.sort_order) || 0
    });
  }
  return zones.sort(__rpByOrder);
};

var __rpNormalizeRates = function (rows) {
  var rates = [];
  var list = __rpRows(rows);
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== 'object' || !__rpBool(row.is_active, true)) continue;
    var id = __rpText(row.id);
    var zoneId = __rpText(row.zone_id);
    if (!id || !zoneId) continue;
    var type = __rpText(row.rate_type).toLowerCase();
    var price = __rpNumber(row.price);
    var min = __rpNumber(row.min_value);
    var max = __rpNumber(row.max_value);
    var tiered = type === 'price' || type === 'weight';
    // A tier with a negative or empty range (a row edited in the generated
    // admin, which cannot validate) is skipped rather than read as unbounded.
    if (tiered && ((min !== null && min < 0) || (max !== null && max < 0) || (min !== null && max !== null && max <= min))) continue;
    rates.push({
      id: id,
      zoneId: zoneId,
      name: __rpText(row.name),
      type: tiered ? type : 'flat',
      price: price === null || price < 0 ? 0 : price,
      min: min === null || min < 0 ? null : min,
      max: max === null || max < 0 ? null : max,
      estimatedDays: __rpText(row.estimated_days),
      sortOrder: __rpNumber(row.sort_order) || 0
    });
  }
  return rates.sort(__rpByOrder);
};

var __rpNormalizeTaxRates = function (rows) {
  var taxRates = [];
  var list = __rpRows(rows);
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== 'object' || !__rpBool(row.is_active, true)) continue;
    var id = __rpText(row.id);
    var countryCode = __rpText(row.country_code).toUpperCase();
    if (!id || !/^[A-Z]{2}$/.test(countryCode)) continue;
    var rate = __rpNumber(row.rate);
    var mode = __rpText(row.tax_mode).toLowerCase();
    taxRates.push({
      id: id,
      countryCode: countryCode,
      region: __rpRegion(row.region),
      categoryId: __rpText(row.category_id),
      rate: rate === null || rate < 0 ? 0 : rate,
      mode: mode === 'included' || mode === 'added' ? mode : 'inherit',
      taxShipping: __rpBool(row.tax_shipping, false)
    });
  }
  // By id, so two rows a merchant accidentally made identical resolve the same
  // way on every read, whatever order the database returned them in.
  return taxRates.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
};

// The three tables' rows, as \`/api/data/.../select\` returns them, reduced to
// the ACTIVE entries in a deterministic order.
var __rpNormalizeConfig = function (raw) {
  var source = raw && typeof raw === 'object' ? raw : {};
  return {
    zones: __rpNormalizeZones(source.zones),
    rates: __rpNormalizeRates(source.rates),
    taxRates: __rpNormalizeTaxRates(source.taxRates)
  };
};

var __rpWeightKg = function (weight, unit) {
  var n = __rpNumber(weight);
  if (n === null || n <= 0) return 0;
  var u = __rpText(unit).toLowerCase();
  if (u === 'g' || u === 'gr' || u === 'gram' || u === 'grams') return n / 1000;
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return n * 0.45359237;
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return n * 0.028349523125;
  return n;
};

// Cart lines as the storefront stores them (NET unit price, quantity, and the
// weight + categories hydration stamps on), reduced to what pricing reads.
var __rpLines = function (items) {
  var lines = [];
  var list = __rpRows(items);
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || typeof item !== 'object') continue;
    var price = __rpNumber(item.price);
    var quantity = __rpNumber(item.quantity);
    var categories = __rpStringArray(item.categoryIds);
    var categoryIds = [];
    for (var c = 0; c < categories.length; c++) {
      var categoryId = __rpText(categories[c]);
      if (categoryId && categoryIds.indexOf(categoryId) === -1) categoryIds.push(categoryId);
    }
    lines.push({
      key: item.id !== undefined && item.id !== null ? String(item.id) : String(i),
      productId: __rpText(item.productId),
      variantId: __rpText(item.variantId),
      price: price === null || price < 0 ? 0 : price,
      quantity: quantity === null || quantity <= 0 ? 1 : quantity,
      weightKg: __rpWeightKg(item.weight, item.weightUnit),
      categoryIds: categoryIds
    });
  }
  return lines;
};

// The most specific ACTIVE row for a destination: a region match outranks a
// country-wide row, and a category match outranks an uncategorised one. A row
// scoped to a region or a category that does not apply is not a candidate.
// Shipping is never a category, so it only ever sees the uncategorised rows.
var __rpFindTaxRow = function (taxRates, destination, categoryIds, forShipping) {
  if (!destination || !destination.countryCode) return null;
  var region = __rpRegion(destination.region);
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < taxRates.length; i++) {
    var row = taxRates[i];
    if (row.countryCode !== destination.countryCode) continue;
    var score = 0;
    if (row.region) {
      if (row.region !== region) continue;
      score += 2;
    }
    if (row.categoryId) {
      if (forShipping || categoryIds.indexOf(row.categoryId) === -1) continue;
      score += 1;
    }
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
};

var __rpRowIncluded = function (row, defaultIncluded) {
  if (row.mode === 'inherit') return defaultIncluded;
  return row.mode === 'included';
};

// What a stored price costs the buyer at a rate: grossed up when the tax is
// added on top, the stored price itself when it already includes the tax.
var __rpGrossAmount = function (amount, rate, included, decimals) {
  var n = __rpNumber(amount);
  var base = n === null ? 0 : n;
  return !included && rate > 0 ? __rpRound(base * (1 + rate / 100), decimals) : base;
};

var __rpSafeRate = function (rate) {
  var n = __rpNumber(rate);
  return n === null || n < 0 ? 0 : n;
};

var __rpInRange = function (basis, min, max) {
  if (min !== null && basis < min) return false;
  if (max !== null && basis >= max) return false;
  return true;
};

// The store's own Delivery Settings: what every order no zone overrides pays.
var __rpStoreShipping = function (store) {
  return {
    base: __rpRound(__rpSafeRate(store.deliveryPrice), 2),
    threshold: store.freeDeliveryEnabled === true ? __rpRound(__rpSafeRate(store.freeDeliveryThreshold), 2) : null
  };
};

var __rpResolveZone = function (zones, countryCode) {
  var restOfWorld = null;
  for (var i = 0; i < zones.length; i++) {
    var zone = zones[i];
    if (zone.isRestOfWorld) {
      if (!restOfWorld) restOfWorld = zone;
      continue;
    }
    if (zone.countries.indexOf(countryCode) !== -1) return zone;
  }
  return restOfWorld;
};

// Tax on a shipping fee at the destination's standard rate: added on top, or —
// where prices include tax — already inside the fee and reported, not charged.
var __rpShippingTax = function (net, rate, included, decimals) {
  if (!(rate > 0) || !(net > 0)) return { tax: 0, gross: net };
  if (included) return { tax: __rpRound(net - net / (1 + rate / 100), decimals), gross: net };
  var tax = __rpRound(net * rate / 100, decimals);
  return { tax: tax, gross: __rpRound(net + tax, decimals) };
};

var __rpByPrice = function (a, b) {
  if (a.price !== b.price) return a.price - b.price;
  return __rpByOrder(a, b);
};

/*
 * THE quote. One call prices a basket for one destination.
 *
 * input:
 *   config        normalized rows (__rpNormalizeConfig)
 *   store         { deliveryEnabled, storePickupEnabled, deliveryPrice,
 *                   freeDeliveryEnabled, freeDeliveryThreshold,
 *                   defaultTaxRate, defaultTaxIncluded }
 *   items         cart lines (raw)
 *   destination   { countryCode, countryName, region } or null
 *   fulfillment   'delivery' | 'pickup'
 *   selectedRateId, currency
 */
var __rpQuote = function (input) {
  var source = input && typeof input === 'object' ? input : {};
  var config = source.config && typeof source.config === 'object'
    ? source.config
    : { zones: [], rates: [], taxRates: [] };
  var store = source.store && typeof source.store === 'object' ? source.store : {};
  var deliveryEnabled = store.deliveryEnabled === true;
  var delivering = deliveryEnabled && source.fulfillment !== 'pickup';
  var destination = source.destination && typeof source.destination === 'object'
    ? {
        countryCode: __rpText(source.destination.countryCode).toUpperCase(),
        countryName: __rpText(source.destination.countryName),
        region: __rpText(source.destination.region)
      }
    : null;
  var defaultRate = __rpSafeRate(store.defaultTaxRate);
  var defaultIncluded = store.defaultTaxIncluded === true;
  var taxRates = __rpRows(config.taxRates);
  var zones = __rpRows(config.zones);
  var taxRegional = taxRates.length > 0;
  var zonesActive = delivering && zones.length > 0;
  var moneyDecimals = __rpDecimals(source.currency);
  // A store with no tax rows keeps the cent rounding it has always used, so its
  // totals are identical to the ones it charged before regions existed.
  var taxDecimals = taxRegional ? moneyDecimals : 2;

  var lines = __rpLines(source.items);
  var outLines = [];
  var buckets = [];
  var goodsNet = 0;
  var goodsGross = 0;
  var weightKg = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var row = taxRegional ? __rpFindTaxRow(taxRates, destination, line.categoryIds, false) : null;
    var rate = row ? row.rate : defaultRate;
    var included = row ? __rpRowIncluded(row, defaultIncluded) : defaultIncluded;
    var unitGross = __rpGrossAmount(line.price, rate, included, taxDecimals);
    var lineGross = __rpRound(unitGross * line.quantity, taxDecimals);
    var lineNet = line.price * line.quantity;
    var lineTax = included
      ? (rate > 0 ? lineGross - lineGross / (1 + rate / 100) : 0)
      : lineGross - lineNet;
    goodsNet += lineNet;
    goodsGross += lineGross;
    weightKg += line.weightKg * line.quantity;
    outLines.push({
      key: line.key,
      productId: line.productId,
      variantId: line.variantId,
      unitGross: unitGross,
      lineGross: lineGross,
      taxRate: rate,
      taxIncluded: included
    });
    var bucket = null;
    for (var b = 0; b < buckets.length; b++) {
      if (buckets[b].rate === rate && buckets[b].included === included) { bucket = buckets[b]; break; }
    }
    if (!bucket) {
      bucket = { rate: rate, included: included, gross: 0, tax: 0 };
      buckets.push(bucket);
    }
    bucket.gross += lineGross;
    bucket.tax += lineTax;
  }
  goodsNet = __rpRound(goodsNet, 2);
  goodsGross = __rpRound(goodsGross, taxDecimals);
  var goodsTax = __rpRound(goodsGross - goodsNet, taxDecimals);
  if (goodsTax < 0) goodsTax = 0;
  var breakdown = [];
  for (var k = 0; k < buckets.length; k++) {
    if (!(buckets[k].rate > 0)) continue;
    breakdown.push({
      rate: buckets[k].rate,
      included: buckets[k].included,
      gross: __rpRound(buckets[k].gross, taxDecimals),
      tax: __rpRound(buckets[k].tax, taxDecimals)
    });
  }

  var standardRow = taxRegional ? __rpFindTaxRow(taxRates, destination, [], true) : null;
  var taxRate = standardRow ? standardRow.rate : defaultRate;
  var taxIncluded = standardRow ? __rpRowIncluded(standardRow, defaultIncluded) : defaultIncluded;

  // Compared on the cent-rounded goods total, so a sum that drifted to
  // 49.999999 still meets a threshold of 50.
  var basisPrice = __rpRound(goodsGross, 2);
  var status = 'ok';
  var zone = null;
  var options = [];
  var selectedRateId = null;
  var rateName = '';
  var shippingBase = 0;
  var threshold = null;
  var codAvailable = true;

  if (zonesActive && (!destination || !destination.countryCode)) {
    status = 'pending';
  } else if (delivering) {
    var matched = zonesActive ? __rpResolveZone(zones, destination.countryCode) : null;
    if (!matched) {
      // No zone lists this country (or there are none): the store's own
      // delivery settings, exactly as before regions existed.
      var storeShipping = __rpStoreShipping(store);
      shippingBase = storeShipping.base;
      threshold = storeShipping.threshold;
    } else if (matched.doNotShip) {
      zone = { id: matched.id, name: matched.name };
      status = 'unavailable';
    } else {
      zone = { id: matched.id, name: matched.name };
      codAvailable = matched.codEnabled;
      threshold = matched.freeShippingThreshold;
      var basisWeight = Math.round(weightKg * 1000) / 1000;
      var rates = __rpRows(config.rates);
      var zoneHasRates = false;
      for (var r = 0; r < rates.length; r++) {
        var candidate = rates[r];
        if (candidate.zoneId !== matched.id) continue;
        zoneHasRates = true;
        if (candidate.type === 'price' && !__rpInRange(basisPrice, candidate.min, candidate.max)) continue;
        if (candidate.type === 'weight' && !__rpInRange(basisWeight, candidate.min, candidate.max)) continue;
        options.push({
          id: candidate.id,
          name: candidate.name,
          estimatedDays: candidate.estimatedDays,
          price: __rpRound(candidate.price, moneyDecimals),
          sortOrder: candidate.sortOrder
        });
      }
      options.sort(__rpByPrice);
      if (!zoneHasRates) {
        // No rate at all (none, or only switched-off ones): the store fee,
        // under this zone's own threshold and cash-on-delivery rule.
        shippingBase = __rpStoreShipping(store).base;
      } else if (options.length === 0) {
        status = 'no-rate';
      } else {
        var selected = options[0];
        for (var o = 0; o < options.length; o++) {
          if (options[o].id === source.selectedRateId) { selected = options[o]; break; }
        }
        selectedRateId = selected.id;
        rateName = selected.name;
        shippingBase = selected.price;
      }
    }
  }

  var thresholdReached = status === 'ok' && threshold !== null && basisPrice >= threshold;
  var shippingNet = status === 'ok' && !thresholdReached ? shippingBase : 0;
  var shippingTaxRow = standardRow && standardRow.taxShipping ? standardRow : null;
  var shipping = __rpShippingTax(shippingNet, shippingTaxRow ? taxRate : 0, taxIncluded, moneyDecimals);

  var outOptions = [];
  for (var p = 0; p < options.length; p++) {
    var optionFree = thresholdReached || options[p].price === 0;
    outOptions.push({
      id: options[p].id,
      name: options[p].name,
      estimatedDays: options[p].estimatedDays,
      price: options[p].price,
      // What choosing this option adds to the order — the figure to print beside it.
      gross: optionFree
        ? 0
        : __rpShippingTax(options[p].price, shippingTaxRow ? taxRate : 0, taxIncluded, moneyDecimals).gross,
      isFree: optionFree
    });
  }

  return {
    fulfillment: delivering ? 'delivery' : 'pickup',
    destination: destination,
    taxRegional: taxRegional,
    zonesActive: zonesActive,
    status: status,
    taxDecimals: taxDecimals,
    lines: outLines,
    goodsNet: goodsNet,
    goodsTax: goodsTax,
    goodsGross: goodsGross,
    taxRate: taxRate,
    taxIncluded: taxIncluded,
    breakdown: breakdown,
    zone: zone,
    options: outOptions,
    selectedRateId: selectedRateId,
    rateName: rateName,
    freeShippingThreshold: threshold,
    freeShippingProgress: threshold === null
      ? 0
      : threshold > 0 ? Math.min(100, (basisPrice / threshold) * 100) : 100,
    freeShippingRemaining: threshold === null ? 0 : Math.max(0, __rpRound(threshold - basisPrice, 2)),
    shippingIsFree: thresholdReached,
    shippingBase: shippingBase,
    shippingNet: shippingNet,
    shippingTax: shipping.tax,
    shippingGross: shipping.gross,
    codAvailable: codAvailable,
    // Goods are rounded to \`taxDecimals\`, so the total is too: a zero-decimal
    // store with no regional tax rows keeps cent-precise goods, as before.
    total: __rpRound(goodsGross + shipping.gross, taxDecimals)
  };
};

// The address the checkout form is pricing, read straight off the form. Null
// anywhere the checkout form is not on the page.
//
// The same address the place-order workflow uses: the shipping address block
// exists in the DOM only while "ship to a different address" is ticked, and the
// billing address otherwise. \`countryCodes\` maps a lower-cased country NAME
// (what the country field holds) to its ISO code.
var __rpReadCheckoutDestination = function (countryCodes) {
  if (typeof document === 'undefined') return null;
  var billingCountry = document.querySelector('[name="billingCountry"]');
  if (!billingCountry) return null;
  var shippingCountry = document.querySelector('[name="shippingCountry"]');
  var countryField = shippingCountry || billingCountry;
  var regionField = document.querySelector(shippingCountry ? '[name="shippingState"]' : '[name="state"]');
  var countryName = __rpText(countryField.value);
  var codes = countryCodes && typeof countryCodes === 'object' ? countryCodes : {};
  var countryCode = codes[countryName.toLowerCase()] || '';
  if (!countryCode && /^[A-Za-z]{2}$/.test(countryName)) countryCode = countryName.toUpperCase();
  return {
    countryCode: countryCode,
    countryName: countryName,
    region: regionField ? __rpText(regionField.value) : ''
  };
};
`

/**
 * The shipping rate the buyer picked at checkout (a rate id). ⚠️ `cart-get-total`
 * spells the same key out as a literal — a serialized handler has no module
 * scope to import it from.
 */
export const SHIPPING_RATE_STORAGE_KEY = 'workflow_shipping_rate'

/** Broadcast when the buyer picks a shipping rate. */
export const SHIPPING_RATE_CHANGED_EVENT = 'teleport:shipping-rate-changed'
