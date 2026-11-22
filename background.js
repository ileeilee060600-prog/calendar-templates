// Service worker: Google sign-in (OAuth implicit flow with the user's own client id)
// and every Calendar API call. The page never sees the token.
'use strict';
importScripts('config.js');

const API ='https://www.googleapis.com/calendar/v3';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';

class Err extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

let tokenPromise = null;
let calCache = null;

async function clientId() {
  const { settings } = await chrome.storage.sync.get('settings');
  return ((settings && settings.clientId) || self.CT_CONFIG.clientId || '').trim();
}

async function getToken(interactive) {
  const { tok } = await chrome.storage.session.get('tok');
  if (tok && tok.exp > Date.now() + 60000) return tok.v;
  if (tokenPromise && !interactive) return tokenPromise;
  const run = (async () => {
    const id = await clientId();
    if (!id) throw new Err('NO_CLIENT');
    const p = new URLSearchParams({
      client_id: id, response_type: 'token', scope: SCOPES,
      redirect_uri: chrome.identity.getRedirectURL(), include_granted_scopes: 'true'
    });
    // With several Google accounts signed in, a silent renewal needs to be told which one,
    // otherwise Google asks "choose an account" and the renewal fails.
    const { account } = await chrome.storage.local.get('account');
    if (account) p.set('login_hint', account);
    if (!interactive) p.set('prompt', 'none');
    let res;
    try {
      const opts = { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p, interactive };
      if (!interactive) { opts.abortOnLoadForNonInteractive = false; opts.timeoutMsForNonInteractive = 8000; }
      res = await chrome.identity.launchWebAuthFlow(opts);
    } catch (e) { throw new Err('AUTH', e && e.message); }
    const frag = new URLSearchParams(new URL(res).hash.slice(1));
    const v = frag.get('access_token');
    if (!v) throw new Err('AUTH', frag.get('error') || 'No token returned');
    await chrome.storage.session.set({ tok: { v, exp: Date.now() + (+frag.get('expires_in') || 3600) * 1000 } });
    return v;
  })();
  tokenPromise = run;
  try { return await run; } finally { if (tokenPromise === run) tokenPromise = null; }
}

