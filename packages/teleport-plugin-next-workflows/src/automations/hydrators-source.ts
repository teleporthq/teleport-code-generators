/**
 * `lib/automations/hydrate/<entity>.js`: the record an event is about, read
 * from the database when the event is delivered, in the shape of the
 * business-event catalog's details (teleport-gui
 * `packages/workflow-schema/src/constants/business-events.ts`). Every module
 * exports `hydrate(client, row, payload, context)` (`context.baseUrl`: the
 * app's origin, for links), which resolves the envelope blocks
 * it read (`{ order }`, `{ giftCards, order }`, …).
 *
 * The record is the truth: the dispatcher lays the hydrated block OVER the
 * payload (a ledger row can be written by a caller, the record cannot), and
 * an event whose record is not there (a deleted row, a forged id, a table the
 * project lacks) is refused — "No such <entity>", no automation runs. A module
 * therefore returns no entity block when it finds no record. Any other failed
 * read throws, and the event is retried.
 *
 * Credentials and codes never leave the tables: every block names its
 * fields. A form submission has no row of its own (its block is the
 * submission, recorded whole), so `form` has no module.
 */

export interface HydratorOptions {
  /** The auth users table (`resolveAuthUsersTableName`), for the user block. */
  usersTable: string
  /**
   * Where the order details page is served (`/orders`, its `[order_number]`
   * slot dropped), for `order.pageUrl`; null when the project has no order
   * details page, and the link is then left out.
   */
  orderPagePrefix: string | null
}

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** A statement as a JS string literal in the generated source. */
const sql = (text: string): string => JSON.stringify(text)

const HEADER = (entity: string) => `'use strict';
/**
 * Automations: the ${entity} an event is about (generated).
 */
var store = require('../store');
var num = store.toNumber;
var iso = store.toIso;
var text = store.toText;
`

const orderReference = `async function orderReference(client, orderId) {
  if (!orderId) return null;
  var order = await store.firstRow(client, ${sql(
    'SELECT id, order_number FROM teleport_orders WHERE id = $1 LIMIT 1'
  )}, [String(orderId)]);
  return order ? { id: String(order.id), number: text(order.order_number) } : null;
}
`

