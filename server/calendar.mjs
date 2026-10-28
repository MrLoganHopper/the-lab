import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { overlaps } from './scheduling.mjs';

const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events'
];

export function oauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function oauthClient(tokens = null) {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  if (tokens) auth.setCredentials(tokens);
  return auth;
}

export function authorizationUrl(state) {
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

export async function exchangeCode(code) {
  const auth = oauthClient();
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  const info = await google.oauth2({ version: 'v2', auth }).userinfo.get();
  if (!info.data.id || !info.data.email) throw new Error('Could not obtain Google account identity');
  return { userKey: `google:${info.data.id}`, email: info.data.email, displayName: info.data.name || info.data.email.split('@')[0], tokens };
}

export async function getCalendarEvents(tokens, date, zone) {
  const auth = oauthClient(tokens);
  const calendar = google.calendar({ version: 'v3', auth });
  const first = DateTime.fromISO(date, { zone }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const last = first.set({ hour: 20 });
  const { data: list } = await calendar.calendarList.list({ maxResults: 250 });
  const calendars = (list.items || []).filter(c => c.selected !== false && c.accessRole !== 'none');
  const ids = calendars.map(c => c.id).filter(Boolean);
  if (!ids.length) ids.push('primary');
  const { data: free } = await calendar.freebusy.query({ requestBody: {
    timeMin: first.toUTC().toISO(), timeMax: last.toUTC().toISO(), timeZone: zone, items: ids.map(id => ({ id }))
  }});
  const failed = Object.entries(free.calendars || {}).filter(([,v]) => v.errors?.length);
  if (failed.length || ids.some(id => !free.calendars?.[id])) throw new Error('Could not check all selected Google Calendars. Please try again.');
  const busy = ids.flatMap(id => (free.calendars[id].busy || []).map(b => ({ ...b, title: 'Busy', calendarId: id })));
  // Names are fetched separately and are never sent to anyone except the signed-in owner.
  // Failure to read titles does not affect availability since the FreeBusy check succeeded.
  const titles = [];
  for (const c of calendars) {
    try {
      const { data } = await calendar.events.list({calendarId: c.id, timeMin: first.toUTC().toISO(), timeMax: last.toUTC().toISO(), singleEvents: true, showDeleted: false, maxResults: 2500});
      for (const e of data.items || []) {
        if (e.transparency === 'transparent' || e.status === 'cancelled') continue;
        const start = e.start?.dateTime || e.start?.date && DateTime.fromISO(e.start.date, { zone }).startOf('day').toUTC().toISO();
        const end = e.end?.dateTime || e.end?.date && DateTime.fromISO(e.end.date, { zone }).startOf('day').toUTC().toISO();
        if (start && end && e.summary) titles.push({ start, end, title: e.visibility === 'private' ? 'Private event' : e.summary, calendarId: c.id });
      }
    } catch { /* free/busy stays authoritative */ }
  }
  return busy.map(b => {
    const name = titles.find(t => t.calendarId === b.calendarId && overlaps(t.start,t.end,b.start,b.end));
    return { start: DateTime.fromISO(b.start).toUTC().toISO(), end: DateTime.fromISO(b.end).toUTC().toISO(), title: name?.title || 'Busy' };
  }).sort((a,b) => a.start.localeCompare(b.start));
}

export async function createCalendarEvent(tokens, start, end, zone) {
  const auth = oauthClient(tokens);
  const calendar = google.calendar({ version: 'v3', auth });
  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: 'the lab cafe',
      location: 'Cardinal Gardens, USC, Los Angeles, CA',
      description: 'Reservation for The Lab Cafe. See you there!',
      start: { dateTime: DateTime.fromISO(start).setZone(zone).toISO(), timeZone: zone },
      end: { dateTime: DateTime.fromISO(end).setZone(zone).toISO(), timeZone: zone },
    }
  });
  return response.data.id;
}

export async function deleteCalendarEvent(tokens, id) {
  await google.calendar({ version: 'v3', auth: oauthClient(tokens) }).events.delete({calendarId:'primary',eventId:id});
}

export function demoBusy(date, zone) {
  const fmt = (hours, minutes) => DateTime.fromISO(date, { zone }).set({hour:hours,minute:minutes}).toUTC().toISO();
  return [
    {start:fmt(10,0),end:fmt(11,0),title:'Morning class'},
    {start:fmt(11,0),end:fmt(12,0),title:'Project meeting'},
    {start:fmt(12,0),end:fmt(12,30),title:'Lunch with friends'},
    {start:fmt(15,0),end:fmt(15,30),title:'Studio time'},
    {start:fmt(16,0),end:fmt(16,30),title:'Team check-in'}
  ];
}