async function api(path, opt = {}, retry = true) {
  const t = await getToken(false);
  const url = API + path + (opt.query ? '?' + new URLSearchParams(opt.query) : '');
  const r = await fetch(url, {
    method: opt.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + t }, opt.body ? { 'Content-Type': 'application/json' } : {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  if (r.status === 401 && retry) { await chrome.storage.session.remove('tok'); return api(path, opt, false); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Err('API', (j && j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}

async function calendars() {
  if (calCache && calCache.t > Date.now() - 5 * 60000) return calCache.v;
  const j = await api('/users/me/calendarList', {
    query: { minAccessRole: 'reader', fields: 'items(id,summary,backgroundColor,primary,selected,accessRole)' }
  });
  const v = (j.items || []).map(c => ({
    id: c.id, name: c.summary, color: c.backgroundColor, primary: !!c.primary,
    selected: c.selected !== false || !!c.primary,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer'
  }));
  calCache = { t: Date.now(), v };
  // The primary calendar's id is the signed-in account's address: remember it as the sign-in hint.
  const primary = v.find(c => c.primary);
  if (primary && /@/.test(primary.id)) chrome.storage.local.set({ account: primary.id }).catch(() => {});
  return v;
}

const EVENT_FIELDS = 'items(id,summary,start,end,colorId,transparency,status,organizer(self),attendees(self,responseStatus),description,location,reminders)';

function mapEvent(e, cal, writable) {
  const me = (e.attendees || []).find(a => a.self);
  if (e.status === 'cancelled' || (me && me.responseStatus === 'declined')) return null;
  return {
    id: e.id, cal, title: e.summary || '(No title)',
    start: Date.parse(e.start.dateTime || e.start.date), end: Date.parse(e.end.dateTime || e.end.date),
    allDay: !e.start.dateTime, colorId: e.colorId || '', free: e.transparency === 'transparent',
    // Only personal blocks can be dragged: never meetings with guests or other people's events.
    canEdit: !!writable && !!e.start.dateTime && (e.attendees || []).length <= 1 && (!e.organizer || e.organizer.self === true)
  };
}

const handlers = {
  async connect() {
    await getToken(true);
    calCache = null;
    return { calendars: await calendars() };
  },
  async disconnect() {
    const { tok } = await chrome.storage.session.get('tok');
    await chrome.storage.session.remove('tok');
    await chrome.storage.local.remove('account');
    calCache = null;
    if (tok) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tok.v), { method: 'POST' }).catch(() => {});
    return true;
  },
  async calendars() { return calendars(); },
  async day({ from, to }) {
    const cals = await calendars();
    const shown = cals.filter(c => c.selected).slice(0, 8);
    const lists = await Promise.all(shown.map(c =>
      api('/calendars/' + encodeURIComponent(c.id) + '/events', {
        query: {
          timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
          singleEvents: 'true', orderBy: 'startTime', maxResults: '100', fields: EVENT_FIELDS
        }
      }).then(j => (j.items || []).map(e => mapEvent(e, c.id, c.writable)).filter(Boolean)).catch(() => [])
    ));
    return { calendars: cals, events: [].concat(...lists) };
  },
  async recent() {
    const now = Date.now();
    const j = await api('/calendars/primary/events', {
      query: {
        timeMin: new Date(now - 45 * 86400000).toISOString(), timeMax: new Date(now).toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250', fields: EVENT_FIELDS
      }
    });
    const map = new Map();
    for (const e of (j.items || [])) {
      if (!e.start || !e.start.dateTime || !e.summary || e.status === 'cancelled') continue;
      const key = e.summary.trim().toLowerCase();
      const dur = Math.round((Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime)) / 60000);
      const rem = e.reminders && !e.reminders.useDefault && e.reminders.overrides
        ? e.reminders.overrides.filter(o => o.method === 'popup').map(o => o.minutes) : [0];
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { title: e.summary.trim(), duration: dur, colorId: e.colorId || '',
        description: e.description || '', location: e.location || '', reminders: rem, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  },
  async create({ calendarId, event }) {
    const j = await api('/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events', { method: 'POST', body: event });
    return { id: j.id, link: j.htmlLink };
  },
  async move({ calendarId, id, start, end, tz }) {
    await api('/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(id), {
      method: 'PATCH', query: { sendUpdates: 'none', fields: 'id' },
      body: { start: { dateTime: new Date(start).toISOString(), timeZone: tz }, end: { dateTime: new Date(end).toISOString(), timeZone: tz } }
    });
    return true;
  },
  async remove({ calendarId, id }) {
    await api('/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(id), { method: 'DELETE' });
    return true;
  },
  async openOptions() { await chrome.runtime.openOptionsPage(); return true; }
};

chrome.runtime.onMessage.addListener((m, sender, send) => {
  const h = handlers[m && m.type];
  if (!h) return false;
  h(m).then(r => send({ ok: true, r }), e => send({ ok: false, code: e.code || 'ERR', error: e.message }));
  return true;
});

chrome.action.onClicked.addListener(async tab => {
  if (tab && tab.url && /^https:\/\/calendar\.google\.com\//.test(tab.url)) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'toggle' }); return; } catch (e) { /* tab predates the extension */ }
    chrome.tabs.reload(tab.id);
  } else {
    chrome.tabs.create({ url: 'https://calendar.google.com/calendar/r' });
  }
});

chrome.runtime.onInstalled.addListener(async d => {
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
  // Open Calendar tabs keep running the old content script until refreshed; refresh them so an update takes effect at once.
  if (d.reason === 'update') {
    const tabs = await chrome.tabs.query({ url: 'https://calendar.google.com/*' }).catch(() => []);
    for (const t of tabs) chrome.tabs.reload(t.id).catch(() => {});
  }
});