const orderHydrator = (options: HydratorOptions): string => `${HEADER('order')}
var REFUND_TYPES = ['order-refunded', 'order-partially-refunded', 'order-refund-failed'];
var SHIPMENT_TYPES = ['order-shipment-created', 'order-shipment-updated', 'order-shipment-delivered'];

function lineOf(item) {
  var metadata = store.parseJson(item.metadata) || {};
  var unitPaid = num(item.unit_price_paid);
  var totalPaid = num(item.total_price_paid);
  return {
    productId: text(item.product_id),
    name: text(item.product_name) || '',
    variantLabel: text(item.variant_label),
    sku: text(metadata.sku),
    quantity: num(item.quantity) || 0,
    unitPrice: unitPaid !== null ? unitPaid : num(item.unit_price),
    total: totalPaid !== null ? totalPaid : num(item.total_price),
  };
}

async function customerOf(client, order) {
  var customer = {
    email: text(order.billing_email) || text(order.shipping_email),
    name: text(order.billing_name) || text(order.shipping_name),
    phone: text(order.shipping_phone),
  };
  if ((!customer.email || !customer.name) && order.user_id) {
    var user = await store.firstRow(client, ${sql(
      `SELECT email, name FROM ${quoteIdentifier(options.usersTable)} WHERE id = $1 LIMIT 1`
    )}, [String(order.user_id)]);
    if (user) {
      customer.email = customer.email || text(user.email);
      customer.name = customer.name || text(user.name);
    }
  }
  return customer;
}

// The order details page, keyed by the order number (see order-details-route).
var ORDER_PAGE_PREFIX = ${JSON.stringify(options.orderPagePrefix)};

// 'online' is how checkout records a provider payment; the provider is the method.
function paymentMethodOf(order) {
  var method = text(order.payment_method);
  return !method || method === 'online' ? text(order.payment_provider) || method : method;
}

async function readOrder(client, orderId, baseUrl) {
  var order = await store.firstRow(client, ${sql(
    'SELECT * FROM teleport_orders WHERE id = $1 LIMIT 1'
  )}, [String(orderId)]);
  if (!order) return null;
  var rows = await store.allRows(client, ${sql(
    'SELECT * FROM teleport_order_items WHERE order_id = $1 ORDER BY created_at'
  )}, [String(orderId)]);
  var items = rows.map(lineOf);
  // At the lines' shop prices, after product discounts: total_price, not what was paid.
  var subtotal = rows.reduce(function (sum, item) {
    var shopTotal = num(item.total_price);
    return sum + (shopTotal !== null ? shopTotal : num(item.total_price_paid) || 0);
  }, 0);
  var number = text(order.order_number);
  var hasShippingAddress = !!(order.shipping_address || order.shipping_city || order.shipping_country);
  return {
    id: String(order.id),
    number: number,
    status: text(order.status),
    paymentStatus: text(order.payment_status),
    total: num(order.total_amount),
    subtotal: subtotal,
    tax: num(order.tax_amount) || 0,
    shipping: num(order.shipping_amount) || 0,
    discount: num(order.discount_amount) || 0,
    currency: text(order.currency),
    itemCount: items.reduce(function (sum, line) { return sum + (line.quantity || 0); }, 0),
    items: items,
    customer: await customerOf(client, order),
    billingAddress: order.billing_name || order.billing_address
      ? { name: text(order.billing_name), address: text(order.billing_address) }
      : null,
    shippingAddress: hasShippingAddress
      ? {
          name: text(order.shipping_name),
          address: text(order.shipping_address),
          city: text(order.shipping_city),
          state: text(order.shipping_state),
          postalCode: text(order.shipping_zip),
          country: text(order.shipping_country),
          phone: text(order.shipping_phone),
        }
      : null,
    fulfillmentMethod: text(order.fulfillment_method) || 'delivery',
    paymentMethod: paymentMethodOf(order),
    voucherCode: text(order.voucher_code),
    notes: text(order.notes),
    locale: text(order.locale),
    pageUrl: ORDER_PAGE_PREFIX && number && baseUrl
      ? baseUrl + ORDER_PAGE_PREFIX + '/' + encodeURIComponent(number)
      : undefined,
    createdAt: iso(order.created_at),
  };
}

// The blocks some order events carry besides the order, from the timeline
// fields their writers record (amount, provider, carrier, from / to, …).
async function extrasOf(client, type, payload, order) {
  var extras = {};
  var currency = text(payload.currency) || (order ? order.currency : null);
  if (type === 'order-status-changed') {
    extras.from = text(payload.from);
    extras.to = text(payload.to) || (order ? order.status : null);
  }
  if (REFUND_TYPES.indexOf(type) !== -1) {
    extras.refund = {
      amount: num(payload.amount),
      currency: currency,
      provider: text(payload.provider) || 'manual',
      reason: text(payload.reason),
    };
  }
  if (SHIPMENT_TYPES.indexOf(type) !== -1) {
    var shipment = {
      id: text(payload.shipmentId),
      carrier: text(payload.carrier),
      trackingNumber: text(payload.trackingNumber),
      trackingUrl: null,
      status: type === 'order-shipment-delivered' ? 'delivered' : 'shipped',
    };
    var parcel = shipment.id
      ? await store.firstRow(client, ${sql(
        'SELECT * FROM teleport_shipments WHERE id = $1 LIMIT 1'
      )}, [shipment.id])
      : null;
    if (parcel) {
      shipment.carrier = text(parcel.carrier) || shipment.carrier;
      shipment.trackingNumber = text(parcel.tracking_number) || shipment.trackingNumber;
      shipment.trackingUrl = text(parcel.tracking_url);
      shipment.status = text(parcel.status) || shipment.status;
    }
    extras.shipment = shipment;
  }
  if (type === 'order-awaiting-confirmation' || type === 'order-late-payment') {
    extras.payment = { provider: text(payload.provider) || (order ? order.paymentMethod : null) };
  }
  if (type === 'order-duplicate-payment' || type === 'order-underpaid') {
    extras.payment = {
      provider: text(payload.provider) || (order ? order.paymentMethod : null),
      reference: text(payload.paymentRef),
      amount: num(payload.amount),
      currency: currency,
    };
    if (type === 'order-underpaid') {
      extras.payment.amountDue = order ? order.total : null;
    }
  }
  if (type === 'order-digital-delivered') {
    extras.delivery = {
      fileCount: num(payload.fileCount) || 0,
      licenseKeyCount: num(payload.licenseKeyCount) || 0,
    };
  }
  return extras;
}

async function hydrate(client, row, payload, context) {
  var orderId = row.order_id || row.entity_id;
  var order = orderId ? await readOrder(client, orderId, context && context.baseUrl) : null;
  var blocks = await extrasOf(client, row.event_type, payload, order);
  if (order) blocks.order = order;
  return blocks;
}

module.exports = { hydrate: hydrate };
`

