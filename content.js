// In-page planner for Google Calendar: a command palette with a live, draggable day timeline.
// Built with DOM nodes only (Calendar enforces Trusted Types, so no innerHTML).
(() => {
  'use strict';
  if (window.__ctLoaded) return;
  window.__ctLoaded = true;
  const CT = self.CT;

  const H = 3600000, MIN = 60000;
  const PX = 64;        // timeline pixels per hour, at most (scaled down to fit the day)
  const PX_MIN = 26;    // below this the timeline scrolls instead
  const GUT = 54;       // left gutter for hour labels
  const MAC = /Mac/i.test(navigator.platform);
  const ALT = MAC ? '⌥' : 'Alt ';

  // ---------------------------------------------------------------- state
  const S = {
    open: false, mode: 'list', day: null, templates: [], sel: 0, query: '',
    pin: null, pinDur: null,                     // start / length chosen on the timeline
    events: [], cals: [], auth: 'loading', authMsg: '', recent: [],
    settings: Object.assign({}, CT.DEFAULTS), nudging: false, lastGhost: null, noScroll: false,
    editSave: null, cache: new Map(), mineIds: new Set(), drag: null, dirty: false, geo: null, suppressClick: false
  };
  let host = null, root = null, R = {}, toastTimer = null, tickTimer = null;
  const BLK = new WeakMap();   // timeline element -> event
  const PTR_EVENTS = ['pointermove', 'mousemove', 'pointerover', 'pointerout', 'mouseover', 'mouseout'];
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } })();

  // ---------------------------------------------------------------- helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'value') value = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }
  const ICONS = {
    left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    right: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
    history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    schedule: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
  };
  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONS[name]); p.setAttribute('fill', 'currentColor');
    s.append(p); return s;
  }
  const tf = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
  const hf = new Intl.DateTimeFormat([], { hour: 'numeric' });
  const fmtTime = ms => tf.format(ms);
  function fmtDur(m) {
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }
  // Only shown when it differs from the default ("At time of event").
  function remShort(arr) {
    if (!arr || !arr.length) return 'no reminder';
    if (arr.length === 1 && arr[0] === 0) return '';
    return arr.slice().sort((a, b) => a - b).map(m => m === 0 ? 'at start' : (m >= 60 ? m / 60 + 'h before' : m + 'm before')).join(', ');
  }
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayKey = d => CT.dayAt(d, '00:00');
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function dayParts(d) {
    const diff = Math.round((midnight(d) - midnight(new Date())) / 86400000);
    const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long' });
    return [h('b', {}, rel), h('span', {}, d.toLocaleDateString([], { month: 'short', day: 'numeric' }))];
  }
  function viewDay() {
    const m = location.pathname.match(/\/r\/[a-z0-9]+\/(\d{4})\/(\d{1,2})\/(\d{1,2})/i);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : midnight(new Date());
  }
  function send(msg) {
    return new Promise((res, rej) => {
      try {
        chrome.runtime.sendMessage(msg, r => {
          const le = chrome.runtime.lastError;
          if (le) return rej({ code: 'EXT', error: le.message });
          if (!r) return rej({ code: 'EXT', error: 'No response' });
          r.ok ? res(r.r) : rej(r);
        });
      } catch (e) { rej({ code: 'EXT', error: 'The extension was reloaded. Refresh this tab.' }); }
    });
  }
  const colorOf = (colorId, cal) => CT.colorHex(colorId) || (cal && cal.color) || '#4285f4';
  // Text on an event color: dark on light colors (Banana, Sage…), white otherwise — as Calendar does.
  function onColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#fff';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.66 ? '#1f1f1f' : '#fff';
  }
  const tint = color => '--c:' + color + ';--onc:' + onColor(color);
  const calById = id => S.cals.find(c => c.id === id) || S.cals.find(c => c.primary);
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ---------------------------------------------------------------- planning
  function currentItem() { return buildItems()[S.sel] || null; }

  // ov: {start, dur} from a drop on the timeline
  function plan(item, ov) {
    if (!item || (item.type !== 'tpl' && item.type !== 'adhoc')) return null;
    ov = ov || {};
    const tok = CT.parseTokens(S.query);
    const tpl = item.tpl || null;
    const dur = ov.dur || S.pinDur || tok.duration || (tpl && tpl.duration) || 30;
    const day = S.day;
    let start, how;
    if (ov.start != null) { start = ov.start; how = 'dropped'; }
    else if (S.pin != null) { start = S.pin; how = 'pinned'; }
    else if (tok.startMin != null) { start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, tok.startMin).getTime(); how = 'at your time'; }
    else if (tpl && tpl.startTime) { start = CT.dayAt(day, tpl.startTime); how = 'template start time'; }
    else {
      let from = CT.dayAt(day, S.settings.dayStart);
      if (sameDay(day, new Date())) from = Math.max(from, CT.ceil5(Date.now()));
      start = CT.findSlot(S.events.filter(e => !e.allDay && !e.free).map(e => [e.start, e.end]), dur, from);
      how = 'next free slot';
    }
    const end = start + dur * MIN;
    const title = tpl ? (tpl.title || tpl.name) : tok.text.charAt(0).toUpperCase() + tok.text.slice(1);
    const colorId = tpl ? tpl.colorId : '';
    const reminders = tpl ? (tpl.reminders || []) : [0];
    const calendarId = (tpl && tpl.calendarId) || 'primary';
    const event = {
      summary: title, description: (tpl && tpl.description) || '', location: (tpl && tpl.location) || '',
      start: { dateTime: new Date(start).toISOString(), timeZone: tz() },
      end: { dateTime: new Date(end).toISOString(), timeZone: tz() },
      reminders: { useDefault: false, overrides: reminders.map(m => ({ method: 'popup', minutes: m })) },
      extendedProperties: { private: { ct: '1' } }   // marks the block as ours, so it can be removed later
    };
    if (colorId) event.colorId = colorId;
    return { title, dur, start, end, how, colorId, calendarId, event, tpl };
  }

  function buildItems() {
    const tok = CT.parseTokens(S.query), text = tok.text, low = text.toLowerCase();
    if (S.mode === 'import') {
      return S.recent.filter(r => !text || r.title.toLowerCase().includes(low)).map(r => ({ type: 'recent', r }));
    }
    const scored = S.templates.map((t, i) => ({ t, i, s: CT.matchScore(t.name, text) })).filter(x => x.s > 0);
    if (text) scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const items = scored.map(x => ({ type: 'tpl', tpl: x.t, idx: x.i }));
    if (text && !S.templates.some(t => t.name.toLowerCase() === low)) items.push({ type: 'adhoc', text });
    return items;
  }

  // ---------------------------------------------------------------- UI shell
  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.theme{color-scheme:light;--card:#f0f4f9;--panel:#fff;--field:#fff;--hi:#e9eef6;--hst:#dde3ea;--on:#1f1f1f;--var:#444746;--faint:#747775;--grid:rgba(68,71,70,.13);--divider:rgba(68,71,70,.14);--state:rgba(31,31,31,.08);--sec:#c2e7ff;--onsec:#001d35;--primary:#0b57d0;--onprimary:#fff;--inv:#303030;--oninv:#f2f2f2;--invprimary:#a8c7fa;--error:#b3261e;--scrim:rgba(0,0,0,.32);--elev:0 1px 3px rgba(0,0,0,.3),0 4px 8px 3px rgba(0,0,0,.15);--elev1:0 1px 2px rgba(0,0,0,.3),0 1px 3px 1px rgba(0,0,0,.15)}
.theme.dark{color-scheme:dark;--card:#1e1f20;--panel:#131314;--field:#282a2c;--hi:#282a2c;--hst:#333537;--on:#e3e3e3;--var:#c4c7c5;--faint:#8e918f;--grid:rgba(196,199,197,.09);--divider:rgba(196,199,197,.12);--state:rgba(227,227,227,.08);--sec:#004a77;--onsec:#c2e7ff;--primary:#a8c7fa;--onprimary:#062e6f;--inv:#e3e3e3;--oninv:#303030;--invprimary:#0b57d0;--error:#f2b8b5;--scrim:rgba(0,0,0,.5);--elev:0 1px 3px rgba(0,0,0,.45),0 4px 8px 3px rgba(0,0,0,.3);--elev1:0 1px 2px rgba(0,0,0,.45),0 1px 3px 1px rgba(0,0,0,.3)}
.scrim{position:fixed;inset:0;background:var(--scrim);z-index:2147483600;display:flex;justify-content:center;align-items:flex-start;padding:8vh 16px 0;font:14px/1.43 "Google Sans Text","Google Sans",Roboto,Arial,sans-serif;color:var(--on);animation:fade .2s cubic-bezier(.2,0,0,1);-webkit-font-smoothing:antialiased}
.card{width:min(900px,100%);max-height:86vh;background:var(--card);border-radius:28px;box-shadow:var(--elev);display:flex;flex-direction:column;overflow:hidden;animation:pop .3s cubic-bezier(.05,.7,.1,1);position:relative;contain:layout paint;isolation:isolate}
@keyframes fade{from{opacity:0}}@keyframes pop{from{opacity:0;transform:translateY(-12px) scale(.97)}}
.card[data-mode=edit] .listview{display:none}.card:not([data-mode=edit]) .editview{display:none}
.card[data-mode=import] .boxtools,.card[data-mode=import] .free{display:none}
.listview,.editview{display:flex;flex-direction:column;min-height:0;flex:1}
.scrim,.card{-webkit-user-select:none;user-select:none}
.q,.in{-webkit-user-select:text;user-select:text}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
svg{flex:none}
.list,.tl,.form{scrollbar-width:thin;scrollbar-color:var(--hst) transparent;overscroll-behavior:contain}

.head{display:flex;align-items:center;gap:8px;padding:16px 16px 4px}
.search{flex:1;min-width:0;display:flex;align-items:center;gap:14px;height:56px;padding:0 20px 0 18px;background:var(--field);border-radius:28px}
.search svg{width:22px;height:22px;color:var(--var)}
.q{flex:1;border:0;outline:0;background:none;font:400 17px/24px "Google Sans","Google Sans Text",Roboto,Arial,sans-serif;color:var(--on);min-width:0;caret-color:var(--primary)}
.q::placeholder{color:var(--faint)}
.daynav{display:flex;align-items:center;height:56px;padding:0 8px;background:var(--field);border-radius:28px;flex:none}
.daynav button{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--var);transition:background .15s}
.daynav button:hover{background:var(--state)}.daynav svg{width:22px;height:22px}
.lbl{font:500 15px "Google Sans",Roboto,Arial,sans-serif;padding:0 4px;white-space:nowrap;text-align:center;min-width:130px}
.lbl span{font-weight:400;color:var(--var);margin-left:6px}
.sum{display:flex;align-items:center;gap:8px;min-height:52px;padding:8px 18px}
.sum .hint{color:var(--var);padding-left:6px}
.sum .sp{flex:1}
.chipx{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 16px 0 10px;border-radius:8px;background:var(--hi);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;white-space:nowrap}
.theme:not(.dark) .chipx{background:var(--panel)}
.chipx svg{width:18px;height:18px;color:var(--primary)}
.chipx .how{font-weight:400;color:var(--var)}
.chipx.pin{background:var(--sec);color:var(--onsec);padding:0 6px 0 12px}
.chipx.pin button{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:inherit}
.chipx.pin button:hover{background:var(--state)}.chipx.pin svg{width:16px;height:16px;color:inherit}

.body{display:flex;gap:12px;padding:0 12px 12px;height:min(600px,calc(86vh - 170px));min-height:280px}
.left{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.box{background:var(--panel);border-radius:20px;display:flex;flex-direction:column;min-height:0}
.box.tpl{flex:1 1 auto}.box.free{flex:none}
.boxhead{display:flex;align-items:center;gap:4px;min-height:56px;padding:8px 8px 6px 20px}
.boxtitle{font:500 15px "Google Sans",Roboto,Arial,sans-serif}
.boxsub{color:var(--var);font-size:12.5px;padding-right:10px;font-variant-numeric:tabular-nums}
.boxtools{display:flex;align-items:center;gap:4px}
.ibtn{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--var);transition:background .15s}
.ibtn:hover{background:var(--state);color:var(--on)}.ibtn svg{width:20px;height:20px}
.mini{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px 0 10px;border-radius:18px;color:var(--primary);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;transition:background .15s}
.mini:hover{background:var(--state)}.mini svg{width:18px;height:18px}
.list{flex:1;min-height:0;overflow:auto;padding:2px 8px 8px}
.gaps{display:flex;flex-wrap:wrap;gap:8px;padding:4px 16px 16px}
.gap{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:8px;background:var(--hi);color:var(--on);font:500 13px "Google Sans Text",Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;transition:background .15s,color .15s}
.theme:not(.dark) .gap{background:var(--card)}
.gap span{font-weight:400;color:var(--var)}
.gap:hover{filter:brightness(1.06)}
.gap.on,.theme:not(.dark) .gap.on{background:var(--sec);color:var(--onsec)}.gap.on span{color:inherit;opacity:.8}
.none{color:var(--var);font-size:13px;padding:2px 4px 6px}
.actions{display:flex;align-items:center;gap:8px;padding:10px 4px 2px;flex-wrap:wrap}
.fab{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 20px 0 16px;border-radius:16px;background:var(--sec);color:var(--onsec);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;box-shadow:var(--elev1);transition:box-shadow .15s,filter .15s}
.fab:hover{box-shadow:var(--elev)}.fab svg{width:20px;height:20px}
.tbtn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 12px;border-radius:20px;color:var(--primary);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;transition:background .15s}
.tbtn:hover{background:var(--state)}.tbtn svg{width:18px;height:18px}
.tl{width:min(390px,45%);flex:none;background:var(--panel);border-radius:20px;overflow:auto;position:relative;contain:strict}

