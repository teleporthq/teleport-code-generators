import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  BOOKING_KEY_STORAGE_PREFIX,
  generateAddressKeyKeeperSource,
  injectAddressKeyKeeper,
  shouldKeepBookingKeysOutOfTheAddress,
} from '../address-key-keeper'

/**
 * A customer's booking link carries the booking's manage key: in its query
 * (`/booking/BK-…?key=…` or `/booking?ref=BK-…&key=…`) on every link already
 * emailed, in its fragment (`/booking/BK-…#key=…`) on the address the payment
 * provider sends the customer back to (teleport-gui `buildManageUrlScript`;
 * a fragment never reaches a server or a Referer). Whoever holds the key may
 * read and cancel the booking, so it must leave the address before any other
 * script of the page can read it: an analytics or ads pixel the owner added
 * reads `location.href`.
 *
 * So the first script of the page's `<head>` (the first global asset) is this
 * one, ahead of the owner's scripts and custom head code. On a page whose
 * address names a booking reference (`BK-` and at least six letters or
 * digits, in `ref` or as the last path segment) and a `key` (query or
 * fragment), it keeps the key in the tab's sessionStorage under
 * `tq-booking-key:<REFERENCE>` and replaces the address with the same one
 * without `key` — so a customer who returns in another tab or browser still
 * reaches the booking. The booking page's own step
 * that reads the link takes the key from there (teleport-gui's
 * `EXTRACT_MANAGE_LINK_SCRIPT`). Where storage refuses the write (a locked-down
 * browser), the address is left as it was and the page reads the key from it
 * as before.
 *
 * The script ships only to a site with Bookings whose workflows read the kept
 * key (they name the storage prefix): a site exported by an editor that still
 * reads the key from the address keeps working exactly as it did.
 *
 * The booking rule is one rule of the site's one address-key keeper
 * (`../address-key-keeper.ts`), which keeps a password-reset link's token the
 * same way.
 */

export { BOOKING_KEY_STORAGE_PREFIX, shouldKeepBookingKeysOutOfTheAddress }

/** The keeper of a site whose only kept key is the booking's. */
export const BOOKING_KEY_KEEPER_SOURCE = generateAddressKeyKeeperSource({ bookingKeys: true })

/** Makes the site's keeper (booking keys and reset tokens) the first script of `<head>`. Idempotent. */
export const injectBookingKeyKeeper = (uidl: ProjectUIDL): void => injectAddressKeyKeeper(uidl)
