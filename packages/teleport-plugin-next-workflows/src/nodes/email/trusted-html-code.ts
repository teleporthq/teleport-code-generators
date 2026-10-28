/**
 * HTML the generated code builds itself, for an email template to show as
 * HTML — emitted into the runtime utils next to `applyTemplateParams`.
 *
 * Every value an email template is filled with is escaped, so only the
 * author's template is markup. The one kind of value the platform's own
 * templates show as markup is the products list (`{{productsList}}`, a `<ul>`
 * of the lines in the withdrawal, withdrawal-owner and abandoned-cart emails;
 * the low-stock alert fills its own). Its builders hand the email node the
 * structured lines too (`products`), so the list is built HERE, at send time,
 * from those lines, with every field of a line (name, options, quantity)
 * escaped — never taken from the `productsList` value the node was handed,
 * which a browser may have computed.
 *
 * What this code builds is marked trusted (`trustedHtml`, a registry a
 * request cannot reach: a value that arrived as JSON is never in it), and the
 * template fill inserts only marked values unescaped.
 */
export const PRODUCTS_LIST_PARAM = 'productsList'
export const PRODUCTS_ROWS_PARAM = 'products'

export const TRUSTED_HTML_RUNTIME_CODE = `// HTML this runtime built itself (see trusted-html-code in the generator).
var __trustedHtmlValues = typeof WeakSet === 'function' ? new WeakSet() : null;

function trustedHtml(html) {
  var value = new String(html == null ? '' : html);
  if (__trustedHtmlValues) __trustedHtmlValues.add(value);
  return value;
}

function isTrustedHtml(value) {
  return !!__trustedHtmlValues && value !== null && typeof value === 'object' && __trustedHtmlValues.has(value);
}

// The products list of a platform email ({{${PRODUCTS_LIST_PARAM}}}), from its lines.
function renderProductsListHtml(rows) {
  var html = '<ul style="margin:0;padding-left:18px;">';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
    var name = row.product_name != null ? row.product_name : row.name != null ? row.name : 'Product';
    var quantity = parseInt(row.quantity, 10);
    if (isNaN(quantity) || quantity <= 0) quantity = 1;
    var label = row.configuration_label != null ? String(row.configuration_label) : '';
    html += '<li>' + quantity + '× <strong>' + escapeHtmlText(String(name)) + '</strong>' +
      (label ? ' — ' + escapeHtmlText(label) : '') + '</li>';
  }
  return trustedHtml(html + '</ul>');
}
`