.row{position:relative;display:flex;align-items:center;gap:14px;height:48px;padding:0 12px 0 18px;border-radius:14px;cursor:pointer;transition:background .15s;touch-action:none}
.row+.row::before{content:"";position:absolute;left:18px;right:18px;top:0;border-top:1px solid var(--divider);transition:opacity .15s}
.row.sel::before,.row.sel+.row::before,.row:hover::before,.row:hover+.row::before{opacity:0}
.row:hover{background:var(--state)}
.row.sel{background:var(--sec);color:var(--onsec)}
.dot{width:12px;height:12px;border-radius:50%;flex:none;background:var(--c)}
.lead{width:20px;margin:0 -4px;display:flex;justify-content:center;color:var(--var);flex:none}.lead svg{width:20px;height:20px}
.row.sel .lead{color:inherit}
.name{font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.meta{color:var(--var);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.sp{flex:1}
.dur{color:var(--var);font-size:13px;flex:none;font-variant-numeric:tabular-nums}
.row.sel .meta,.row.sel .dur{color:inherit;opacity:.78}
.hk{font-size:11px;color:var(--faint);flex:none;width:36px;text-align:right;opacity:0;transition:opacity .15s}
.row:hover .hk,.row.sel .hk{opacity:1}.row.sel .hk{color:inherit;opacity:.6}
.edit{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:inherit;flex:none;border-radius:50%;opacity:0;transition:opacity .15s,background .15s}
.row:hover .edit{opacity:.8}.edit:hover{background:var(--state);opacity:1}.edit svg{width:18px;height:18px}
.empty{padding:28px;text-align:center;color:var(--var)}

.foot{display:flex;align-items:center;gap:18px;padding:0 24px 14px;color:var(--faint);font-size:12px;white-space:nowrap;overflow:hidden}
.foot kbd{font:500 11px "Google Sans Text",Roboto,Arial,sans-serif;background:var(--hst);color:var(--var);border-radius:4px;padding:1px 6px;margin-right:6px}
.foot .sp{flex:1}

.grid{position:relative;margin:14px 0 12px;contain:layout style}
.hr{position:absolute;left:${GUT - 2}px;right:0;border-top:1px solid var(--grid)}
.hr.half{display:none}
.hl{position:absolute;left:-${GUT - 4}px;top:-7px;font:500 10px "Google Sans Text",Roboto,Arial,sans-serif;letter-spacing:.03em;color:var(--faint);width:${GUT - 12}px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.blk{position:absolute;left:${GUT}px;width:calc(100% - ${GUT + 10}px);border-radius:6px;background:var(--c);color:var(--onc,#fff);padding:3px 8px;font:500 12px/15px "Google Sans Text",Roboto,Arial,sans-serif;overflow:hidden;box-shadow:0 0 0 1px var(--panel);transition:box-shadow .2s;contain:layout paint style}
.blk .t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk small{display:block;font-weight:400;font-size:11px;opacity:.9;white-space:nowrap;font-variant-numeric:tabular-nums}
.blk.short{display:flex;gap:6px;align-items:center;padding-top:0;padding-bottom:0}
.blk.short .t{flex:0 1 auto;min-width:0}.blk.short small{flex:none}
.blk.narrow.short small{display:none}
.blk.can{cursor:grab}
.blk.pending{opacity:.6}
.ghost{z-index:4;cursor:grab;box-shadow:var(--elev);opacity:.92}
.ghost.range{opacity:.85}
.blk.dragging{animation:none;cursor:grabbing;z-index:6;box-shadow:0 4px 4px rgba(0,0,0,.3),0 8px 12px 6px rgba(0,0,0,.15);opacity:1;will-change:transform}
.blk.settling{z-index:6;transition:transform .2s cubic-bezier(.05,.7,.1,1),top .2s cubic-bezier(.05,.7,.1,1),height .2s cubic-bezier(.05,.7,.1,1),box-shadow .2s}
.rz{position:absolute;left:0;right:0;bottom:0;height:8px;cursor:ns-resize}
.rz::after{content:"";position:absolute;left:50%;bottom:2px;width:16px;margin-left:-8px;height:3px;border-radius:2px;background:currentColor;opacity:0;transition:opacity .15s}
.blk:hover .rz::after,.blk.dragging .rz::after{opacity:.55}
.blk .x{position:absolute;top:2px;right:2px;width:20px;height:20px;display:none;align-items:center;justify-content:center;color:inherit;background:rgba(0,0,0,.22);border-radius:50%}
.blk .x svg{width:13px;height:13px}.blk.mine:hover .x{display:flex}
.now{position:absolute;left:${GUT - 2}px;right:0;border-top:2px solid #ea4335;z-index:5;pointer-events:none}
.now::before{content:"";position:absolute;left:-6px;top:-7px;width:12px;height:12px;border-radius:50%;background:#ea4335}
.allday{display:flex;flex-wrap:wrap;gap:4px;padding:12px 10px 4px ${GUT}px;position:sticky;top:0;background:var(--panel);z-index:7}
.allday span{font:500 11px/18px "Google Sans Text",Roboto,Arial,sans-serif;padding:0 8px;border-radius:4px;background:var(--c);color:var(--onc,#fff);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.banner{margin:12px;padding:16px;border-radius:16px;background:var(--sec);color:var(--onsec);font-size:13px}
.banner p{margin:0 0 12px}.banner .err{color:var(--error)}

.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 24px;font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;background:var(--primary);color:var(--onprimary);border-radius:20px;transition:box-shadow .15s}
.btn:hover{box-shadow:var(--elev1)}
.btn.ghostb{background:none;color:var(--primary);padding:0 14px}.btn.ghostb:hover{background:var(--state);box-shadow:none}
.btn.danger{color:var(--error);background:none;padding:0 14px}.btn.danger:hover{background:var(--state);box-shadow:none}
.toast{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);background:var(--inv);color:var(--oninv);border-radius:4px;min-height:48px;padding:6px 8px 6px 16px;display:flex;align-items:center;gap:12px;font-size:14px;box-shadow:var(--elev);animation:pop .25s cubic-bezier(.05,.7,.1,1);max-width:90%;z-index:9;white-space:nowrap}
.toast span{overflow:hidden;text-overflow:ellipsis}
.toast button{color:var(--invprimary);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;height:36px;padding:0 12px;border-radius:18px}
.toast button:hover{background:rgba(128,128,128,.14)}
.toast.bad{white-space:normal}
.flyer{position:fixed;left:0;top:0;z-index:2147483601;pointer-events:none;display:flex;align-items:center;gap:10px;height:40px;padding:0 16px 0 14px;border-radius:12px;background:var(--hi);color:var(--on);font:500 14px "Google Sans Text",Roboto,Arial,sans-serif;box-shadow:var(--elev);transition:opacity .15s;will-change:transform}
.flyer.over{opacity:0}

.ehead{display:flex;align-items:center;gap:8px;padding:24px 16px 4px 24px}
.ehead h2{font:400 24px/32px "Google Sans",Roboto,Arial,sans-serif;margin:0;flex:1}
.ehead button.x{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--var)}
.ehead button.x:hover{background:var(--state)}.ehead button.x svg{width:22px;height:22px}
.form{overflow:auto;padding:12px 24px 16px;display:grid;grid-template-columns:1fr 1fr;gap:22px 16px;max-height:min(560px,64vh)}
.f{display:flex;flex-direction:column;gap:8px;min-width:0}.f.wide{grid-column:1/-1}
.f>label{font:500 12px "Google Sans Text",Roboto,Arial,sans-serif;color:var(--var);letter-spacing:.01em}
.in{width:100%;border:0;border-radius:4px 4px 0 0;background:var(--hst);color:var(--on);padding:12px 14px;font:400 15px "Google Sans Text",Roboto,Arial,sans-serif;outline:0;box-shadow:inset 0 -1px 0 var(--var);transition:box-shadow .15s;caret-color:var(--primary)}
.in:focus{box-shadow:inset 0 -2px 0 var(--primary)}
.in::placeholder{color:var(--faint)}
textarea.in{resize:vertical;min-height:72px}
select.in{appearance:none;cursor:pointer}
.chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{height:32px;padding:0 14px;border-radius:8px;background:var(--hst);color:var(--var);font:500 13px "Google Sans Text",Roboto,Arial,sans-serif;transition:background .15s,color .15s}
.chip:hover{filter:brightness(1.04)}
.chip[aria-pressed=true]{background:var(--sec);color:var(--onsec)}
.sw{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--onc,#fff);transition:transform .15s cubic-bezier(.2,0,0,1)}
.sw:hover{transform:scale(1.08)}
.sw svg{width:18px;height:18px;opacity:0;transition:opacity .15s}.sw[aria-pressed=true]{transform:scale(1.12)}.sw[aria-pressed=true] svg{opacity:1}
.sw.def{background:var(--hst);color:var(--var);font:500 12px "Google Sans Text",Roboto,Arial,sans-serif;width:auto;padding:0 12px;border-radius:15px}
.sw.def[aria-pressed=true]{background:var(--sec);color:var(--onsec);transform:none}
.efoot{display:flex;align-items:center;gap:8px;padding:12px 24px 24px}
.efoot .sp{flex:1}
.ver{opacity:.7}
`;

  function applyTheme() {
    const c = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    let dark = matchMedia('(prefers-color-scheme: dark)').matches;
    if (c && c.length >= 3 && !(c.length === 4 && +c[3] === 0)) dark = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 128;
    R.theme.classList.toggle('dark', dark);
  }

  function build() {
    host = document.createElement('div');
    host.id = 'ct-host';
    root = host.attachShadow({ mode: 'open' });
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; }
    catch (e) { const st = document.createElement('style'); st.textContent = CSS; root.append(st); }

    R.input = h('input', { class: 'q', type: 'text', spellcheck: 'false', autocomplete: 'off', oninput: onInput });
    R.dayLbl = h('span', { class: 'lbl' });
    R.sum = h('div', { class: 'sum' });
    R.list = h('div', { class: 'list' });
    R.tl = h('div', { class: 'tl' });
    R.foot = h('div', { class: 'foot' });
    R.editview = h('div', { class: 'editview' });
    R.listTitle = h('span', { class: 'boxtitle' }, 'Templates');
    R.tplBox = h('div', { class: 'box tpl' },
      h('div', { class: 'boxhead' }, R.listTitle, h('span', { class: 'sp' }),
        h('div', { class: 'boxtools' },
          h('button', { class: 'ibtn', title: 'Template from a recent event', onclick: () => openImport() }, icon('history')),
          h('button', { class: 'mini', title: 'New template (' + ALT.trim() + '+N)', onclick: () => openEditor(null) }, icon('plus'), 'New'))),
      R.list);
    R.freeSub = h('span', { class: 'boxsub' });
    R.freeBody = h('div', { class: 'gaps' });
    R.freeBox = h('div', { class: 'box free' },
      h('div', { class: 'boxhead' }, h('span', { class: 'boxtitle' }, 'Free time'), h('span', { class: 'sp' }), R.freeSub),
      R.freeBody);
    R.listview = h('div', { class: 'listview' },
      h('div', { class: 'head' },
        h('label', { class: 'search' }, icon('search'), R.input),
        h('div', { class: 'daynav' },
          h('button', { title: 'Previous day (Ctrl+←)', onclick: () => shiftDay(-1) }, icon('left')),
          R.dayLbl,
          h('button', { title: 'Next day (Ctrl+→)', onclick: () => shiftDay(1) }, icon('right')))),
      R.sum,
      h('div', { class: 'body' }, h('div', { class: 'left' }, R.tplBox, R.freeBox), R.tl),
      R.foot);
    R.card = h('div', { class: 'card', 'data-mode': 'list' }, R.listview, R.editview);
    R.theme = h('div', { class: 'theme' },
      h('div', { class: 'scrim', onmousedown: e => { if (e.target.classList.contains('scrim')) close(); } }, R.card));
    root.append(R.theme);
    R.tl.addEventListener('pointerdown', onTlDown);
    R.tl.addEventListener('pointerup', onTlUp);
    R.tl.addEventListener('pointercancel', onTlUp);
  }

  // ---------------------------------------------------------------- open / close
  async function openPalette() {
    if (S.open) return;
    if (!host) build();
    document.documentElement.append(host);
    try { document.getSelection().removeAllRanges(); } catch (_) { /* ignore */ }
    S.open = true; S.mode = 'list'; S.query = ''; S.sel = 0; S.pin = null; S.pinDur = null; S.lastGhost = null; S.drag = null;
    R.input.value = ''; R.input.placeholder = 'Add a block…  try “deep work 14:30 45m”'; R.card.dataset.mode = 'list';
    applyTheme();
    try { S.settings = await CT.store.getSettings(); } catch (e) { /* keep defaults */ }
    try { S.templates = await CT.store.getTemplates(); } catch (e) { S.templates = CT.SEEDS.slice(); }
    let day = viewDay();
    const now = new Date();
    if (S.settings.eveningTomorrow && sameDay(day, now) && now.getHours() >= 18) day = addDays(day, 1);
    S.day = day;
    const c = S.cache.get(dayKey(day));
    S.events = c ? c.events : [];
    renderAll();
    R.input.focus();
    loadDay();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => { if (S.mode === 'list' && !S.drag) { S.noScroll = true; renderAll(); } }, 60000);
  }
  function close() {
    if (!S.open) return;
    cancelDrag();
    S.open = false;
    clearInterval(tickTimer);
    host.remove();
  }
  function toggle() { S.open ? close() : openPalette(); }

  async function fetchDay(d) {
    const r = await send({ type: 'day', from: dayKey(d), to: dayKey(addDays(d, 1)) });
    r.events.forEach(e => { if (S.mineIds.has(e.id)) e.mine = true; });
    return r;
  }
  function commit() { S.cache.set(dayKey(S.day), { events: S.events, cals: S.cals, t: Date.now() }); }

  async function loadDay() {
    const key = dayKey(S.day), token = ++loadDay.n;
    try {
      const r = await fetchDay(S.day);
      if (token !== loadDay.n || key !== dayKey(S.day)) return;
      const ids = new Set(r.events.map(e => e.id));
      const keep = S.events.filter(e => e.pending || (e.mine && e.id && !ids.has(e.id)));
      S.events = r.events.concat(keep); S.cals = r.calendars; S.auth = 'ok'; S.authMsg = '';
      commit();
      prefetch(1); prefetch(-1);
    } catch (e) {
      if (token !== loadDay.n) return;
      S.auth = e.code === 'NO_CLIENT' ? 'noclient' : e.code === 'AUTH' ? 'needs' : 'error';
      S.authMsg = e.error || '';
    }
    S.noScroll = S.lastGhost != null;
    renderAll();
  }
  loadDay.n = 0;

  function prefetch(n) {
    const d = addDays(S.day, n), k = dayKey(d), c = S.cache.get(k);
    if (c && Date.now() - c.t < 120000) return;
    fetchDay(d).then(r => {
      const cur = S.cache.get(k);
      if (!cur || !cur.events.some(e => e.pending)) S.cache.set(k, { events: r.events, cals: r.calendars, t: Date.now() });
    }).catch(() => {});
  }

  function shiftDay(n) {
    cancelDrag();
    S.day = addDays(S.day, n);
    S.pin = null; S.pinDur = null; S.lastGhost = null;
    const c = S.cache.get(dayKey(S.day));
    S.events = c ? c.events : [];
    renderAll(); loadDay();
  }

  // ---------------------------------------------------------------- rendering
  function renderAll() {
    if (!S.open) return;
    if (S.drag) { S.dirty = true; return; }   // never rebuild under the pointer
    S.dirty = false;
    const items = buildItems();
    if (S.sel >= items.length) S.sel = Math.max(0, items.length - 1);
    R.dayLbl.replaceChildren(...dayParts(S.day));
    renderList(items); renderSummary(items); renderTimeline(items); renderFree(items); renderFoot();
  }

  // Free windows of the day: click one to put the next block there.
  function renderFree(items) {
    R.freeBody.textContent = '';
    if (S.mode === 'import') return;
    const d = S.day, ds = CT.dayAt(d, S.settings.dayStart), de = CT.dayAt(d, S.settings.dayEnd);
    const from = sameDay(d, new Date()) ? Math.max(ds, CT.ceil5(Date.now())) : ds;
    const busy = S.events.filter(e => !e.allDay && !e.free).map(e => [e.start, e.end]);
    const gaps = CT.freeGaps(busy, from, de, 15);
    const freeMin = Math.round(gaps.reduce((a, g) => a + g[1] - g[0], 0) / MIN);
    R.freeSub.textContent = fmtDur(freeMin) + ' free · ' + fmtDur(Math.round(CT.busyMinutes(busy, ds, de))) + ' planned';
    if (!gaps.length) { R.freeBody.append(h('span', { class: 'none' }, from >= de ? 'This day is over' : 'No free time left in your day')); return; }
    const p = plan(items[S.sel]);
    gaps.slice(0, 8).forEach(g => {
      const on = p && p.start >= g[0] && p.start < g[1];
      R.freeBody.append(h('button', {
        class: 'gap' + (on ? ' on' : ''), title: 'Plan the next block here',
        onclick: () => { S.pin = g[0]; S.pinDur = null; S.lastGhost = null; renderAll(); R.input.focus(); }
      }, fmtTime(g[0]) + ' – ' + fmtTime(g[1]), h('span', {}, fmtDur(Math.round((g[1] - g[0]) / MIN)))));
    });
  }

  function rowFor(item, i) {
    const sel = i === S.sel;
    const dot = colorId => h('span', { class: 'dot', style: '--c:' + (CT.colorHex(colorId) || '#9aa0a6') });
    let lead, name, meta = '', right = [];
    if (item.type === 'tpl') {
      const t = item.tpl;
      lead = dot(t.colorId); name = t.name;
      meta = [t.startTime, remShort(t.reminders), t.title && t.title !== t.name ? t.title : ''].filter(Boolean).join(' · ');
      right = [h('span', { class: 'dur' }, fmtDur(t.duration)), h('span', { class: 'hk' }, item.idx < 9 ? ALT + (item.idx + 1) : '')];
    } else if (item.type === 'adhoc') {
      lead = h('span', { class: 'lead' }, icon('plus')); name = '“' + item.text + '”'; meta = 'one-off block';
    } else if (item.type === 'new') {
      lead = h('span', { class: 'lead' }, icon('plus')); name = 'New template'; right = [h('span', { class: 'hk' }, ALT + 'N')];
    } else if (item.type === 'import') {
      lead = h('span', { class: 'lead' }, icon('history')); name = 'Template from a recent event';
    } else {
      const r = item.r;
      lead = dot(r.colorId); name = r.title; meta = r.count + '× in 45 days'; right = [h('span', { class: 'dur' }, fmtDur(r.duration))];
    }
    const act = item.type === 'new' || item.type === 'import';
    const draggable = item.type === 'tpl' || item.type === 'adhoc';
    return h('div', {
      class: 'row' + (sel ? ' sel' : '') + (act ? ' act' : ''), 'data-i': i,
      title: draggable ? 'Click to add · drag onto the timeline to place it' : null,
      onpointerdown: draggable ? e => rowDown(e, item) : null,
      onclick: () => { if (S.suppressClick) { S.suppressClick = false; return; } S.sel = i; activate(item, false); }
    },
      lead, h('span', { class: 'name' }, name), meta ? h('span', { class: 'meta' }, meta) : null, h('span', { class: 'sp' }),
      item.type === 'tpl' ? h('button', { class: 'edit', title: 'Edit template (Ctrl+E)', onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); openEditor(item.tpl); } }, icon('edit')) : null,
      right);
  }

  function renderList(items) {
    const keep = R.list.scrollTop;
    R.list.textContent = '';
    R.listTitle.textContent = S.mode === 'import' ? 'Recent events' : 'Templates';
    if (S.mode === 'import' && !items.length) R.list.append(h('div', { class: 'empty' }, S.recent.length ? 'No recent event matches.' : 'Loading your recent events…'));
    items.forEach((it, i) => {
      if (it.type === 'new' && i > 0) R.list.append(h('div', { class: 'divider' }));
      R.list.append(rowFor(it, i));
    });
    R.list.scrollTop = keep;
    const el = R.list.querySelector('.row.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function renderSummary(items) {
    R.sum.textContent = '';
    if (S.mode === 'import') { R.sum.append(h('span', { class: 'hint' }, 'Pick an event to base a template on'), h('span', { class: 'sp' }), h('button', { class: 'btn ghostb', onclick: showList }, 'Back')); return; }
    const p = plan(items[S.sel]);
    if (p) {
      R.sum.append(h('span', { class: 'chipx' }, icon('schedule'), fmtTime(p.start) + ' – ' + fmtTime(p.end),
        h('span', { class: 'how' }, fmtDur(p.dur) + ' · ' + p.how + (S.auth === 'noclient' || S.auth === 'needs' || S.auth === 'error' ? ' · opens Google’s editor' : ''))));
    } else R.sum.append(h('span', { class: 'hint' }, 'Pick a template, or type a title with a time (14:30, 3pm) and length (45m, 1h30)'));
    R.sum.append(h('span', { class: 'sp' }));
    if (S.pin != null) R.sum.append(h('span', { class: 'chipx pin' }, 'Pinned ' + fmtTime(S.pin) + (S.pinDur ? ' · ' + fmtDur(S.pinDur) : ''),
      h('button', { title: 'Back to next free slot', onclick: () => { S.pin = null; S.pinDur = null; S.lastGhost = null; renderAll(); } }, icon('close'))));
  }

  function renderFoot() {
    R.foot.textContent = '';
    const k = (key, txt) => h('span', {}, h('kbd', {}, key), txt);
    if (S.mode === 'import') { R.foot.append(k('↵', 'use'), k('Esc', 'back')); return; }
    R.foot.append(k('↵', S.settings.keepOpen ? 'add' : 'add & close'),
      k('⇧↵', S.settings.keepOpen ? 'add & close' : 'add & keep open'), k(ALT + '1–9', 'quick add'),
      k('Ctrl ←→', 'day'), h('span', { class: 'sp' }),
      h('span', { title: 'Drag templates onto the timeline · drag blocks to move · draw on empty time to pick a range' }, 'Drag to plan'),
      VERSION ? h('span', { class: 'ver' }, 'v' + VERSION) : null);
  }

  // Side-by-side columns for overlapping events, like Calendar's day view.
  function layoutCols(list) {
    const out = new Map();
    let cluster = [], ends = [], clusterEnd = -Infinity;
    const flush = () => { cluster.forEach(e => { out.get(e).n = ends.length; }); cluster = []; ends = []; };
    for (const e of list) {
      const s = e.start, en = Math.max(e.end, e.start + 25 * MIN);
      if (s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
      let c = ends.findIndex(t => t <= s);
      if (c < 0) { c = ends.length; ends.push(en); } else ends[c] = en;
      out.set(e, { c, n: 1 }); cluster.push(e); clusterEnd = Math.max(clusterEnd, en);
    }
    flush();
    return out;
  }

  const topOf = ms => ((ms - S.geo.d0) / H - S.geo.lo) * S.geo.px;
  function setLabel(b, ls, le) {
    const sm = b.querySelector('small'), txt = fmtTime(ls) + ' – ' + fmtTime(le);
    if (sm.textContent !== txt) sm.textContent = txt;
  }
  // Draws the block at s..e; the label can show different (snapped) times while dragging.
  function placeBlk(b, s, e, ls, le) {
    const top = topOf(s), ht = Math.max((e - s) / H * S.geo.px, 16);
    b.style.top = top + 'px'; b.style.height = (ht - 2) + 'px';
    b.classList.toggle('short', ht < 32);
    setLabel(b, ls == null ? s : ls, le == null ? e : le);
    return top;
  }
  // Moving (not resizing) uses a GPU transform only, so the browser never re-lays out the page mid-drag.
  function slideTo(d, vs, lift) {
    d.el.style.transform = 'translate3d(0,' + (topOf(vs) - d.baseTop) + 'px,0)' + (lift ? ' scale(1.015)' : '');
  }
  // Glide a dragged block onto its snapped slot, then continue.
  function settle(d, then) {
    if (!d.el) return then();
    d.el.classList.remove('dragging');
    d.el.classList.add('settling');
    if (d.mode === 'move') slideTo(d, d.s, false); else placeBlk(d.el, d.s, d.e);
    setTimeout(then, 150);
  }
  function block(s, e, color, title, o) {
    const b = h('div', { class: 'blk ' + (o.cls || ''), style: tint(color) },
      h('span', { class: 't' }, title), h('small', {}));
    if (o.n > 1) {
      b.classList.add('narrow');
      b.style.left = 'calc(' + GUT + 'px + (100% - ' + (GUT + 6) + 'px) * ' + o.c + ' / ' + o.n + ')';
      b.style.width = 'calc((100% - ' + (GUT + 6) + 'px) / ' + o.n + ' - 2px)';
    }
    if (o.x) b.append(h('button', { class: 'x', title: 'Remove this block' }, icon('close')));
    if (o.rz) b.append(h('div', { class: 'rz' }));
    if (o.tip) b.title = o.tip;
    placeBlk(b, s, e);
    return b;
  }

  // The visible hours (your day plus anything scheduled) are scaled to fit the panel, so there is no scrolling.
  function renderTimeline(items) {
    const el = R.tl, keep = el.scrollTop;
    el.textContent = '';
    const d = S.day, d0 = dayKey(d);
    const p = plan(items[S.sel]);
    const banner = authBanner();
    if (banner) el.append(banner);
    const allDay = S.events.filter(e => e.allDay);
    if (allDay.length) el.append(h('div', { class: 'allday' }, allDay.map(e => h('span', { style: tint(colorOf(e.colorId, calById(e.cal))), title: e.title }, e.title))));
    const timed = S.events.filter(e => !e.allDay).sort((a, b) => a.start - b.start || b.end - a.end);
    const hrs = ms => (ms - d0) / H;
    let lo = Math.floor(hrs(CT.dayAt(d, S.settings.dayStart))) - 1, hi = Math.ceil(hrs(CT.dayAt(d, S.settings.dayEnd))) + 1;
    timed.forEach(e => { lo = Math.min(lo, Math.floor(hrs(e.start))); hi = Math.max(hi, Math.ceil(hrs(e.end))); });
    if (p) { lo = Math.min(lo, Math.floor(hrs(p.start))); hi = Math.max(hi, Math.ceil(hrs(p.end))); }
    lo = Math.max(0, lo); hi = Math.min(24, Math.max(hi, lo + 6));
    let used = 0;
    for (const c of el.children) used += c.offsetHeight;
    const avail = el.clientHeight - used - 30;
    const px = Math.max(PX_MIN, Math.min(PX, Math.floor(avail / (hi - lo))));
    S.geo = { d0, lo, hi, px };
    const grid = h('div', { class: 'grid', style: 'height:' + (hi - lo) * px + 'px' });
    for (let hh = lo; hh < hi; hh++) {
      grid.append(h('div', { class: 'hr', style: 'top:' + (hh - lo) * px + 'px' }, h('span', { class: 'hl' }, hf.format(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh)))));
      grid.append(h('div', { class: 'hr half', style: 'top:' + (hh - lo + 0.5) * px + 'px' }));
    }
    const cols = layoutCols(timed);
    timed.forEach(e => {
      const c = cols.get(e), can = e.canEdit && !e.pending;
      const b = block(e.start, e.end, colorOf(e.colorId, calById(e.cal)), e.title, {
        cls: (can ? 'can' : '') + (e.mine ? ' mine' : '') + (e.pending ? ' pending' : ''), c: c.c, n: c.n, x: e.mine && !e.pending, rz: can,
        tip: e.title + ' · ' + fmtTime(e.start) + ' – ' + fmtTime(e.end) + (can ? '\nDrag to move · drag the bottom edge to resize · click to plan right after it' : '\nClick to plan right after it')
      });
      BLK.set(b, e);
      grid.append(b);
    });
    R.ghost = null;
    let ghostTop = null;
    if (p) {
      R.ghost = block(p.start, p.end, colorOf(p.colorId, calById(p.calendarId)), p.title || 'New block', { cls: 'ghost', rz: true, tip: 'Drag to choose the time · drag the bottom edge to change the length' });
      ghostTop = parseFloat(R.ghost.style.top);
      grid.append(R.ghost);
    }
    if (sameDay(d, new Date())) {
      const n = hrs(Date.now());
      if (n >= lo && n <= hi) grid.append(h('div', { class: 'now', style: 'top:' + (n - lo) * px + 'px' }));
    }
    el.append(grid);
    R.grid = grid;

    // Only a very long day (more hours than fit at the minimum scale) scrolls.
    const off = grid.offsetTop;
    if (el.scrollHeight <= el.clientHeight + 1) { el.scrollTop = 0; S.lastGhost = p ? p.start : -1; S.noScroll = false; return; }
    if (S.noScroll) { el.scrollTop = keep; S.lastGhost = p ? p.start : S.lastGhost; S.noScroll = false; }
    else if (ghostTop != null && S.lastGhost !== p.start) { S.lastGhost = p.start; el.scrollTop = Math.max(0, off + ghostTop - 110); }
    else if (ghostTop == null && S.lastGhost == null) {
      const startH = sameDay(d, new Date()) ? hrs(Date.now()) : hrs(CT.dayAt(d, S.settings.dayStart));
      el.scrollTop = Math.max(0, off + (startH - lo - 1) * px); S.lastGhost = -1;
    } else el.scrollTop = keep;
  }

  function authBanner() {
    if (S.auth === 'ok' || S.auth === 'loading') return null;
    if (S.auth === 'noclient') return h('div', { class: 'banner' },
      h('p', {}, h('b', {}, 'Add events right from here.'), ' One-time setup (about 2 min) connects your Google Calendar. Until then, Enter opens Google’s own editor, prefilled.'),
      h('button', { class: 'btn', onclick: () => send({ type: 'openOptions' }).catch(() => {}) }, 'Set up'));
    if (S.auth === 'needs') return h('div', { class: 'banner' },
      h('p', {}, h('b', {}, 'Connect Google Calendar'), ' to see your day and add blocks in one keystroke.'),
      h('button', { class: 'btn', onclick: connectNow }, 'Connect'));
    return h('div', { class: 'banner' }, h('p', { class: 'err' }, S.authMsg || 'Could not reach Google Calendar.'),
      h('button', { class: 'btn ghostb', onclick: () => { S.auth = 'loading'; loadDay(); } }, 'Retry'));
  }
  async function connectNow() {
    try { await send({ type: 'connect' }); loadDay(); } catch (e) { S.auth = 'error'; S.authMsg = e.error || 'Sign-in failed'; renderAll(); }
  }

  // ---------------------------------------------------------------- timeline dragging
  const snap = (ms, step) => Math.round(ms / step) * step;
  // During a drag the grid position is cached (plus our own auto-scroll), so no layout is read per frame.
  function gridTop() {
    const d = S.drag;
    return d && d.gridTop0 != null ? d.gridTop0 - d.scrolled : R.grid.getBoundingClientRect().top;
  }
  function timeAt(y) { const g = S.geo; return g.d0 + (g.lo + (y - gridTop()) / g.px) * H; }
  function clearSelection() {
    try { const s = (root.getSelection ? root.getSelection() : null) || document.getSelection(); if (s) s.removeAllRanges(); } catch (_) { /* ignore */ }
    try { document.getSelection().removeAllRanges(); } catch (_) { /* ignore */ }
  }
  function cacheGeometry(d) {
    clearSelection();
    d.gridTop0 = R.grid.getBoundingClientRect().top;
    d.tlRect = R.tl.getBoundingClientRect();
    d.scrolled = 0;
  }
  function clampDay(s, e) {
    const d0 = S.geo.d0 + S.geo.lo * H, d1 = S.geo.d0 + S.geo.hi * H, len = e - s;
    if (s < d0) { s = d0; e = s + len; }
    if (e > d1) { e = d1; s = e - len; }
    return [s, e];
  }

  function onTlDown(e) {
    if (e.button !== 0 || !R.grid || S.drag) return;
    const bEl = e.target.closest('.blk');
    if (bEl && e.target.closest('.x')) { e.preventDefault(); removeEvent(BLK.get(bEl)); return; }
    if (!e.target.closest('.grid')) return;
    e.preventDefault();
    const t = timeAt(e.clientY);
    let kind = 'create', ev = null, s = null, en = null;
    if (bEl && bEl === R.ghost) {
      const p = plan(currentItem()); if (!p) return;
      kind = 'ghost'; s = p.start; en = p.end;
    } else if (bEl) {
      ev = BLK.get(bEl); if (!ev) return;
      kind = ev.canEdit && !ev.pending ? 'event' : 'static'; s = ev.start; en = ev.end;
    }
    S.drag = { kind, ev, el: kind === 'ghost' || kind === 'event' ? bEl : null, resize: !!e.target.closest('.rz') && kind !== 'static',
      x0: e.clientX, y0: e.clientY, y: e.clientY, t0: t, s0: s, e0: en, s, e: en, moved: false, shift: e.shiftKey, onMove: onTlMove };
    try { R.tl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  // Pointer moves only record the position; the frame loop draws once per display frame.
  function onTlMove(e) {
    const d = S.drag;
    if (!d || d.row) return;
    d.y = e.clientY; d.shift = e.shiftKey;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) < 4 && Math.abs(e.clientX - d.x0) < 4) return;
      if (d.kind === 'static') return;
      d.moved = true;
      d.mode = d.kind === 'create' || d.resize ? 'size' : 'move';
      if (d.kind === 'create') {
        if (R.ghost) R.ghost.style.display = 'none';
        const p = plan(currentItem());
        d.el = block(d.t0, d.t0 + 15 * MIN, p ? colorOf(p.colorId, calById(p.calendarId)) : 'var(--accent)', p ? p.title : 'New block', { cls: 'ghost range' });
        R.grid.append(d.el);
      } else {
        if (d.mode === 'move') { d.el.style.left = ''; d.el.style.width = ''; }
        d.el.classList.add('dragging');
      }
      d.baseTop = parseFloat(d.el.style.top);
      cacheGeometry(d);
      d.raf = requestAnimationFrame(frame);
    }
    d.dirty = true;
  }

  function dragUpdate() {
    const d = S.drag; if (!d || !d.moved || d.row) return;
    // The block follows the pointer exactly (vs..ve); the snapped time (s..en) is what gets saved.
    const step = (d.shift ? 5 : 15) * MIN, t = timeAt(d.y);
    let s, en, vs, ve;
    if (d.kind === 'create') {
      const a = Math.min(d.t0, t), b = Math.max(d.t0, t);
      s = Math.floor(a / step) * step; en = Math.ceil(b / step) * step;
      if (en - s < step) en = s + step;
      vs = a; ve = Math.max(b, a + step);
    } else if (d.resize) {
      s = d.s0; en = Math.max(s + step, snap(t, step));
      vs = s; ve = Math.max(s + step, t);
    } else {
      vs = d.s0 + (t - d.t0); ve = vs + (d.e0 - d.s0);
      s = snap(vs, step); en = s + (d.e0 - d.s0);
    }
    [s, en] = clampDay(s, en);
    [vs, ve] = clampDay(vs, ve);
    d.s = s; d.e = en;
    if (d.mode === 'move') { slideTo(d, vs, true); setLabel(d.el, s, en); }
    else placeBlk(d.el, vs, ve, s, en);
  }

  // One update per display frame: auto-scroll near the edges, then redraw if anything changed.
  function frame() {
    const d = S.drag; if (!d || !d.moved) return;
    if (!d.row || d.over) {
      const r = d.tlRect;
      let v = 0;
      if (d.y < r.top + 36) v = -Math.min(16, Math.ceil((r.top + 36 - d.y) / 3));
      else if (d.y > r.bottom - 36) v = Math.min(16, Math.ceil((d.y - (r.bottom - 36)) / 3));
      if (v) {
        const max = R.tl.scrollHeight - R.tl.clientHeight;
        const next = Math.max(0, Math.min(max, d.scrollPos == null ? R.tl.scrollTop + v : d.scrollPos + v));
        const from = d.scrollPos == null ? R.tl.scrollTop : d.scrollPos;
        if (next !== from) { R.tl.scrollTop = next; d.scrolled += next - from; d.scrollPos = next; d.dirty = true; }
      }
    }
    if (d.dirty) { d.dirty = false; d.row ? rowUpdate() : dragUpdate(); }
    d.raf = requestAnimationFrame(frame);
  }

  function onTlUp(e) {
    const d = S.drag;
    if (!d || d.row) return;
    cancelAnimationFrame(d.raf);
    if (d.moved && d.dirty) dragUpdate();
    S.drag = null;
    if (e.type === 'pointercancel') { renderAll(); return; }
    const done = () => { S.noScroll = true; renderAll(); R.input.focus(); };
    if (!d.moved) {
      if (d.kind === 'create') { S.pin = Math.floor(d.t0 / (15 * MIN)) * 15 * MIN; S.pinDur = null; }
      else if (d.kind === 'event' || d.kind === 'static') { S.pin = d.ev.end; S.pinDur = null; }
      return done();
    }
    settle(d, () => {
      if (d.kind === 'event') {
        if (d.s !== d.ev.start || d.e !== d.ev.end) return moveEvent(d.ev, d.s, d.e);
      } else {
        S.pin = d.s;
        if (d.kind === 'create' || d.resize) S.pinDur = Math.round((d.e - d.s) / MIN);
      }
      done();
    });
  }

  // dragging a template row onto the timeline
  function rowDown(e, item) {
    if (e.button !== 0 || S.drag) return;
    e.preventDefault();   // no text selection, keep focus in the search box
    const row = e.currentTarget;
    const d = { row: true, item, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, over: false, s: null, mode: 'move' };
    S.drag = d;
    try { row.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    d.onMove = ev => {
      if (S.drag !== d) return;
      d.x = ev.clientX; d.y = ev.clientY; d.shift = ev.shiftKey;
      if (!d.moved) {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6) return;
        d.p = plan(item);
        if (!d.p || !R.grid) return;
        d.moved = true;
        d.dur = d.p.dur;
        const color = colorOf(d.p.colorId, calById(d.p.calendarId));
        d.flyer = h('div', { class: 'flyer' }, h('span', { class: 'dot', style: '--c:' + color }), d.p.title, h('span', { style: 'opacity:.6;font-weight:400' }, fmtDur(d.dur)));
        R.theme.append(d.flyer);
        d.el = block(d.p.start, d.p.end, color, d.p.title, { cls: 'ghost dragging' });
        d.el.style.visibility = 'hidden';
        R.grid.append(d.el);
        d.baseTop = parseFloat(d.el.style.top);
        if (R.ghost) R.ghost.style.opacity = '.35';
        cacheGeometry(d);
        d.raf = requestAnimationFrame(frame);
      }
      d.dirty = true;
    };
    const up = ev => {
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
      row.removeEventListener('lostpointercapture', up);
      if (S.drag !== d) return;   // cancelled
      if (d.moved && d.dirty) rowUpdate();
      if (d.moved) {
        S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 0);
        if (d.over && ev.type === 'pointerup' && d.s != null) {
          if (d.flyer) d.flyer.remove();
          settle(d, () => { endRowDrag(d); addBlock(item, false, { start: d.s, dur: d.dur }); });
          return;
        }
      }
      endRowDrag(d);
      if (S.dirty) renderAll();
    };
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
    row.addEventListener('lostpointercapture', up);
  }

  function rowUpdate() {
    const d = S.drag; if (!d || !d.row || !d.moved) return;
    const r = d.tlRect;
    d.flyer.style.transform = 'translate3d(' + (d.x + 14) + 'px,' + (d.y - 16) + 'px,0)';
    const over = d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
    if (over !== d.over) {
      d.over = over;
      d.flyer.classList.toggle('over', over);
      d.el.style.visibility = over ? '' : 'hidden';
    }
    if (!over) { d.s = null; return; }
    const step = (d.shift ? 5 : 15) * MIN, raw = timeAt(d.y - 10), len = d.dur * MIN;
    const [s, e] = clampDay(snap(raw, step), snap(raw, step) + len);
    const [vs] = clampDay(raw, raw + len);
    d.s = s; d.e = e;
    slideTo(d, vs, false);
    setLabel(d.el, s, e);
  }

  function endRowDrag(d) {
    cancelAnimationFrame(d.raf);
    if (d.flyer) d.flyer.remove();
    if (d.el) d.el.remove();
    if (R.ghost) R.ghost.style.opacity = '';
    S.drag = null;
  }

  function cancelDrag() {
    const d = S.drag; if (!d) return;
    if (d.row) endRowDrag(d);
    else { cancelAnimationFrame(d.raf); S.drag = null; }
    if (S.open) { S.noScroll = true; renderAll(); }
  }

  // ---------------------------------------------------------------- actions
  function onInput() {
    S.query = R.input.value; S.sel = 0;
    const tok = CT.parseTokens(S.query);
    if (tok.startMin != null) S.pin = null;          // a typed time beats a pinned one
    if (tok.duration != null) S.pinDur = null;
    renderAll();
  }

  function activate(item, invert) {
    if (!item) return;
    if (item.type === 'new') return openEditor(null);
    if (item.type === 'import') return openImport();
    if (item.type === 'recent') {
      const r = item.r;
      return openEditor(null, { name: r.title, title: '', duration: Math.max(5, r.duration), colorId: r.colorId, description: r.description, location: r.location, reminders: r.reminders });
    }
    addBlock(item, invert);
  }

  function toast(text, undo, bad) {
    if (!S.open) return;
    clearTimeout(toastTimer);
    const old = R.card.querySelector('.toast'); if (old) old.remove();
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, h('span', {}, text), undo ? h('button', { onclick: () => { t.remove(); undo(); } }, 'Undo') : null);
    R.card.append(t);
    toastTimer = setTimeout(() => t.remove(), bad ? 7000 : 6000);
  }

  function nudgeRefresh() {
    // Calendar's own "r" shortcut refreshes the view; best effort so changes show behind the planner.
    S.nudging = true;
    try {
      for (const type of ['keydown', 'keyup']) document.body.dispatchEvent(new KeyboardEvent(type, { key: 'r', code: 'KeyR', keyCode: 82, which: 82, bubbles: true, cancelable: true }));
    } finally { S.nudging = false; }
  }

  function openPrefilled(p) {
    const f = ms => { const x = new Date(ms), z = n => String(n).padStart(2, '0'); return x.getFullYear() + z(x.getMonth() + 1) + z(x.getDate()) + 'T' + z(x.getHours()) + z(x.getMinutes()) + '00'; };
    const u = new URL('https://calendar.google.com/calendar/render');
    u.searchParams.set('action', 'TEMPLATE'); u.searchParams.set('text', p.title);
    u.searchParams.set('dates', f(p.start) + '/' + f(p.end));
    u.searchParams.set('ctz', tz());
    if (p.event.description) u.searchParams.set('details', p.event.description);
    if (p.event.location) u.searchParams.set('location', p.event.location);
    window.open(u.toString(), '_blank', 'noopener');
  }

  // Optimistic: the block appears at once, the API call finishes in the background.
  function addBlock(item, invert, ov) {
    const p = plan(item, ov);
    if (!p || !p.title) return;
    if (S.auth === 'noclient' || S.auth === 'needs' || S.auth === 'error') { openPrefilled(p); return; }
    const key = dayKey(S.day);
    const ev = { id: null, cal: p.calendarId, title: p.title, start: p.start, end: p.end, allDay: false, colorId: p.colorId, free: false, mine: true, pending: true, canEdit: true };
    S.events.push(ev); commit();
    S.query = ''; R.input.value = ''; S.pin = null; S.pinDur = null; S.sel = 0; S.lastGhost = null;
    const stay = S.settings.keepOpen !== !!invert;
    if (stay) renderAll(); else close();
    ev.req = send({ type: 'create', calendarId: p.calendarId, event: p.event }).then(r => {
      ev.id = r.id; ev.pending = false; S.mineIds.add(r.id);
      nudgeRefresh();
      S.noScroll = true; renderAll();
      toast('Added “' + p.title + '”  ' + fmtTime(p.start) + ' – ' + fmtTime(p.end), () => removeEvent(ev, true));
      return r.id;
    }, err => {
      const c = S.cache.get(key);
      if (c) c.events = c.events.filter(x => x !== ev);
      if (key === dayKey(S.day)) S.events = S.events.filter(x => x !== ev);
      if (err.code === 'AUTH') S.auth = 'needs';
      S.noScroll = true; renderAll();
      toast('Could not add “' + p.title + '”: ' + (err.error || 'unknown error'), null, true);
      return null;
    });
  }

  // Removing a block can be undone: Undo recreates it from the data we hold about it.
  async function removeEvent(ev, quiet) {
    if (!ev) return;
    S.events = S.events.filter(x => x !== ev); commit();
    S.noScroll = true; renderAll();
    const id = ev.id || await ev.req;
    if (!id) return;
    try {
      await send({ type: 'remove', calendarId: ev.cal, id }); nudgeRefresh();
      if (!quiet) toast('Removed “' + ev.title + '”', () => restoreEvent(ev));
    } catch (err) { S.events.push(ev); commit(); S.noScroll = true; renderAll(); toast('Could not remove: ' + (err.error || ''), null, true); }
  }

  async function restoreEvent(old) {
    const body = {
      summary: old.title, description: old.description || '', location: old.location || '',
      start: { dateTime: new Date(old.start).toISOString(), timeZone: tz() },
      end: { dateTime: new Date(old.end).toISOString(), timeZone: tz() },
      reminders: old.reminders ? { useDefault: false, overrides: old.reminders.map(m => ({ method: 'popup', minutes: m })) } : { useDefault: true },
      extendedProperties: { private: { ct: '1' } }
    };
    if (old.colorId) body.colorId = old.colorId;
    const ev = Object.assign({}, old, { id: null, pending: true, mine: true, canEdit: true });
    S.events.push(ev); commit(); S.noScroll = true; renderAll();
    try {
      const r = await send({ type: 'create', calendarId: old.cal, event: body });
      ev.id = r.id; ev.pending = false; S.mineIds.add(r.id); nudgeRefresh();
      S.noScroll = true; renderAll();
    } catch (err) {
      S.events = S.events.filter(x => x !== ev); commit(); S.noScroll = true; renderAll();
      toast('Could not restore: ' + (err.error || ''), null, true);
    }
  }

  async function moveEvent(ev, s, e, isUndo) {
    const old = [ev.start, ev.end];
    ev.start = s; ev.end = e; ev.pending = true; commit();
    S.noScroll = true; renderAll();
    try {
      await send({ type: 'move', calendarId: ev.cal, id: ev.id, start: s, end: e, tz: tz() });
      ev.pending = false; S.noScroll = true; renderAll(); nudgeRefresh();
      if (!isUndo) toast('Moved “' + ev.title + '” to ' + fmtTime(s) + ' – ' + fmtTime(e), () => moveEvent(ev, old[0], old[1], true));
    } catch (err) {
      ev.start = old[0]; ev.end = old[1]; ev.pending = false; commit();
      S.noScroll = true; renderAll();
      toast('Could not move: ' + (err.error || ''), null, true);
    }
  }

  function showList() {
    S.mode = 'list'; S.query = ''; S.sel = 0; R.input.value = ''; R.card.dataset.mode = 'list';
    R.input.placeholder = 'Add a block…  try “deep work 14:30 45m”';
    S.noScroll = true; renderAll(); R.input.focus();
  }

  async function openImport() {
    S.mode = 'import'; S.query = ''; S.sel = 0; R.input.value = ''; S.recent = [];
    R.input.placeholder = 'Filter recent events…';
    R.card.dataset.mode = 'import';
    renderAll();
    try { S.recent = await send({ type: 'recent' }); } catch (e) { toast(e.code === 'NO_CLIENT' ? 'Finish setup to read your recent events' : (e.error || 'Could not load events'), null, true); }
    renderAll();
  }

  async function reorder(dir) {
    const item = currentItem();
    if (!item || item.type !== 'tpl') return;
    const i = item.idx, j = i + dir;
    if (j < 0 || j >= S.templates.length) return;
    [S.templates[i], S.templates[j]] = [S.templates[j], S.templates[i]];
    await CT.store.setOrder(S.templates.map(t => t.id)).catch(() => {});
    S.query = ''; R.input.value = '';
    S.sel = j; S.noScroll = true; renderAll();
  }

  // ---------------------------------------------------------------- template editor
  function openEditor(tpl, prefill) {
    const isNew = !tpl;
    const d = Object.assign({ id: '', name: '', title: '', duration: 30, colorId: '', reminders: [0], description: '', location: '', calendarId: '', startTime: '' }, tpl || {}, prefill || {});
    d.reminders = (d.reminders || []).slice();
    S.mode = 'edit'; R.card.dataset.mode = 'edit';
    const name = h('input', { class: 'in', value: d.name, placeholder: 'e.g. Deep work', oninput: e => { d.name = e.target.value; } });
    const title = h('input', { class: 'in', value: d.title, placeholder: 'Same as name', oninput: e => { d.title = e.target.value; } });
    const durIn = h('input', { class: 'in', type: 'number', min: '1', max: '1440', value: d.duration, style: 'width:72px;padding:6px 10px', oninput: e => { d.duration = Math.max(1, +e.target.value || 1); syncDur(); } });
    const durChips = h('div', { class: 'chips' });
    const syncDur = () => [...durChips.children].forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.m === d.duration)));
    [15, 25, 30, 45, 60, 90, 120].forEach(m => durChips.append(h('button', { class: 'chip', 'data-m': m, onclick: () => { d.duration = m; durIn.value = m; syncDur(); } }, fmtDur(m))));
    syncDur();
    const sw = h('div', { class: 'chips' });
    const syncSw = () => [...sw.children].forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === d.colorId)));
    CT.COLORS.forEach(c => sw.append(h('button', { class: 'sw' + (c.hex ? '' : ' def'), 'data-id': c.id, title: c.name, style: c.hex ? 'background:' + c.hex + ';' + tint(c.hex) : '', onclick: () => { d.colorId = c.id; syncSw(); } }, c.hex ? icon('check') : 'Calendar')));
    syncSw();
    const rem = h('div', { class: 'chips' });
    const syncRem = () => [...rem.children].forEach(c => c.setAttribute('aria-pressed', String(d.reminders.indexOf(+c.dataset.m) >= 0)));
    CT.REMINDER_CHOICES.forEach(r => rem.append(h('button', { class: 'chip', 'data-m': r.min, onclick: () => { const i = d.reminders.indexOf(r.min); i >= 0 ? d.reminders.splice(i, 1) : d.reminders.push(r.min); syncRem(); } }, r.label)));
    syncRem();
    const start = h('input', { class: 'in', type: 'time', value: d.startTime, onchange: e => { d.startTime = e.target.value; } });
    const calSel = h('select', { class: 'in', onchange: e => { d.calendarId = e.target.value; } },
      h('option', { value: '' }, 'Primary calendar'),
      S.cals.filter(c => c.writable && !c.primary).map(c => h('option', { value: c.id }, c.name)));
    calSel.value = d.calendarId || '';
    const loc = h('input', { class: 'in', value: d.location, placeholder: 'Optional', oninput: e => { d.location = e.target.value; } });
    const desc = h('textarea', { class: 'in', placeholder: 'Optional, added to every event from this template', oninput: e => { d.description = e.target.value; } });
    desc.value = d.description;
    const F = (label, el, wide) => h('div', { class: 'f' + (wide ? ' wide' : '') }, h('label', {}, label), el);

    let confirmDel = false;
    const delBtn = isNew ? null : h('button', { class: 'btn danger', onclick: async () => {
      if (!confirmDel) { confirmDel = true; delBtn.textContent = 'Click again to delete'; return; }
      await CT.store.deleteTemplate(d.id); S.templates = await CT.store.getTemplates(); showList();
    } }, 'Delete');
    const save = async () => {
      d.name = d.name.trim();
      if (!d.name) { name.focus(); return; }
      d.title = d.title.trim(); d.duration = Math.max(1, +d.duration || 30); d.reminders.sort((a, b) => a - b);
      if (!d.id || isNew) d.id = 'u' + Date.now().toString(36);
      await CT.store.saveTemplate(d); S.templates = await CT.store.getTemplates();
      showList(); S.sel = Math.max(0, S.templates.findIndex(t => t.id === d.id)); renderAll();
    };
    S.editSave = save;

    R.editview.textContent = '';
    R.editview.append(
      h('div', { class: 'ehead' }, h('h2', {}, isNew ? 'New template' : 'Edit template'), h('button', { class: 'x', title: 'Back (Esc)', onclick: showList }, icon('close'))),
      h('div', { class: 'form' },
        F('Name', name), F('Event title', title),
        F('Duration', h('div', { class: 'chips' }, durChips, durIn, h('span', { style: 'color:var(--muted);font-size:12px' }, 'min')), true), F('Color', sw, true),
        F('Reminders', rem, true),
        F('Default start time (optional)', start), F('Calendar', calSel),
        F('Location', loc, true), F('Description', desc, true)),
      h('div', { class: 'efoot' }, delBtn, h('span', { class: 'sp' }), h('button', { class: 'btn ghostb', onclick: showList }, 'Cancel'), h('button', { class: 'btn', onclick: save, title: 'Save (Ctrl+Enter)' }, 'Save')));
    name.focus();
  }

  // ---------------------------------------------------------------- keyboard
  let hotkey = CT.DEFAULTS.hotkey;
  CT.store.getSettings().then(s => { hotkey = s.hotkey; S.settings = s; }).catch(() => {});
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'sync' && ch.settings) { S.settings = Object.assign({}, CT.DEFAULTS, ch.settings.newValue || {}); hotkey = S.settings.hotkey; }
    });
  } catch (e) { /* extension context gone */ }

  const isHot = e => e.code === hotkey.code && !!e.altKey === !!hotkey.alt && !!e.ctrlKey === !!hotkey.ctrl && !!e.shiftKey === !!hotkey.shift && !!e.metaKey === !!hotkey.meta;

  // After the extension is reloaded, this copy is orphaned: switch it off instead of showing a stale planner.
  function alive() { try { return !!chrome.runtime.id; } catch (_) { return false; } }
  function retire() {
    for (const t of ['keydown', 'keyup', 'keypress']) window.removeEventListener(t, onKey, true);
    for (const t of PTR_EVENTS) window.removeEventListener(t, onPointer, true);
    if (S.open) { S.open = false; host.remove(); }
  }

  function onKey(e) {
    if (!alive()) return retire();
    if (S.nudging) return;
    if (e.type !== 'keydown') {
      if (e.type === 'keyup' && e.key === 'Shift' && S.drag) { S.drag.shift = false; S.drag.dirty = true; }
      if (S.open) e.stopImmediatePropagation();
      return;
    }
    if (isHot(e)) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
    if (!S.open) return;
    e.stopImmediatePropagation();   // Calendar's single-key shortcuts must never see typing in the planner
    if (e.isComposing) return;
    handleKey(e);
  }

  function handleKey(e) {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (S.drag) {
      if (k === 'Escape') { e.preventDefault(); cancelDrag(); }
      else if (k === 'Shift') { S.drag.shift = true; S.drag.dirty = true; }
      return;
    }
    if (S.mode === 'edit') {
      if (k === 'Escape') { e.preventDefault(); showList(); }
      else if (k === 'Enter' && ctrl) { e.preventDefault(); S.editSave && S.editSave(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); S.mode === 'import' ? showList() : close(); return; }
    const items = buildItems();
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (e.altKey) return reorder(k === 'ArrowUp' ? -1 : 1);
      if (!items.length) return;
      S.sel = (S.sel + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      renderAll(); return;
    }
    if (ctrl && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); shiftDay((k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1)); return; }
    if (k === 'Enter') { e.preventDefault(); activate(items[S.sel], e.shiftKey); return; }
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      const t = S.templates[+e.code.slice(5) - 1];
      if (t && S.mode === 'list') addBlock({ type: 'tpl', tpl: t }, e.shiftKey);
      return;
    }
    if (e.altKey && e.code === 'KeyN') { e.preventDefault(); openEditor(null); return; }
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); const it = items[S.sel]; if (it && it.type === 'tpl') openEditor(it.tpl); return; }
    if (k === 'Tab') e.preventDefault();
  }

  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, onKey, true);

  // While the planner is open, Calendar's own (heavy) mouse handlers never see a move: they were
  // stealing frames during drags. Our drag gets the moves directly from here.
  function onPointer(e) {
    if (!S.open) return;
    e.stopImmediatePropagation();
    const d = S.drag;
    if (d && d.onMove && e.type === 'pointermove') d.onMove(e);
  }
  for (const t of PTR_EVENTS) window.addEventListener(t, onPointer, true);

  chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'toggle') toggle(); });

  if (window.__ctTest) window.__ctTest.S = S;   // test harness hook
})();
