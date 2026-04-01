/**
 * ICS / iCal calendar service.
 *
 * Fetches one or more .ics feed URLs and returns upcoming events.
 * No API keys needed — just a shareable calendar URL from:
 *   Google Calendar → Settings → "Secret address in iCal format"
 *   Apple Calendar  → Share Calendar → copy URL
 *   Outlook         → Calendar → Share → "View only (ICS)"
 *   Nextcloud/other → public calendar link ending in .ics
 *
 * Calendar URLs are stored in db.json under settings.calendarUrls[].
 */

const ical  = require('node-ical');
const store = require('../data/store');

// ── URL management (persisted in db.json) ─────────────────────────────────

function getCalendarUrls() {
  const settings = store.settings || {};
  return settings.calendarUrls || [];
}

function saveCalendarUrls(urls) {
  const settings = store.settings || {};
  store.save({ settings: { ...settings, calendarUrls: urls } });
}

function addCalendarUrl(label, url) {
  const urls = getCalendarUrls();
  // Avoid duplicates
  if (urls.some(u => u.url === url)) {
    throw new Error('This calendar URL is already added');
  }
  urls.push({ label: label || url, url, addedAt: new Date().toISOString() });
  saveCalendarUrls(urls);
  return urls;
}

function removeCalendarUrl(index) {
  const urls = getCalendarUrls();
  if (index < 0 || index >= urls.length) throw new Error('Index out of range');
  urls.splice(index, 1);
  saveCalendarUrls(urls);
  return urls;
}

// ── Event fetching ─────────────────────────────────────────────────────────

async function fetchUrlEvents(url, daysAhead = 30) {
  const data   = await ical.async.fromURL(url);
  const now    = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 86400 * 1000);
  const events = [];

  for (const key of Object.keys(data)) {
    const e = data[key];
    if (e.type !== 'VEVENT') continue;

    // Handle recurring events (node-ical expands them with rrule)
    const start = e.start instanceof Date ? e.start : new Date(e.start);
    const end   = e.end   instanceof Date ? e.end   : new Date(e.end || start);

    if (isNaN(start.getTime())) continue;
    if (start < now || start > cutoff) continue;

    events.push({
      id:          e.uid   || key,
      title:       e.summary     || '(No title)',
      description: e.description || '',
      start:       start.toISOString(),
      end:         end.toISOString(),
      allDay:      !(e.start instanceof Date && e.start.dateOnly !== true) && !e.datetype?.includes('date-time'),
      location:    e.location    || '',
      meetLink:    extractMeetLink(e)
    });
  }

  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

function extractMeetLink(event) {
  // Look for Google Meet or Zoom links in description or URL
  const haystack = [event.description || '', event.url || '', event.location || ''].join(' ');
  const meetMatch = haystack.match(/https:\/\/meet\.google\.com\/[a-z-]+/);
  const zoomMatch = haystack.match(/https:\/\/[\w.]*zoom\.us\/j\/[^\s"<]+/);
  return meetMatch?.[0] || zoomMatch?.[0] || '';
}

async function getUpcomingEvents(daysAhead = 7) {
  const urls = getCalendarUrls();
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(
    urls.map(u => fetchUrlEvents(u.url, daysAhead).then(evts =>
      evts.map(ev => ({ ...ev, calendarLabel: u.label }))
    ))
  );

  const events = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

async function getTodayEventCount() {
  const urls = getCalendarUrls();
  if (urls.length === 0) return 0;

  const events = await getUpcomingEvents(1);
  const today  = new Date().toDateString();
  return events.filter(e => new Date(e.start).toDateString() === today).length;
}

module.exports = {
  getCalendarUrls,
  addCalendarUrl,
  removeCalendarUrl,
  getUpcomingEvents,
  getTodayEventCount
};
