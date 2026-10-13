/**
 * The bookings' calendar feeds: `pages/api/bookings/ical/[file].js`, emitted
 * when the UIDL carries `bookingCalendars.feedStatement`.
 *
 * Each calendar link of a site's bookings is an iCalendar (RFC 5545) feed that
 * Airbnb, Booking.com, Vrbo or Google Calendar import to block the dates the
 * site has booked. The editor builds the one statement behind every feed (its
 * tables and columns are the editor's business); the generated route only runs
 * it with the link's key and writes the rows out as a calendar.
 */
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generatePgClientCode } from './pg-client-code'
import { getDatabaseDriverDependencies } from './auth-generator'

/**
 * The route's source (CommonJS). GET or HEAD `/api/bookings/ical/<key>.ics`:
 *  - another method → 405 with `Allow: GET, HEAD`;
 *  - a key of the wrong shape, or one the statement returns no calendar row
 *    for → 404 (the key is the link's only credential, so both look the same);
 *  - a failed query → 500 'Calendar unavailable', the cause logged only;
 *  - else 200 with the calendar, never cached. An event row with a missing or
 *    invalid value is left out rather than failing the whole feed.
 */
export const generateBookingCalendarFeedRoute = (feedStatement: string): string => {
  return `'use strict';

// GENERATED — see generateBookingCalendarFeedRoute in
// @teleporthq/teleport-plugin-next-workflows/src/booking-calendar-feed-route-generator.ts.
//
// The iCalendar feed of one calendar link of the site's bookings: Airbnb,
// Booking.com, Vrbo or Google Calendar poll it and block the booked dates.
${generatePgClientCode()}

// Built by the editor: $1 is the link's key. It returns one 'calendar' row and
// one 'event' row per blocked period.
var FEED_STATEMENT = ${JSON.stringify(feedStatement)};
var FEED_FILE_RE = /^([A-Za-z0-9_-]{20,80})[.]ics$/;
var DATE_RE = /^([0-9]{4})([0-9]{2})([0-9]{2})$/;
var DATE_TIME_RE = /^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/;
var TEXT_TYPE = 'text/plain; charset=utf-8';
var CALENDAR_TYPE = 'text/calendar; charset=utf-8';
var CRLF = String.fromCharCode(13, 10);
var BACKSLASH = String.fromCharCode(92);
// RFC 5545: a content line is at most 75 octets, the line break excluded.
var MAX_LINE_OCTETS = 75;

// RFC 5545 TEXT: a backslash, semicolon or comma is escaped with a backslash
// and every line break is written as the two characters backslash and n.
// Other control characters are not allowed in TEXT, so they are dropped.
function icalText(value) {
  var text = String(value == null ? '' : value);
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var code = text.charCodeAt(i);
    if (ch === BACKSLASH || ch === ';' || ch === ',') {
      out += BACKSLASH + ch;
    } else if (code === 13 || code === 10) {
      // CRLF, a lone CR and a lone LF are each one line break.
      if (code === 13 && text.charCodeAt(i + 1) === 10) {
        i += 1;
      }
      out += BACKSLASH + 'n';
    } else if (code === 9 || (code >= 32 && code !== 127)) {
      out += ch;
    }
  }
  return out;
}

// One content line, folded: a continuation line starts with one space (which
// counts toward its 75 octets), and no fold splits a UTF-8 character.
function icalFold(line) {
  var out = '';
  var used = 0;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    var code = line.charCodeAt(i);
    var octets = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (code >= 0xd800 && code <= 0xdbff) {
      var low = line.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        // A surrogate pair is one 4-octet character.
        ch = line.slice(i, i + 2);
        octets = 4;
        i += 1;
      }
    }
    if (used + octets > MAX_LINE_OCTETS) {
      out += CRLF + ' ';
      used = 1;
    }
    out += ch;
    used += octets;
  }
  return out + CRLF;
}

// all_day as Postgres hands it over: a boolean, or 't' / 'f' / 'true' / 'false'.
// null for anything else.
function icalAllDay(value) {
  if (value === true || value === false) {
    return value;
  }
  var text = String(value == null ? '' : value).trim().toLowerCase();
  if (text === 't' || text === 'true') {
    return true;
  }
  if (text === 'f' || text === 'false') {
    return false;
  }
  return null;
}

// 'YYYYMMDD' (all day) or 'YYYYMMDDTHHMMSSZ' naming a real day and time, else
// null — a value like 20260231 would otherwise reach the importing calendar.
function icalDateValue(value, allDay) {
  if (typeof value !== 'string') {
    return null;
  }
  var text = value.trim();
  var match = (allDay ? DATE_RE : DATE_TIME_RE).exec(text);
  if (!match) {
    return null;
  }
  var parts = [];
  for (var i = 1; i <= 6; i++) {
    parts.push(allDay && i > 3 ? 0 : Number(match[i]));
  }
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  var actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return actual.join(',') === parts.join(',') ? text : null;
}

// The VEVENT lines of one event row, or null when a value is missing or invalid.
function icalEventLines(row, stamp) {
  var uid = row.uid == null ? '' : String(row.uid).trim();
  var allDay = icalAllDay(row.all_day);
  if (uid === '' || allDay === null) {
    return null;
  }
  var start = icalDateValue(row.start_value, allDay);
  var end = icalDateValue(row.end_value, allDay);
  // The end is exclusive, so it must come after the start. Two values of the
  // same format compare correctly as strings.
  if (start === null || end === null || end <= start) {
    return null;
  }
  var valueParam = allDay ? ';VALUE=DATE:' : ':';
  return [
    'BEGIN:VEVENT',
    'UID:' + icalText(uid),
    'DTSTAMP:' + stamp,
    'DTSTART' + valueParam + start,
    'DTEND' + valueParam + end,
    'SUMMARY:' + icalText(row.summary),
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

// 'YYYYMMDDTHHMMSSZ' of an instant, in UTC.
function icalStamp(date) {
  var iso = date.toISOString();
  return (
    iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + 'T' +
    iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z'
  );
}

function icalCalendar(calendarRow, rows, now) {
  var stamp = icalStamp(now);
  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeleportHQ//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icalText(calendarRow.calendar_name),
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].kind === 'event') {
      var eventLines = icalEventLines(rows[i], stamp);
      if (eventLines) {
        lines = lines.concat(eventLines);
      }
    }
  }
  lines.push('END:VCALENDAR');
  var body = '';
  for (var j = 0; j < lines.length; j++) {
    body += icalFold(lines[j]);
  }
  return body;
}

// Never cached: a booking can block a date between two polls. A HEAD request
// gets the headers GET would, without the body.
function icalSend(res, status, contentType, body, headOnly) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
  if (headOnly) {
    res.end();
  } else {
    res.end(body);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return icalSend(res, 405, TEXT_TYPE, 'Method not allowed', false);
  }
  var headOnly = req.method === 'HEAD';
  var file = req.query && typeof req.query.file === 'string' ? req.query.file : '';
  var fileMatch = FEED_FILE_RE.exec(file);
  if (!fileMatch) {
    return icalSend(res, 404, TEXT_TYPE, 'Not found', headOnly);
  }

  var rows = null;
  var client = null;
  try {
    client = getClient();
    await client.connect();
    var result = await client.query(FEED_STATEMENT, [fileMatch[1]]);
    rows = result && Array.isArray(result.rows) ? result.rows : [];
  } catch (e) {
    console.error('[bookings-ical] calendar feed query failed:', e && e.message ? e.message : e);
  } finally {
    if (client) {
      try { await client.end(); } catch (e) {}
    }
  }
  if (rows === null) {
    return icalSend(res, 500, TEXT_TYPE, 'Calendar unavailable', headOnly);
  }

  var calendarRow = null;
  for (var i = 0; i < rows.length && calendarRow === null; i++) {
    if (rows[i] && rows[i].kind === 'calendar') {
      calendarRow = rows[i];
    }
  }
  if (calendarRow === null) {
    return icalSend(res, 404, TEXT_TYPE, 'Not found', headOnly);
  }
  res.setHeader('Content-Disposition', 'inline; filename="' + file + '"');
  return icalSend(res, 200, CALENDAR_TYPE, icalCalendar(calendarRow, rows, new Date()), headOnly);
};
`
}

/**
 * Emits the feed route when the UIDL names a feed statement, plus the `pg`
 * driver it connects with (already present on a project with a Teleport
 * database, which every bookings site has).
 */
export const generateBookingCalendarFeedFiles = (structure: ProjectPluginStructure): void => {
  const feedStatement = structure.uidl.bookingCalendars?.feedStatement
  if (typeof feedStatement !== 'string' || feedStatement.trim() === '') {
    return
  }

  structure.files.set('bookings-ical-feed-route', {
    path: ['pages', 'api', 'bookings', 'ical'],
    files: [
      {
        name: '[file]',
        fileType: FileType.JS,
        content: generateBookingCalendarFeedRoute(feedStatement),
      },
    ],
  })

  const driverDependencies = getDatabaseDriverDependencies('teleport')
  for (const [pkg, version] of Object.entries(driverDependencies)) {
    if (!structure.dependencies[pkg]) {
      structure.dependencies[pkg] = version
    }
  }
}