const subscriptionHydrator = (): string => `${HEADER('subscription')}
async function hydrate(client, row, payload) {
  var id = row.entity_id || payload.subscriptionId;
  if (!id) return {};
  var subscription = await store.firstRow(client, ${sql(
    'SELECT * FROM teleport_subscriptions WHERE id = $1 LIMIT 1'
  )}, [String(id)]);
  if (!subscription) return {};
  return {
    subscription: {
      id: String(subscription.id),
      status: text(subscription.status),
      planName: [text(subscription.product_name), text(subscription.variant_label)].filter(Boolean).join(' - '),
      amount: num(subscription.amount),
      currency: text(subscription.currency),
      interval: text(subscription.interval),
      intervalCount: num(subscription.interval_count) || 1,
      nextBillingAt: iso(subscription.next_billing_at),
      customer: { email: text(subscription.customer_email), name: text(subscription.customer_name) },
    },
  };
}

module.exports = { hydrate: hydrate };
`

const giftCardsHydrator = (): string => `${HEADER('gift cards')}
${orderReference}
// One event per order covers every card issued on it; codes are never read.
async function hydrate(client, row) {
  var orderId = row.order_id || row.entity_id;
  var order = await orderReference(client, orderId);
  // The cards are the order's: no order, no event.
  if (!order) return {};
  var cards = await store.allRows(client, ${sql(
    'SELECT id, initial_amount, currency, recipient_email FROM teleport_gift_cards WHERE order_id = $1 ORDER BY created_at'
  )}, [String(orderId)]);
  return {
    giftCards: cards.map(function (card) {
      return {
        id: String(card.id),
        amount: num(card.initial_amount),
        currency: text(card.currency),
        recipientEmail: text(card.recipient_email),
      };
    }),
    order: order,
  };
}

module.exports = { hydrate: hydrate };
`

const giftCardHydrator = (): string => `${HEADER('gift card')}
${orderReference}
// The card credited is the order's latest card movement; its code is never read.
async function hydrate(client, row, payload) {
  var orderId = row.order_id || row.entity_id;
  var order = await orderReference(client, orderId);
  // The credit is the order's: no order, no event.
  if (!order) return {};
  var amount = num(payload.giftCardAmount);
  var giftCard = {
    id: null,
    amount: amount !== null ? amount : num(payload.amount),
    currency: text(payload.currency),
  };
  var movement = await store.firstRow(client, ${sql(
    'SELECT gift_card_id, amount FROM teleport_gift_card_transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1'
  )}, [String(orderId)]);
  if (movement) {
    giftCard.id = text(movement.gift_card_id);
    if (giftCard.amount === null) giftCard.amount = num(movement.amount);
  }
  if (giftCard.id && !giftCard.currency) {
    var card = await store.firstRow(client, ${sql(
      'SELECT currency FROM teleport_gift_cards WHERE id = $1 LIMIT 1'
    )}, [giftCard.id]);
    giftCard.currency = card ? text(card.currency) : null;
  }
  return { giftCard: giftCard, order: order };
}

module.exports = { hydrate: hydrate };
`

