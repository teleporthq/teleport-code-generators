import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

// Emits the HTML-building half of `utils/invoices/pdf-generator.js`.
//
// The renderer walks the user-authored `invoice-template` UIDL component
// (same tree the GUI editor saves) node by node, emitting HTML with the
// inline styles the editor set on each element. The HTML produced is
// self-contained — reset CSS and the project's global stylesheet are
// baked into <style> tags — so downstream consumers (currently the
// external PDF microservice) need no project filesystem access to
// render it.
//
// The UIDL tree has several features that need runtime handling:
//
//   1. `<context>` elements carry default invoice data on their attributes
//      (Company, Invoice, Customer, Products, Payment). Children reference
//      that data through expressions like `invoiceData?.Company?.name`. We
//      build a per-render scope from the attrs merged with real DB data
//      (real wins unless empty) so every expression resolves against the
//      buyer's actual order.
//
//   2. `cms-list-repeater` iterates `invoiceData.Products` with a
//      per-iteration variable (the `renderPropIdentifier`). Each line item
//      renders the `nodes.list` template with the scope extended by that
//      variable.
//
//   3. `expr` nodes carry JS expression source (always paths into scope)
//      that we evaluate via `Function(...)` with the scope keys
//      destructured — `with`-free, sandboxed, no side effects.
//
//   4. `elementType: 'component'` references another project component
//      (e.g. the company Logo). We descend into the referenced component's
//      UIDL tree and render it inline, pushing the caller's attrs as
//      props onto the scope and wrapping the output in a span that
//      carries the reference's own inline style (so parent-set sizing
//      like width/height still applies). Transitive references are
//      handled recursively with a depth guard.
//
//   5. `conditional` nodes carry a reference (prop path / expression /
//      static) and a `condition.conditions[]` list of {operation, operand}
//      comparisons joined by `all`/`any`. They render `content.node`
//      (NOT its children) when the comparison passes. Earlier versions
//      of this renderer mis-evaluated these by passing the reference
//      object through a string-only expression evaluator, which made
//      every conditional always fail — including the two `<conditional>`
//      wrappers around the Logo component's light/dark SVG, so the logo
//      never appeared.
//
//   6. `referencedStyles` of type `style-map` + `project-referenced`
//      bind the element to a CSS class defined in the project's global
//      stylesheet. `readGlobalCss()` already inlines that stylesheet
//      into the emitted HTML; we simply append the `referenceId` as a
//      class on the rendered element so the CSS selector matches.
//
//   7. Static `attrs` are emitted verbatim as HTML attributes. This is
//      required for SVG shape elements (`<rect x y width height rx>`,
//      `<path d>`, `<circle cx cy r fill>`) where the geometry lives in
//      attributes rather than styles. Without this pass-through, the
//      Logo's SVG icons rendered as empty `<svg>` tags.

// Collect the transitive closure of project components reachable from
// the invoice-template so runtime lookups in `renderComponentReference`
// always resolve. We walk children, conditional bodies, and repeater
// templates to find every nested `elementType: 'component'` reference.
// Keeping only the reachable subset means a 7-component project doesn't
// ship 170 KB of unrelated Navigation/Footer/Admin trees in every
// invoice PDF request.
const collectReachableComponents = (
  rootNode: unknown,
  allComponents: Record<string, unknown>
): Record<string, unknown> => {
  const reachable: Record<string, unknown> = {}
  if (!allComponents) {
    return reachable
  }

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    const n = node as Record<string, unknown>
    const content = n.content as Record<string, unknown> | undefined

    if (content && content.elementType === 'component') {
      const name =
        typeof content.semanticType === 'string' ? (content.semanticType as string) : null
      if (name && allComponents[name] && !reachable[name]) {
        reachable[name] = allComponents[name]
        const referencedDef = allComponents[name] as Record<string, unknown>
        visit(referencedDef.node)
      }
    }

    if (n.type === 'conditional' && content && content.node) {
      visit(content.node)
    }

    if (content && Array.isArray(content.children)) {
      ;(content.children as unknown[]).forEach(visit)
    }

    if (content && content.nodes && typeof content.nodes === 'object') {
      const nodes = content.nodes as Record<string, unknown>
      if (nodes.list) {
        visit(nodes.list)
      }
      if (nodes.empty) {
        visit(nodes.empty)
      }
    }
  }

  // Callers pass either a component definition (`{ node, propDefinitions, ... }`)
  // or a raw element node. Unwrap the definition so the walker sees the
  // element tree directly — otherwise the `elementType === 'component'`
  // check at the top level misses (definitions have no `content` field).
  const root =
    rootNode && typeof rootNode === 'object' && (rootNode as { node?: unknown }).node
      ? (rootNode as { node: unknown }).node
      : rootNode
  visit(root)
  return reachable
}

