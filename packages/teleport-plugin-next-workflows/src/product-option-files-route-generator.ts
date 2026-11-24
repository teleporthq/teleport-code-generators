/**
 * `pages/api/ecommerce/option-files.js`: deletes the product-option files an
 * add to cart uploaded but the cart did not take. A shopper's file is uploaded
 * only when its line goes into the cart; when the add is then refused (a
 * missing choice, stock, a limit, an error), the page posts the ids no cart
 * line shows here (`POST { files: [id] }`, same-origin JSON, 30 calls per 10
 * minutes per visitor). A guest adds to the cart too, so no session is asked.
 *
 * The ids are only a hint. A file is deleted only when BOTH hold — the storage
 * worker lists it in the product-option folder (only the add to cart uploads
 * there), and no order line or saved cart line shows it (their `configuration`
 * holds the file's address). A product photo, a review photo, a profile photo
 * or a file an order carries is left alone. The answer is the same either way
 * (`{ success, deleted }`): the add already answered the shopper, so a storage
 * failure is logged, never shown.
 */
import { generatePgClientCode } from './pg-client-code'
import { securityRuntimeSpecifier } from './security-runtime'
import {
  FILE_ID_PATTERN,
  UPLOAD_RELEASE_STORAGE_SOURCE,
} from './account-profile-photo-route-generator'
import { SAME_ORIGIN_REQUEST_FUNCTION, SAME_ORIGIN_REQUEST_SOURCE } from './same-origin-request'

/** ⛔ PAIRED with `PRODUCT_OPTION_FILES_ROUTE` in teleport-gui `product-options-add-to-cart-uploads.ts`. */
export const PRODUCT_OPTION_FILES_ROUTE = '/api/ecommerce/option-files'

/**
 * The runtime-storage folder the add to cart uploads option files into.
 * ⛔ PAIRED with `PRODUCT_OPTION_UPLOAD_FOLDER` in teleport-gui
 * `product-options-upload-custom-node.ts`.
 */
export const PRODUCT_OPTION_UPLOAD_FOLDER = 'product-options'

/** The most file ids one call names (one add uploads one file per upload option). */
const MAX_FILES = 30

/** The tables whose `configuration` names a line's files. */
const LINE_TABLES = ['teleport_order_items', 'teleport_cart_items']

export const generateProductOptionFilesRoute = (): string => `${generatePgClientCode()}
var security = require(${JSON.stringify(securityRuntimeSpecifier('../../..'))});

var FOLDER = ${JSON.stringify(PRODUCT_OPTION_UPLOAD_FOLDER)};
var FILE_ID = new RegExp(${JSON.stringify(FILE_ID_PATTERN)}, 'i');
var MAX_FILES = ${MAX_FILES};
var LINE_TABLES = ${JSON.stringify(LINE_TABLES)};
var RATE_LIMIT = { scope: 'ecommerce-option-files', limit: 30, windowSeconds: 600 };
var STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var STORAGE_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var STORAGE_PROJECT = process.env.RUNTIME_STORAGE_PROJECT_ID;

${SAME_ORIGIN_REQUEST_SOURCE}
${UPLOAD_RELEASE_STORAGE_SOURCE}
// The named files the add to cart uploaded: the ones storage lists in the option folder.
async function optionFilesAmong(ids) {
  var response = await storage(
    '/files?folder=' + encodeURIComponent(FOLDER) + '&limit=' + ids.length + '&ids=' + ids.map(encodeURIComponent).join(','),
    'GET'
  );
  if (!response.ok) {
    throw new Error('storage answered ' + response.status);
  }
  var data = await response.json();
  var listed = Array.isArray(data && data.files) ? data.files : [];
  return listed
    .map(function (file) { return String((file && file.id) || '').toLowerCase(); })
    .filter(function (id) { return ids.indexOf(id) !== -1; });
}

// Of these ids, the ones an order line or a saved cart line still shows. Only
// the tables this store has are read.
async function filesStillShown(ids) {
  var client = getClient();
  await client.connect();
  try {
    var present = await client.query(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'configuration' AND table_name = ANY($1::text[])",
      [LINE_TABLES]
    );
    var tables = present.rows.map(function (row) { return row.table_name; });
    if (tables.length === 0) {
      return [];
    }
    var shows = tables
      .map(function (table) {
        return 'EXISTS (SELECT 1 FROM ' + table + " l WHERE COALESCE(l.configuration, '') LIKE '%/' || f.id || '/%')";
      })
      .join(' OR ');
    var result = await client.query(
      'SELECT f.id FROM unnest($1::text[]) AS f(id) WHERE ' + shows,
      [ids]
    );
    return result.rows.map(function (row) { return String(row.id); });
  } finally {
    await client.end().catch(function () {});
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await security.rateLimitRequest(req, res, RATE_LIMIT))) {
    return;
  }
  if (!${SAME_ORIGIN_REQUEST_FUNCTION}(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  var body = req.body && typeof req.body === 'object' ? req.body : {};
  var ids = [];
  (Array.isArray(body.files) ? body.files : []).forEach(function (value) {
    var id = String(value == null ? '' : value).trim().toLowerCase();
    if (FILE_ID.test(id) && ids.indexOf(id) === -1 && ids.length < MAX_FILES) {
      ids.push(id);
    }
  });
  if (ids.length === 0 || !STORAGE_URL || !STORAGE_KEY || !STORAGE_PROJECT) {
    return res.status(200).json({ success: true, deleted: 0 });
  }
  var deleted = 0;
  try {
    var optionIds = await optionFilesAmong(ids);
    var shown = optionIds.length > 0 ? await filesStillShown(optionIds) : [];
    var unused = optionIds.filter(function (id) { return shown.indexOf(id) === -1; });
    for (var i = 0; i < unused.length; i++) {
      try {
        var answer = await storage('/files/' + encodeURIComponent(unused[i]), 'DELETE');
        if (answer.ok || answer.status === 404) {
          deleted += 1;
        }
      } catch (error) {
        console.error('[ecommerce] an option file could not be removed:', error && error.message);
      }
    }
  } catch (error) {
    console.error('[ecommerce] option files could not be checked:', error && error.message);
  }
  return res.status(200).json({ success: true, deleted: deleted });
}
`