const invoiceHydrator = (): string => `${HEADER('invoice')}
async function hydrate(client, row, payload) {
  var id = payload.invoiceId || row.entity_id;
  var invoice = id
    ? await store.firstRow(client, ${sql(
      'SELECT * FROM teleport_invoices WHERE id = $1 LIMIT 1'
    )}, [String(id)])
    : null;
  if (!invoice && row.order_id) {
    invoice = await store.firstRow(client, ${sql(
      'SELECT * FROM teleport_invoices WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1'
    )}, [String(row.order_id)]);
  }
  if (!invoice) return {};
  var order = invoice.order_id
    ? await store.firstRow(client, ${sql(
      'SELECT order_number FROM teleport_orders WHERE id = $1 LIMIT 1'
    )}, [String(invoice.order_id)])
    : null;
  return {
    invoice: {
      id: String(invoice.id),
      number: text(invoice.invoice_number),
      total: num(invoice.total),
      currency: text(invoice.currency),
      pdfUrl: text(invoice.pdf_url),
      issuedAt: iso(invoice.issue_date),
      orderId: text(invoice.order_id),
      orderNumber: order ? text(order.order_number) : null,
      customer: { email: text(invoice.customer_email), name: text(invoice.customer_name) },
    },
  };
}

module.exports = { hydrate: hydrate };
`

const bookingHydrator = (): string => `${HEADER('booking')}
// "2026-10-29 11:00" in the booking's own time zone.
function localTime(value, timeZone) {
  var at = value instanceof Date ? value : new Date(value);
  if (!timeZone || isNaN(at.getTime())) return null;
  try {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at).forEach(function (part) { parts[part.type] = part.value; });
    return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
  } catch (_e) {
    return null;
  }
}

async function hydrate(client, row) {
  if (!row.entity_id) return {};
  var booking = await store.firstRow(client, ${sql(
    'SELECT * FROM teleport_bookings WHERE id = $1 LIMIT 1'
  )}, [String(row.entity_id)]);
  if (!booking) return {};
  var timeZone = text(booking.timezone);
  return {
    booking: {
      id: String(booking.id),
      reference: text(booking.reference),
      status: text(booking.status),
      itemId: text(booking.item_id),
      itemName: text(booking.item_name),
      start: iso(booking.starts_at),
      end: iso(booking.ends_at),
      timezone: timeZone,
      startLocal: localTime(booking.starts_at, timeZone),
      endLocal: localTime(booking.ends_at, timeZone),
      guests: num(booking.guests) || 1,
      total: num(booking.total_price),
      currency: text(booking.currency),
      customer: {
        email: text(booking.customer_email),
        name: text(booking.customer_name),
        phone: text(booking.customer_phone),
      },
      notes: text(booking.notes),
    },
  };
}

module.exports = { hydrate: hydrate };
`

