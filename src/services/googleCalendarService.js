/**
 * Google Calendar service — reads upcoming events via the Calendar API (OAuth2).
 */

const { google } = require('googleapis');
const { getAuthorizedClient } = require('./googleOAuthService');

async function getUpcomingEvents(maxResults = 20, daysAhead = 7) {
  const auth     = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now    = new Date();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);

  const res = await calendar.events.list({
    calendarId:   'primary',
    timeMin:      now.toISOString(),
    timeMax:      future.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy:      'startTime'
  });

  return (res.data.items || []).map(mapEvent);
}

async function getTodayEvents() {
  const auth     = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const res = await calendar.events.list({
    calendarId:   'primary',
    timeMin:      todayStart.toISOString(),
    timeMax:      todayEnd.toISOString(),
    singleEvents: true,
    orderBy:      'startTime'
  });

  return (res.data.items || []).map(mapEvent);
}

function mapEvent(event) {
  return {
    id:          event.id,
    title:       event.summary   || '(No title)',
    description: event.description || '',
    start:       event.start.dateTime || event.start.date,
    end:         event.end.dateTime   || event.end.date,
    allDay:      !event.start.dateTime,
    location:    event.location   || '',
    attendees:   (event.attendees || []).map(a => ({ email: a.email, name: a.displayName })),
    meetLink:    event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || '',
    status:      event.status
  };
}

module.exports = { getUpcomingEvents, getTodayEvents };