export const generateInvoiceHtmlCode = (
  settings: UIDLInvoiceSettings,
  invoiceTemplateUidl: unknown,
  allComponents: Record<string, unknown> | null | undefined
): string => {
  const companyDetailsJson = JSON.stringify(settings.companyDetails || {})
  const invoicePrefixJson = JSON.stringify(settings.invoicePrefix || 'INV-')
  const componentUidlJson = invoiceTemplateUidl ? JSON.stringify(invoiceTemplateUidl) : 'null'

  const reachable = allComponents
    ? collectReachableComponents(invoiceTemplateUidl, allComponents)
    : {}
  const componentDefinitionsJson = JSON.stringify(reachable)

  return `var fs = require('fs');
var path = require('path');

var COMPANY_DETAILS = ${companyDetailsJson};
var INVOICE_PREFIX = ${invoicePrefixJson};
var TEMPLATE_COMPONENT_UIDL = ${componentUidlJson};
// Transitive closure of project components reachable from the invoice
// template. Populated at generation time so runtime lookups in
// renderComponentReference() never need filesystem access.
var COMPONENT_DEFINITIONS = ${componentDefinitionsJson};

// Depth guard for recursive component rendering. 12 is generous —
// real invoice templates nest 1–2 levels — and prevents a runaway
// loop if a component ever references itself through some path.
var MAX_COMPONENT_DEPTH = 12;

// ---------------------------------------------------------------------------
// Scope construction — merges real DB data with defaults the user set on
// the <context> element in the editor. Per-field fallback: if the real
// field is empty/null, the UIDL default wins. Covers the common dev case
// where COMPANY_DETAILS from invoiceSettings isn't filled in but the user
// dropped "Acme Corporation" into the template preview.
// ---------------------------------------------------------------------------

function extractStaticAttrsFromContext(uidl) {
  if (!uidl) return {};
  var contextNode = findFirstContextNode(uidl.node || uidl);
  if (!contextNode) return {};
  var attrs = (contextNode.content && contextNode.content.attrs) || {};
  var out = {};
  Object.keys(attrs).forEach(function (key) {
    var val = attrs[key];
    if (val && val.type === 'static') {
      out[key] = val.content;
    } else if (val && val.type === 'dynamic') {
      out[key] = undefined;
    } else {
      out[key] = val;
    }
  });
  return out;
}

function findFirstContextNode(node) {
  if (!node) return null;
  if (node.type === 'element' && node.content && node.content.elementType === 'context') {
    return node;
  }
  var children = node.content && node.content.children;
  if (Array.isArray(children)) {
    for (var i = 0; i < children.length; i++) {
      var found = findFirstContextNode(children[i]);
      if (found) return found;
    }
  }
  return null;
}

function nonEmpty(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return !isNaN(v);
  return true;
}

function mergeWithDefaults(primary, defaults) {
  var out = Object.assign({}, defaults || {});
  if (primary) {
    Object.keys(primary).forEach(function (k) {
      if (nonEmpty(primary[k])) out[k] = primary[k];
    });
  }
  return out;
}

function formatCurrencyValue(amount, sym, decimals) {
  var num = Number(amount);
  if (!isFinite(num)) num = 0;
  var dec = decimals != null ? decimals : 2;
  var fixed = num.toFixed(dec);
  var parts = fixed.split('.');
  parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return (sym || '') + parts.join('.');
}

// Per-line VAT formulas. These MIRROR the GUI helpers in
// teleport-gui/.../invoice-vat-formulas.ts (computeLineVatAmount,
// computeNetFromGross). The GUI bakes per-row unitPriceNet /
// lineVatAmount / lineTotalGross into the design canvas via
// invoice-products-sample-sync, then the default invoice template binds
// the line-item columns to those exact field names. The runtime PDF
// builder MUST surface the same fields on each row, with values computed
// via the same formulas, otherwise the rendered table cells stay blank
// (template binds product.unitPriceNet / lineVatAmount / lineTotalGross,
// the row only carried unitPrice / lineTotal, mismatch → empty string).
//
//   included → net  = gross / (1 + r/100), vat = gross - net
//   excluded → net  = stored value,        vat = net   * r / 100
//
// When rate is 0 or non-positive, vat collapses to 0 in both modes.
function computeLineVatAmountValue(lineGross, rate, included) {
  var n = Number(lineGross);
  if (!isFinite(n)) n = 0;
  if (rate <= 0) return 0;
  return included ? n - n / (1 + rate / 100) : (n * rate) / 100;
}

function computeNetFromGrossValue(amount, rate, included) {
  var n = Number(amount);
  if (!isFinite(n)) n = 0;
  if (rate <= 0 || !included) return n;
  return n / (1 + rate / 100);
}

function formatDateValue(raw) {
  if (!raw) return '';
  try {
    var d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  } catch (_e) {
    return String(raw);
  }
}

function buildInvoiceDataScope(invoiceData) {
  var defaults = extractStaticAttrsFromContext(TEMPLATE_COMPONENT_UIDL);
  var sym = invoiceData.currencySymbol || '$';

  var realCompany = {
    name: COMPANY_DETAILS.companyName,
    address: COMPANY_DETAILS.companyAddress,
    city: COMPANY_DETAILS.companyCity,
    state: COMPANY_DETAILS.companyState,
    zip: COMPANY_DETAILS.companyZip,
    country: COMPANY_DETAILS.companyCountry,
    vat: COMPANY_DETAILS.companyVat,
    registrationNumber: COMPANY_DETAILS.companyRegNumber,
    email: COMPANY_DETAILS.companyEmail,
    phone: COMPANY_DETAILS.companyPhone,
    logoUrl: invoiceData.companyLogoUrl || '',
    website: COMPANY_DETAILS.companyWebsite,
  };

  var realInvoice = {
    invoiceNumber: invoiceData.invoiceNumber ? '#' + invoiceData.invoiceNumber : '',
    status: invoiceData.status || '',
    issueDate: formatDateValue(invoiceData.issueDate),
    dueDate: formatDateValue(invoiceData.dueDate),
    paidDate: formatDateValue(invoiceData.paidAt),
    subtotal: formatCurrencyValue(invoiceData.subtotal, sym),
    taxRate: invoiceData.taxRate != null ? String(invoiceData.taxRate) : '',
    taxAmount: formatCurrencyValue(invoiceData.taxAmount, sym),
    discountAmount: formatCurrencyValue(invoiceData.discountAmount, sym),
    total: formatCurrencyValue(invoiceData.total, sym),
    currency: invoiceData.currency || 'USD',
    currencySymbol: sym,
    notes: invoiceData.notes || '',
    pdfUrl: invoiceData.pdfUrl || '',
  };

  var realCustomer = {
    name: invoiceData.customerName || '',
    email: invoiceData.customerEmail || '',
    address: invoiceData.customerAddress || '',
    city: invoiceData.customerCity || '',
    state: invoiceData.customerState || '',
    zip: invoiceData.customerZip || '',
    country: invoiceData.customerCountry || '',
    vat: invoiceData.customerVat || '',
  };

  var realPayment = {
    method: invoiceData.paymentMethod || '',
    provider: invoiceData.paymentProvider || '',
    intentId: invoiceData.paymentIntentId || '',
    orderId: invoiceData.orderId || '',
  };

  // Per-line tax math, applied here so the invoice-template's table can
  // bind directly to product.unitPriceNet / product.lineVatAmount /
  // product.lineTotalGross — the exact field names the GUI's
  // invoice-products-sample-sync writes into the template's design-time
  // sample data. Keeping the runtime emission and the design-canvas
  // sample on the same field schema is the contract that makes the
  // template render the same columns at design time and at PDF time.
  var taxRate = Number(invoiceData.taxRate);
  if (!isFinite(taxRate)) taxRate = 0;
  var taxIncluded = invoiceData.taxIncludedInPrice === true;

  var realProducts = (invoiceData.items || []).map(function (it) {
    var qty = Number(it.quantity) || 1;
    // Stored unit/line values represent the buyer-paid amount: net when
    // tax is added on top, gross when tax is included in price. We feed
    // both through computeNetFromGrossValue so the "net" output is
    // correct regardless of mode (no-op in excluded mode).
    var unitStored = Number(it.unitPrice || it.unit_price || it.price) || 0;
    var lineStored = Number(it.totalPrice || it.total_price);
    if (!isFinite(lineStored) || lineStored === 0) lineStored = qty * unitStored;

    var unitNet = computeNetFromGrossValue(unitStored, taxRate, taxIncluded);
    var lineNet = computeNetFromGrossValue(lineStored, taxRate, taxIncluded);
    // Per-unit VAT mirrors the GUI helper: derived from the NET unit
    // price at the configured rate (rather than dividing line VAT by qty,
    // which yields odd values when qty is 0 or missing).
    var unitVat = computeLineVatAmountValue(unitStored, taxRate, taxIncluded);
    var lineVat = computeLineVatAmountValue(lineStored, taxRate, taxIncluded);
    var unitGross = unitNet + unitVat;
    var lineGross = lineNet + lineVat;

    // Append the purchased variant to the item name so it appears on the PDF
    // (e.g. "Cotton Tee — Red / XL"). Empty for flat products.
    var baseName = it.name || it.product_name || '';
    var variantLabel = it.variantLabel || it.variant_label || '';
    var displayName = variantLabel ? (baseName + ' — ' + variantLabel) : baseName;

    // Colour swatch hex(es) for the variant's colour-type axes (JSON array of
    // { color }), for the GUI template's swatch mapper + the fallback HTML row.
    var variantSwatches = [];
    try {
      var swRaw = it.variantSwatches || it.variant_swatches;
      if (swRaw) { var swArr = typeof swRaw === 'string' ? JSON.parse(swRaw) : swRaw; if (Array.isArray(swArr)) variantSwatches = swArr; }
    } catch (e) { variantSwatches = []; }
    var variantSwatchesHtml = variantSwatches.map(function (sw) {
      return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,0.2);margin-right:4px;vertical-align:middle;background:' + (sw && sw.color ? sw.color : 'transparent') + ';"></span>';
    }).join('');

    return {
      name: displayName,
      variant: variantLabel,
      variantSwatches: variantSwatches,
      variantSwatchesHtml: variantSwatchesHtml,
      description: it.description || '',
      quantity: String(qty),
      // Original fields kept for backward compatibility with templates
      // that still bind to unitPrice / lineTotal.
      unitPrice: formatCurrencyValue(unitStored, sym),
      lineTotal: formatCurrencyValue(lineStored, sym),
      // GUI-sync field names (the default invoice template binds to these).
      unitPriceNet: formatCurrencyValue(unitNet, sym),
      unitPriceGross: formatCurrencyValue(unitGross, sym),
      lineTotalNet: formatCurrencyValue(lineNet, sym),
      lineTotalGross: formatCurrencyValue(lineGross, sym),
      lineVatAmount: formatCurrencyValue(lineVat, sym),
      sku: it.sku || '',
      itemTaxRate: it.taxRate != null ? String(it.taxRate) : (taxRate > 0 ? String(taxRate) : ''),
      itemTaxAmount: it.taxAmount != null ? formatCurrencyValue(it.taxAmount, sym) : formatCurrencyValue(lineVat, sym),
    };
  });

  return {
    invoiceData: {
      Company: mergeWithDefaults(realCompany, defaults.Company),
      Invoice: mergeWithDefaults(realInvoice, defaults.Invoice),
      Customer: mergeWithDefaults(realCustomer, defaults.Customer),
      Payment: mergeWithDefaults(realPayment, defaults.Payment),
      Products: realProducts.length > 0 ? realProducts : (defaults.Products || []),
    },
  };
}

// ---------------------------------------------------------------------------
// UIDL → HTML walker
// ---------------------------------------------------------------------------

var HTML_VOID_ELEMENTS = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1,
};

var CSS_UNITLESS_PROPS = {
  opacity: 1, zIndex: 1, fontWeight: 1, lineHeight: 1, flex: 1, flexGrow: 1,
  flexShrink: 1, order: 1, zoom: 1, columnCount: 1, fillOpacity: 1,
  strokeOpacity: 1,
};

// Attributes explicitly consumed by the element-specific branches above
// (class/style computed from UIDL fields, src/alt handled by image
// element). Skipped by the generic static-attrs pass-through so we
// don't emit them twice.
var ATTRS_ALREADY_EMITTED = {
  'class': 1, 'style': 1, 'src': 1, 'alt': 1, 'source': 1,
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
    }
    return c;
  });
}

function camelToKebab(key) {
  return key.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
}

function resolveStaticAttr(attr) {
  if (attr && attr.type === 'static') return attr.content;
  return undefined;
}

function stylesToInline(styleMap) {
  if (!styleMap || typeof styleMap !== 'object') return '';
  var pairs = [];
  Object.keys(styleMap).forEach(function (key) {
    var entry = styleMap[key];
    var value = entry && entry.type === 'static' ? entry.content : entry;
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'number' && !CSS_UNITLESS_PROPS[key]) {
      value = value + 'px';
    }
    pairs.push(camelToKebab(key) + ':' + value);
  });
  return pairs.join(';');
}

// Builds a CSS class name that matches the convention used by the
// generated React component (so if we ever want to share styles across
// them, selectors line up).
function classNameForNode(componentName, elementName) {
  if (!elementName) return '';
  return String(componentName + '-' + elementName)
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

// Project-referenced style maps: the React generator emits these as
// className references into the project-wide stylesheet (pages/style.css).
// We already inline that stylesheet into the rendered HTML, so all we
// need is the referenceId as an additional class on the element.
function collectReferencedStyleClasses(referencedStyles) {
  var out = [];
  if (!referencedStyles || typeof referencedStyles !== 'object') return out;
  Object.keys(referencedStyles).forEach(function (key) {
    var entry = referencedStyles[key];
    if (!entry || entry.type !== 'style-map') return;
    var c = entry.content;
    if (!c || c.mapType !== 'project-referenced' || !c.referenceId) return;
    out.push(String(c.referenceId));
  });
  return out;
}

// Safe-ish expression evaluator. The UIDL expressions are authored by the
// GUI and reach us through the generator build, so they're trusted input;
// still, we run them in a bounded scope — only the destructured keys are
// visible, no global \`process\` / \`require\` / \`this\` access.
//
// IMPORTANT: \`Function\` (no \`new\`) creates a function just like
// \`new Function\` — \`new Function.apply(null, args)\` parses as
// \`new (Function.apply(null, args))()\` and instantiates the created
// function with ZERO args, so every \`invoiceData?.X?.Y\` expression
// received an undefined \`invoiceData\`. That bug rendered every field
// in the invoice PDF empty. The call must be \`Function.apply(null, args)\`.
var __exprCache = {};
function evaluateExpression(expr, scope) {
  if (typeof expr !== 'string' || !expr) return '';
  try {
    var keys = Object.keys(scope).sort();
    var cacheKey = expr + '|' + keys.join(',');
    var fn = __exprCache[cacheKey];
    if (!fn) {
      fn = Function.apply(null, keys.concat(['"use strict"; return (' + expr + ');']));
      __exprCache[cacheKey] = fn;
    }
    var args = keys.map(function (k) { return scope[k]; });
    var val = fn.apply(null, args);
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch (_e) { return ''; }
    }
    return String(val);
  } catch (_e) {
    return '';
  }
}

// Resolve a UIDL reference descriptor (dynamic/static/expr) to a live
// JS value — without coercing to string. Used by the conditional
// evaluator and the component-reference prop resolver where type
// matters (boolean false must stay false, not become the string 'false').
function resolveReferenceValue(ref, scope) {
  if (ref == null) return undefined;
  if (typeof ref !== 'object') return ref;
  if (ref.type === 'static') return ref.content;
  if (ref.type === 'dynamic') {
    var c = ref.content || {};
    if (c.referenceType === 'prop' && c.id) {
      return scope[c.id];
    }
    if (c.referenceType === 'local' && c.id) {
      return scope[c.id];
    }
    // state / ctx / others — not exercised by the invoice path today.
    return undefined;
  }
  if (ref.type === 'expr' && typeof ref.content === 'string') {
    var raw = evaluateExpression(ref.content, scope);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    var n = Number(raw);
    if (raw !== '' && !isNaN(n)) return n;
    return raw;
  }
  return undefined;
}

function matchConditionOperation(val, op, operand) {
  switch (op) {
    case '=':
    case '===':
      return val === operand;
    case '!=':
    case '!==':
      return val !== operand;
    case '>':  return Number(val) > Number(operand);
    case '<':  return Number(val) < Number(operand);
    case '>=': return Number(val) >= Number(operand);
    case '<=': return Number(val) <= Number(operand);
    case 'includes':
      if (Array.isArray(val)) return val.indexOf(operand) !== -1;
      return String(val == null ? '' : val).indexOf(String(operand)) !== -1;
    default:
      // Fall back to truthy check when the operation isn't recognised
      // — keeps old UIDL trees that used shorthand conditionals working.
      return !!val;
  }
}

function evaluateConditionalMatch(refValue, condition) {
  if (!condition) return !!refValue;
  if (!Array.isArray(condition.conditions)) {
    // Older UIDL shape: { value: ... } with implicit equality.
    if (Object.prototype.hasOwnProperty.call(condition, 'value')) {
      return refValue === condition.value;
    }
    return !!refValue;
  }
  var mode = condition.matchingCriteria === 'any' ? 'any' : 'all';
  if (condition.conditions.length === 0) return !!refValue;
  for (var i = 0; i < condition.conditions.length; i++) {
    var c = condition.conditions[i] || {};
    var result = matchConditionOperation(refValue, c.operation, c.operand);
    if (mode === 'all' && !result) return false;
    if (mode === 'any' && result) return true;
  }
  return mode === 'all';
}

// Collects the default prop values from a component's propDefinitions.
// These seed the prop scope when a caller renders the component without
// specifying every attr — matches React's defaultProps behaviour.
function extractComponentPropDefaults(componentDef) {
  var out = {};
  var defs = componentDef && componentDef.propDefinitions;
  if (!defs || typeof defs !== 'object') return out;
  Object.keys(defs).forEach(function (k) {
    var def = defs[k];
    if (def && Object.prototype.hasOwnProperty.call(def, 'defaultValue')) {
      out[k] = def.defaultValue;
    }
  });
  return out;
}

// Renders a \`<Component />\`-style reference by looking the component
// up in COMPONENT_DEFINITIONS (populated at generation time with the
// transitive closure of components reachable from the invoice-template).
// Falls back to empty output if the component isn't bundled — better a
// missing logo than a crashed PDF.
//
// The reference's own inline style (width/height/objectFit/margin from
// the invoice-template's <Logo/> placement) is applied via a
// wrapping span. The component's outer element is often declared with
// \`display: contents\` so it can't hold its own box; wrapping in a
// span with display:inline-block lets the parent's sizing take effect.
function renderComponentReference(content, scope, depth) {
  if (depth >= MAX_COMPONENT_DEPTH) {
    console.warn('[invoice-pdf] Component reference depth limit reached (' + depth + '); ignoring nested component.');
    return '';
  }
  var targetName = content && content.semanticType;
  if (!targetName) return '';
  var componentDef = COMPONENT_DEFINITIONS && COMPONENT_DEFINITIONS[targetName];
  if (!componentDef || !componentDef.node) {
    console.warn('[invoice-pdf] Referenced component "' + targetName + '" not bundled — check invoice-template <' + targetName + '> reference.');
    return '';
  }

  var propDefaults = extractComponentPropDefaults(componentDef);
  var callerAttrs = content.attrs || {};

  // Start from the caller's scope (keeps invoiceData / repeater items
  // visible inside nested components if they reach for them) and layer
  // prop defaults + caller-supplied props on top.
  var childScope = Object.assign({}, scope);
  Object.keys(propDefaults).forEach(function (k) {
    childScope[k] = propDefaults[k];
  });
  Object.keys(callerAttrs).forEach(function (k) {
    childScope[k] = resolveReferenceValue(callerAttrs[k], scope);
  });

  var childComponentName = camelToKebab(String(targetName));
  var rendered = renderNode(componentDef.node, childScope, childComponentName, depth + 1);

  // Apply the reference-position style (e.g. width:150px;height:50px
  // from the invoice-template's <Logo/> placement) by wrapping in a
  // span that can hold a box. The inner component's outer element
  // typically uses display:contents for layout transparency.
  var referenceStyle = stylesToInline(content.style);
  if (referenceStyle) {
    return '<span style="' + escapeHtml(referenceStyle) + ';display:inline-block;">' + rendered + '</span>';
  }
  return rendered;
}

function renderNode(node, scope, componentName, depth) {
  if (!node) return '';
  if (typeof depth !== 'number') depth = 0;

  if (node.type === 'static') {
    return escapeHtml(node.content);
  }

  if (node.type === 'expr') {
    var raw = evaluateExpression(node.content, scope);
    return escapeHtml(raw);
  }

  if (node.type === 'cms-list-repeater') {
    return renderRepeater(node.content, scope, componentName, depth);
  }

  if (node.type === 'conditional') {
    var condContent = node.content || {};
    var refValue = resolveReferenceValue(condContent.reference, scope);
    if (evaluateConditionalMatch(refValue, condContent.condition) && condContent.node) {
      return renderNode(condContent.node, scope, componentName, depth);
    }
    return '';
  }

  if (node.type !== 'element') {
    return '';
  }

  var content = node.content || {};
  var elementType = content.elementType;

  if (elementType === 'component') {
    return renderComponentReference(content, scope, depth);
  }

  if (elementType === 'cms-list-repeater') {
    return renderRepeater(content, scope, componentName, depth);
  }

  if (elementType === 'context') {
    // The <context> attrs are the editor-configured default
    // invoiceData. We've already merged those with real DB data in
    // buildInvoiceDataScope, so here we just render the children —
    // the scope already carries \`invoiceData\` from the outer call.
    var ctxChildren = content.children || [];
    return ctxChildren.map(function (c) { return renderNode(c, scope, componentName, depth); }).join('');
  }

  if (elementType === 'fragment') {
    var fragChildren = content.children || [];
    return fragChildren.map(function (c) { return renderNode(c, scope, componentName, depth); }).join('');
  }

  var tag = content.semanticType || elementTypeToTag(elementType);
  var baseClass = classNameForNode(componentName, content.name);
  var referencedClasses = collectReferencedStyleClasses(content.referencedStyles);
  var classList = [];
  if (baseClass) classList.push(baseClass);
  for (var ci = 0; ci < referencedClasses.length; ci++) classList.push(referencedClasses[ci]);
  var inlineStyle = stylesToInline(content.style);
  var attrs = content.attrs || {};

  var attrParts = [];
  if (classList.length) attrParts.push('class="' + escapeHtml(classList.join(' ')) + '"');
  if (inlineStyle) attrParts.push('style="' + escapeHtml(inlineStyle) + '"');

  // Element-specific attribute wiring.
  if (elementType === 'image') {
    var imgSrc = resolveStaticAttr(attrs.src) || resolveStaticAttr(attrs.source) || '';
    var imgAlt = resolveStaticAttr(attrs.alt) || '';
    if (imgSrc) attrParts.push('src="' + escapeHtml(String(imgSrc)) + '"');
    attrParts.push('alt="' + escapeHtml(String(imgAlt)) + '"');
    return '<img ' + attrParts.join(' ') + ' />';
  }

  // Generic static-attrs pass-through. Critical for SVG geometry
  // (viewBox, fill, stroke, d, x/y/width/height, cx/cy/r, rx, points,
  // xmlns, aria-*) which live on attrs rather than styles. Without
  // this, the Logo component's <rect>/<path>/<circle> children emitted
  // empty shapes. class/style/src/alt are already handled above.
  Object.keys(attrs).forEach(function (an) {
    if (ATTRS_ALREADY_EMITTED[an]) return;
    var av = resolveStaticAttr(attrs[an]);
    if (av === undefined || av === null) return;
    attrParts.push(an + '="' + escapeHtml(String(av)) + '"');
  });

  var openTag = '<' + tag + (attrParts.length ? ' ' + attrParts.join(' ') : '') + '>';
  if (HTML_VOID_ELEMENTS[tag]) return openTag;

  var children = content.children || [];
  var inner = children.map(function (c) { return renderNode(c, scope, componentName, depth); }).join('');
  return openTag + inner + '</' + tag + '>';
}

function renderRepeater(content, scope, componentName, depth) {
  var source = content && content.source;
  var identifier = (content && content.renderPropIdentifier) || 'item';
  var listTemplate = content && content.nodes && content.nodes.list;
  var emptyTemplate = content && content.nodes && content.nodes.empty;

  var collection = evalCollection(source, scope);
  if (!Array.isArray(collection) || collection.length === 0) {
    if (emptyTemplate) return renderNode(emptyTemplate, scope, componentName, depth);
    return '';
  }

  return collection.map(function (item, index) {
    var itemScope = Object.assign({}, scope);
    itemScope[identifier] = item;
    itemScope[identifier + 'Index'] = index;
    if (!listTemplate) return '';
    return renderNode(listTemplate, itemScope, componentName, depth);
  }).join('');
}

function evalCollection(source, scope) {
  if (Array.isArray(source)) return source;
  if (typeof source !== 'string') return [];
  try {
    var keys = Object.keys(scope).sort();
    var fn = Function.apply(null, keys.concat(['"use strict"; return (' + source + ');']));
    var args = keys.map(function (k) { return scope[k]; });
    var out = fn.apply(null, args);
    return Array.isArray(out) ? out : [];
  } catch (_e) {
    return [];
  }
}

function elementTypeToTag(et) {
  switch (et) {
    case 'container': return 'div';
    case 'text': return 'p';
    case 'image': return 'img';
    case 'fragment': return '';
    default: return 'div';
  }
}

// ---------------------------------------------------------------------------
// Global project CSS — read from \`pages/style.css\` at runtime so the
// invoice inherits font faces, CSS variables, and any design-system
// tokens the rest of the site uses. Missing file is not fatal — some
// projects centralise CSS elsewhere; the external PDF service still
// renders the inline styles in that case.
// ---------------------------------------------------------------------------

var __cachedGlobalCss = null;
function readGlobalCss() {
  if (__cachedGlobalCss != null) return __cachedGlobalCss;
  var candidates = [
    path.join(process.cwd(), 'pages', 'style.css'),
    path.join(process.cwd(), 'styles', 'globals.css'),
    path.join(process.cwd(), 'styles', 'style.css'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) {
        __cachedGlobalCss = fs.readFileSync(candidates[i], 'utf-8');
        return __cachedGlobalCss;
      }
    } catch (_e) { /* try next */ }
  }
  __cachedGlobalCss = '';
  return __cachedGlobalCss;
}

// ---------------------------------------------------------------------------
// HTML document builder
// ---------------------------------------------------------------------------

function buildInvoiceHtml(invoiceData) {
  var scope = buildInvoiceDataScope(invoiceData);

  var body = '';
  var componentName = 'invoice-template';
  if (TEMPLATE_COMPONENT_UIDL && TEMPLATE_COMPONENT_UIDL.node) {
    body = renderNode(TEMPLATE_COMPONENT_UIDL.node, scope, componentName, 0);
  }

  if (!body) {
    // Fallback: minimal HTML so the PDF isn't blank if the UIDL
    // component is missing. Covers older projects generated before
    // the GUI invoice editor landed.
    body = buildFallbackInvoiceHtml(scope);
  }

  var globalCss = readGlobalCss();

  // Minimal normaliser. Chrome's user-agent stylesheet gives block-level
  // text elements (p, h1–h6, ul, ol, dl, blockquote, pre, figure, hr) a
  // default \`margin: 1em 0\`. The invoice-template UIDL uses <p> for every
  // text field and relies on the parent flex container's \`gap\` for
  // spacing between siblings — which means those default margins get
  // *added* on top of \`gap\` and the rendered PDF ends up with ~2×
  // more vertical spacing than the GUI preview shows. Zeroing the
  // browser defaults here lets inline styles from the UIDL (\`gap: 4px\`
  // on the parent, or explicit marginBottom where the editor set one)
  // be the only source of spacing, so the PDF matches the preview line
  // for line. Inline styles beat these universal selectors on specificity
  // so anything the UIDL asks for still wins.
  var resetCss =
    '*{box-sizing:border-box;}' +
    'html,body{margin:0;padding:0;background:#ffffff;}' +
    'p,h1,h2,h3,h4,h5,h6,ul,ol,dl,blockquote,pre,figure,hr,table{margin:0;padding:0;}' +
    'p,h1,h2,h3,h4,h5,h6{line-height:inherit;}' +
    'img{display:block;max-width:100%;height:auto;}' +
    '@page{size:A4;margin:0;}';

  return '<!doctype html><html><head><meta charset="utf-8"><title>Invoice ' +
    escapeHtml(invoiceData.invoiceNumber || '') + '</title>' +
    '<style>' + resetCss + '</style>' +
    '<style>' + globalCss + '</style>' +
    '</head><body>' + body + '</body></html>';
}

function buildFallbackInvoiceHtml(scope) {
  var inv = (scope.invoiceData && scope.invoiceData.Invoice) || {};
  var cust = (scope.invoiceData && scope.invoiceData.Customer) || {};
  var comp = (scope.invoiceData && scope.invoiceData.Company) || {};
  var products = (scope.invoiceData && scope.invoiceData.Products) || [];
  var parts = [];
  parts.push('<div style="padding:32px;font-family:Helvetica,Arial,sans-serif;color:#333;font-size:10pt;">');
  parts.push('<h1 style="text-align:right;font-size:24pt;margin:0 0 4px;">INVOICE</h1>');
  parts.push('<p style="text-align:right;color:#666;margin:0 0 24px;">' + escapeHtml(inv.invoiceNumber || '') + '</p>');
  parts.push('<div style="display:flex;gap:40px;margin-bottom:24px;">');
  parts.push('<div style="flex:1;"><strong>' + escapeHtml(comp.name || '') + '</strong><br/>' +
    escapeHtml(comp.address || '') + '<br/>' +
    escapeHtml(comp.city || '') + '<br/>' +
    escapeHtml(comp.email || '') + '</div>');
  parts.push('<div style="flex:1;"><strong>' + escapeHtml(cust.name || '') + '</strong><br/>' +
    escapeHtml(cust.email || '') + '<br/>' +
    escapeHtml(cust.address || '') + '<br/>' +
    escapeHtml(cust.city || '') + '</div>');
  parts.push('</div>');
  parts.push('<table style="width:100%;border-collapse:collapse;"><thead><tr>' +
    '<th style="text-align:left;border-bottom:2px solid #333;padding:6px;">Item</th>' +
    '<th style="text-align:right;border-bottom:2px solid #333;padding:6px;">Qty</th>' +
    '<th style="text-align:right;border-bottom:2px solid #333;padding:6px;">Unit Price</th>' +
    '<th style="text-align:right;border-bottom:2px solid #333;padding:6px;">Total</th>' +
    '</tr></thead><tbody>');
  products.forEach(function (p) {
    parts.push('<tr>' +
      '<td style="border-bottom:1px solid #eee;padding:6px;">' + (p.variantSwatchesHtml || '') + escapeHtml(p.name) + '</td>' +
      '<td style="border-bottom:1px solid #eee;padding:6px;text-align:right;">' + escapeHtml(p.quantity) + '</td>' +
      '<td style="border-bottom:1px solid #eee;padding:6px;text-align:right;">' + escapeHtml(p.unitPrice) + '</td>' +
      '<td style="border-bottom:1px solid #eee;padding:6px;text-align:right;">' + escapeHtml(p.lineTotal) + '</td>' +
      '</tr>');
  });
  parts.push('</tbody></table>');
  parts.push('<div style="display:flex;justify-content:flex-end;margin-top:16px;"><div style="width:240px;">' +
    '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Subtotal</span><span>' + escapeHtml(inv.subtotal) + '</span></div>' +
    '<div style="display:flex;justify-content:space-between;font-weight:bold;border-top:2px solid #333;padding-top:4px;"><span>Total</span><span>' + escapeHtml(inv.total) + '</span></div>' +
    '</div></div>');
  if (inv.notes) parts.push('<p style="margin-top:24px;color:#666;">' + escapeHtml(inv.notes) + '</p>');
  parts.push('</div>');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Legacy compatibility shims — kept so email templates and admin UIs that
// \`require('utils/invoices/pdf-generator')\` continue to resolve their
// imports. The main PDF path does not use them; removing these would be a
// silent breaking change for older generated code.
// ---------------------------------------------------------------------------

function resolveDynamicProperty(propertyId, scope) {
  if (!propertyId) return '';
  return evaluateExpression(propertyId, scope);
}

function formatValue(value, _format, _data) {
  if (value == null) return '';
  return String(value);
}

function resolveTextSpans(spans, scope) {
  if (!Array.isArray(spans)) return '';
  return spans.map(function (s) {
    if (!s) return '';
    if (s.type === 'static') return String(s.value || '');
    if (s.type === 'dynamic' && s.dynamicPropertyId) {
      return evaluateExpression(s.dynamicPropertyId, scope);
    }
    return '';
  }).join('');
}

function replacePlaceholders(template, data) {
  if (!template) return '';
  return template.replace(/\\{\\{(\\w+)\\}\\}/g, function (match, key) {
    var inv = data.invoice || {};
    var cust = data.customer || {};
    var comp = data.company || {};
    var map = {
      invoiceNumber: inv.number || '',
      customerName: cust.name || '',
      customerEmail: cust.email || '',
      // Formatted, not raw: a merge token carries only a field name, so an
      // unformatted issue/due date would reach the customer's inbox as the
      // stored timestamp. \`formatDateValue\` is the same helper the PDF uses,
      // so the mail and its attachment agree.
      invoiceDate: formatDateValue(inv.issueDate),
      dueDate: formatDateValue(inv.dueDate),
      totalAmount: (inv.currencySymbol || '') + Number(inv.total || 0).toFixed(2),
      subtotal: (inv.currencySymbol || '') + Number(inv.subtotal || 0).toFixed(2),
      taxAmount: (inv.currencySymbol || '') + Number(inv.taxAmount || 0).toFixed(2),
      companyName: comp.name || '',
      companyEmail: comp.email || '',
      invoiceUrl: inv.pdfUrl || '',
    };
    return map[key] != null ? map[key] : match;
  });
}

function evaluateCondition(_condition, _data) { return true; }

function buildDataContext(invoiceData) {
  // Compatibility shim for any external caller that still expects the old
  // \`{ invoice, customer, company, payment, items }\` shape. The PDF
  // renderer above does not use it — it operates on \`invoiceData\` directly.
  return {
    invoice: {
      number: invoiceData.invoiceNumber || '',
      issueDate: invoiceData.issueDate || '',
      dueDate: invoiceData.dueDate || '',
      subtotal: invoiceData.subtotal || 0,
      taxAmount: invoiceData.taxAmount || 0,
      total: invoiceData.total || 0,
      currency: invoiceData.currency || 'USD',
      currencySymbol: invoiceData.currencySymbol || '$',
      notes: invoiceData.notes || '',
      pdfUrl: invoiceData.pdfUrl || '',
    },
    customer: {
      name: invoiceData.customerName || '',
      email: invoiceData.customerEmail || '',
      address: invoiceData.customerAddress || '',
      city: invoiceData.customerCity || '',
    },
    company: {
      name: COMPANY_DETAILS.companyName || '',
      email: COMPANY_DETAILS.companyEmail || '',
    },
    items: invoiceData.items || [],
  };
}
`
}
