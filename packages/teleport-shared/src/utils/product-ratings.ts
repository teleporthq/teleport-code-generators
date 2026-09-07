/**
 * The aggregate-rating rule, as ES5 source for embedding into generated runtime
 * code (the data-source product transform) that cannot import from this package.
 *
 * ⚠️ SECOND MIRROR. The editor/canvas copy is teleport-gui's
 * `features/e-commerce/utils/product-ratings.ts`, and the two must agree exactly
 * or the canvas shows one rating and the deployed store shows another — the
 * divergence class that hid the variant picker for a whole release. The GUI's
 * `utils/__tests__/product-rating-parity.spec.ts` and this package's
 * `__tests__/product-ratings.test.ts` run the SAME fixture table against their
 * respective copies.
 *
 * Three rules the whole feature rests on (stated in full in the GUI copy):
 *
 *  - Only APPROVED reviews count. The predicate lives in the SQL, never here.
 *  - "No reviews" and "we could not look" both render as NOTHING — never as
 *    "0.0 ★☆☆☆☆", which reads as a product everyone hated.
 *  - The label and the stars round from the SAME number: one decimal for the
 *    label, that value snapped to the nearest half for the stars.
 *
 * Everything is prefixed `__pr` so the block can be concatenated into any
 * generated module without colliding with its locals — it is emitted alongside
 * the `__pd` discount helpers and the storefront-tax helpers.
 */
export const generateProductRatingHelperCode = (): string => `
// ── Aggregate product ratings ────────────────────────────────────────────────
// Turns the batched COUNT/AVG of a product's APPROVED reviews into the fields
// the card and the details page bind: a one-decimal label, a count, a
// 'true'/'false' gate and five per-slot fill states.
//
// Strings throughout (except the two numbers) to match the storefront's
// string-equality convention: rendering conditions compare operands as TEXT and
// a bound text node prints its value verbatim.
var __PR_MAX_STARS = 5;

// Mean rounded to one decimal, clamped to the 1-5 scale. Clamping is not
// paranoia: \`rating\` is a plain integer column and an import or a hand-written
// UPDATE can put a 7 in it, which would ask for a star slot that does not exist.
function __prRoundAverage(average) {
  var raw = Number(average);
  if (!isFinite(raw) || !(raw > 0)) return 0;
  var clamped = Math.min(__PR_MAX_STARS, raw);
  return Math.round(clamped * 10) / 10;
}

// The value the STARS are drawn from: the label average snapped to the nearest
// half, so the stars can never disagree with the number printed beside them.
function __prHalfStar(roundedAverage) {
  return Math.round(roundedAverage * 2) / 2;
}

// Fill state of one 1-based slot. At 4.5: slots 1-4 full, slot 5 half.
function __prStarFill(slot, halfSnapped) {
  if (halfSnapped >= slot) return 'full';
  if (halfSnapped >= slot - 0.5) return 'half';
  return 'empty';
}

// Every product carries these keys; this is the "no reviews" answer, and it is
// also what a FAILED lookup returns — the two are deliberately indistinguishable.
function __prEmptyRatingFields() {
  return {
    ratingAverage: 0,
    ratingCount: 0,
    ratingAverageLabel: '',
    ratingCountLabel: '',
    hasRatings: 'false',
    ratingStar1: 'empty',
    ratingStar2: 'empty',
    ratingStar3: 'empty',
    ratingStar4: 'empty',
    ratingStar5: 'empty'
  };
}

function __prBuildRatingFields(aggregate) {
  var rawCount = aggregate ? Number(aggregate.count) : 0;
  var count = isFinite(rawCount) ? Math.max(0, Math.trunc(rawCount)) : 0;
  var average = __prRoundAverage(aggregate ? aggregate.average : 0);

  // A count with no usable average (every row NULL) is not a rating anyone can
  // read, so it degrades to "no reviews" rather than to zero stars.
  if (count <= 0 || average <= 0) return __prEmptyRatingFields();

  var half = __prHalfStar(average);
  return {
    ratingAverage: average,
    ratingCount: count,
    ratingAverageLabel: average.toFixed(1),
    ratingCountLabel: String(count),
    hasRatings: 'true',
    ratingStar1: __prStarFill(1, half),
    ratingStar2: __prStarFill(2, half),
    ratingStar3: __prStarFill(3, half),
    ratingStar4: __prStarFill(4, half),
    ratingStar5: __prStarFill(5, half)
  };
}`