const userHydrator = (options: HydratorOptions): string => `${HEADER('account')}
// A deleted account has no row left: the deletion route records the event
// after its commit, with the account as it was. Only that route records
// user-deleted (the editor's shared event writer refuses the types only
// generated routes record, see automations-scope.ts), so for this type the
// snapshot is the record, when it names the account the event is about.
function deletedAccount(row, payload) {
  var snapshot = store.isPlainObject(payload.user) ? payload.user : null;
  if (row.event_type !== 'user-deleted' || !snapshot || String(snapshot.id) !== String(row.entity_id)) {
    return null;
  }
  return {
    user: {
      id: String(snapshot.id),
      email: text(snapshot.email),
      name: text(snapshot.name),
      role: text(snapshot.role),
      source: text(snapshot.source),
      createdAt: iso(snapshot.createdAt),
    },
  };
}

// The profile only: the row's credentials are never read into an event.
async function hydrate(client, row, payload) {
  if (!row.entity_id) return {};
  var user = await store.firstRow(client, ${sql(
    `SELECT * FROM ${quoteIdentifier(options.usersTable)} WHERE id = $1 LIMIT 1`
  )}, [String(row.entity_id)]);
  if (!user) return deletedAccount(row, payload) || {};
  var fullName = [text(user.first_name), text(user.last_name)].filter(Boolean).join(' ');
  // Where the account came from, as its route recorded it (the row may keep no such column).
  var recordedSource = store.isPlainObject(payload.user) ? payload.user.source : payload.source;
  return {
    user: {
      id: String(user.id),
      email: text(user.email),
      name: text(user.name) || fullName || null,
      role: text(user.role),
      source: text(recordedSource) || text(user.source),
      createdAt: iso(user.created_at || user.createdAt),
    },
  };
}

module.exports = { hydrate: hydrate };
`

const cartHydrator = (): string => `${HEADER('abandoned cart')}
async function hydrate(client, row, payload) {
  if (!row.entity_id) return {};
  var id = String(row.entity_id);
  var cart = await store.firstRow(client, ${sql(
    'SELECT * FROM teleport_abandoned_carts WHERE cart_id = $1 LIMIT 1'
  )}, [id]);
  if (!cart) {
    cart = await store.firstRow(client, ${sql(
      'SELECT * FROM teleport_abandoned_carts WHERE id = $1 LIMIT 1'
    )}, [id]);
  }
  // The abandoned cart's own row: none, no event.
  if (!cart) return {};
  var cartId = cart.cart_id ? String(cart.cart_id) : id;
  var lines = await store.allRows(client, ${sql(
    'SELECT ci.product_id, ci.quantity, p.name, p.price, p.sku FROM teleport_cart_items ci LEFT JOIN teleport_products p ON p.id = ci.product_id WHERE ci.cart_id = $1'
  )}, [cartId]);
  return {
    cart: {
      id: cartId,
      email: text(cart.customer_email),
      items: lines.map(function (line) {
        var quantity = num(line.quantity) || 0;
        var price = num(line.price);
        return {
          productId: text(line.product_id),
          name: text(line.name) || '',
          variantLabel: null,
          sku: text(line.sku),
          quantity: quantity,
          unitPrice: price,
          total: price === null ? null : price * quantity,
        };
      }),
      total: num(cart.cart_total),
      currency: text(cart.currency),
      recoveryUrl: text(payload.recoveryUrl),
    },
  };
}

module.exports = { hydrate: hydrate };
`

const productHydrator = (): string => `${HEADER('product')}
async function hydrate(client, row, payload) {
  if (!row.entity_id) return {};
  var product = await store.firstRow(client, ${sql(
    'SELECT id, name, sku, quantity FROM teleport_products WHERE id = $1 LIMIT 1'
  )}, [String(row.entity_id)]);
  if (!product) return {};
  var block = {
    id: String(product.id),
    name: text(product.name),
    sku: text(product.sku),
    stock: num(product.quantity),
  };
  if (row.event_type === 'product-low-stock') {
    // The level the scan compared against, as the data API recorded it.
    block.threshold = num(store.isPlainObject(payload.product) ? payload.product.threshold : payload.threshold);
  }
  return { product: block };
}

module.exports = { hydrate: hydrate };
`

const reviewHydrator = (): string => `${HEADER('review')}
async function hydrate(client, row) {
  if (!row.entity_id) return {};
  var review = await store.firstRow(client, ${sql(
    'SELECT * FROM teleport_product_reviews WHERE id = $1 LIMIT 1'
  )}, [String(row.entity_id)]);
  if (!review) return {};
  return {
    review: {
      id: String(review.id),
      productId: text(review.product_id),
      productName: text(review.product_name),
      rating: num(review.rating),
      title: text(review.title),
      body: text(review.content) || text(review.body),
      authorName: text(review.reviewer_name),
      authorEmail: text(review.reviewer_email),
    },
  };
}

module.exports = { hydrate: hydrate };
`

// The waitlist plugin's tables (teleport-project-generator-next
// `waitlist/settings.ts` WAITLIST_TABLES, which this package cannot import).
const WAITLIST_ENTRIES_TABLE = 'teleport_waitlist_entries'
const WAITLISTS_TABLE = 'teleport_waitlists'

const subscriberHydrator = (options: HydratorOptions): string => `${HEADER('newsletter subscriber')}
// A subscriber is a contact: a row of the users table (the newsletter
// sign-up writes it), found by the event's id, else by the address recorded.
async function hydrate(client, row, payload) {
  var contact = null;
  if (row.entity_id) {
    contact = await store.firstRow(client, ${sql(
      `SELECT * FROM ${quoteIdentifier(options.usersTable)} WHERE id = $1 LIMIT 1`
    )}, [String(row.entity_id)]);
  } else {
    var recorded = store.isPlainObject(payload.subscriber) ? text(payload.subscriber.email) : null;
    contact = recorded
      ? await store.firstRow(client, ${sql(
        `SELECT * FROM ${quoteIdentifier(
          options.usersTable
        )} WHERE LOWER(email) = LOWER($1) LIMIT 1`
      )}, [recorded])
      : null;
  }
  if (!contact || !contact.email) return {};
  var subscriber = { email: text(contact.email) };
  var source = text(contact.source);
  if (source) subscriber.source = source;
  if (contact.marketing_consent !== undefined && contact.marketing_consent !== null) {
    subscriber.consent = contact.marketing_consent === true || contact.marketing_consent === 'true';
  }
  return { subscriber: subscriber };
}

module.exports = { hydrate: hydrate };
`

const waitlistHydrator = (): string => `${HEADER('waitlist entry')}
async function hydrate(client, row, payload, context) {
  if (!row.entity_id) return {};
  var entry = await store.firstRow(client, ${sql(
    `SELECT * FROM ${WAITLIST_ENTRIES_TABLE} WHERE id = $1 LIMIT 1`
  )}, [String(row.entity_id)]);
  if (!entry) return {};
  var list = await store.firstRow(client, ${sql(
    `SELECT * FROM ${WAITLISTS_TABLE} WHERE id = $1 LIMIT 1`
  )}, [String(entry.waitlist_id)]);
  if (!list) return {};
  var targetUrl = text(list.target_url);
  if (targetUrl && targetUrl.indexOf('/') === 0 && context && context.baseUrl) {
    targetUrl = context.baseUrl + targetUrl;
  }
  var position = num(entry.position);
  return {
    waitlist: {
      id: String(list.id),
      kind: text(list.kind),
      targetId: text(list.target_id),
      targetLabel: text(list.target_label),
      targetUrl: targetUrl,
      entry: {
        id: String(entry.id),
        email: text(entry.email),
        name: text(entry.name),
        position: position === null ? undefined : position,
        status: text(entry.status),
      },
    },
  };
}

module.exports = { hydrate: hydrate };
`

const HYDRATORS: Record<string, (options: HydratorOptions) => string> = {
  order: orderHydrator,
  subscription: subscriptionHydrator,
  giftCards: giftCardsHydrator,
  giftCard: giftCardHydrator,
  invoice: invoiceHydrator,
  booking: bookingHydrator,
  user: userHydrator,
  cart: cartHydrator,
  product: productHydrator,
  review: reviewHydrator,
  subscriber: subscriberHydrator,
  waitlist: waitlistHydrator,
}

/** The module source for `entity`, or null when it has no table to read. */
export const generateAutomationHydratorCode = (
  entity: string,
  options: HydratorOptions
): string | null => {
  const generator = HYDRATORS[entity]
  return generator ? generator(options) : null
}
