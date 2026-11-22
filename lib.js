// Shared logic: colors, defaults, input parsing, slot finding, template storage.
// Loaded by the content script and the options page (and by node for tests).
(function (root) {
  'use strict';

  // Google Calendar event colors (colorId -> hex as the web app draws them).
  const COLORS = [
    { id: '', name: 'Calendar default', hex: null },
    { id: '11', name: 'Tomato', hex: '#d50000' },
    { id: '4', name: 'Flamingo', hex: '#e67c73' },
    { id: '6', name: 'Tangerine', hex: '#f4511e' },
    { id: '5', name: 'Banana', hex: '#f6bf26' },
    { id: '2', name: 'Sage', hex: '#33b679' },
    { id: '10', name: 'Basil', hex: '#0b8043' },
    { id: '7', name: 'Peacock', hex: '#039be5' },
    { id: '9', name: 'Blueberry', hex: '#3f51b5' },
    { id: '1', name: 'Lavender', hex: '#7986cb' },
    { id: '3', name: 'Grape', hex: '#8e24aa' },
    { id: '8', name: 'Graphite', hex: '#616161' }
  ];

  const DEFAULTS = {
    clientId: '',
    hotkey: { code: 'KeyT', alt: true, ctrl: false, shift: false, meta: false },
    dayStart: '08:00',
    dayEnd: '22:00',
    keepOpen: true,          // Enter adds and stays open so you can chain blocks
    eveningTomorrow: true,   // after 18:00 the planner opens on tomorrow
    quickKeys: true         // Alt+1..9 add the Nth template without opening the planner
  };

  // [minutes before start] — 0 is "At time of event".
  const REMINDER_CHOICES = [
    { min: 0, label: 'At time of event' },
    { min: 5, label: '5 min' },
    { min: 10, label: '10 min' },
    { min: 30, label: '30 min' },
    { min: 60, label: '1 hour' }
  ];

  const SEEDS = [
    { id: 'seed-deep', name: 'Deep work', duration: 90, colorId: '9' },
    { id: 'seed-admin', name: 'Admin & email', duration: 30, colorId: '8' },
    { id: 'seed-workout', name: 'Workout', duration: 60, colorId: '11' },
    { id: 'seed-lunch', name: 'Lunch', duration: 45, colorId: '6' },
    { id: 'seed-break', name: 'Break', duration: 15, colorId: '2' },
    { id: 'seed-read', name: 'Reading', duration: 30, colorId: '3' },
    { id: 'seed-shutdown', name: 'Plan tomorrow', duration: 15, colorId: '7' }
  ].map(function (t) {
    return Object.assign({ title: '', description: '', location: '', calendarId: '', startTime: '', reminders: [0] }, t);
  });

  function colorHex(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === String(id || '')) return COLORS[i].hex;
    return null;
  }

  // ---- input parsing: "deep work 14:30 45m" -> {text, startMin, duration} ----
  function toMin(h, mi, ap) {
    h = +h; mi = +mi;
    if (mi < 0 || mi > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (/pm/i.test(ap) ? 12 : 0);
    } else if (h < 0 || h > 23) return null;
    return h * 60 + mi;
  }

  function parseTokens(q) {
    var text = ' ' + String(q || '') + ' ';
    var startMin = null, duration = null;
    function time(re, fn) {
      if (startMin != null) return;
      text = text.replace(re, function (all) {
        var v = fn.apply(null, Array.prototype.slice.call(arguments, 1));
        if (v == null) return all;
        startMin = v; return ' ';
      });
    }
    time(/\s@?(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s)/i, function (h, m, ap) { return toMin(h, m, ap); });
    time(/\s@(\d{1,2})\s*(am|pm)?(?=\s)/i, function (h, ap) { return toMin(h, 0, ap); });
    time(/\s(\d{1,2})\s*(am|pm)(?=\s)/i, function (h, ap) { return toMin(h, 0, ap); });
    text = text.replace(/\s(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d{1,2})\s*(?:m|min)?)?(?=\s)/i, function (all, h, m) {
      if (duration != null) return all;
      var v = Math.round(parseFloat(String(h).replace(',', '.')) * 60) + (m ? +m : 0);
      if (!(v > 0)) return all;
      duration = v; return ' ';
    });
    if (duration == null) {
      text = text.replace(/\s(\d{1,3})\s*(?:m|min|mins|minutes?)(?=\s)/i, function (all, m) {
        if (!(+m > 0)) return all;
        duration = +m; return ' ';
      });
    }
    return { text: text.replace(/\s+/g, ' ').trim(), startMin: startMin, duration: duration };
  }

  // 0 = no match; higher = better.
  function matchScore(name, q) {
    name = String(name || '').toLowerCase(); q = String(q || '').toLowerCase().trim();
    if (!q) return 1;
    if (name.indexOf(q) === 0) return 4;
    var words = q.split(/\s+/), s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], at = name.indexOf(w);
      if (at === 0 || (at > 0 && /[\s&\-_.]/.test(name[at - 1]))) s += 2;
      else if (at > 0) s += 1;
      else {
        var j = 0; for (var k = 0; k < name.length && j < w.length; k++) if (name[k] === w[j]) j++;
        if (j === w.length && w.length > 1) s += 0.5; else return 0;
      }
    }
    return s / words.length + 1;
  }

  // ---- time helpers ----
  function dayAt(day, hhmm) {
    var p = String(hhmm || '00:00').split(':');
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), +p[0] || 0, +p[1] || 0).getTime();
  }
  function ceil5(ms) { var s = 5 * 60000; return Math.ceil(ms / s) * s; }
  function round15(ms) { var s = 15 * 60000; return Math.round(ms / s) * s; }

  // First start >= from where [start, start+dur] touches no busy interval.
  function findSlot(busy, dur, from) {
    var iv = busy.filter(function (b) { return b[1] > from; }).sort(function (a, b) { return a[0] - b[0]; });
    var cur = ceil5(from), len = dur * 60000;
    for (var i = 0; i < iv.length; i++) {
      if (iv[i][1] <= cur) continue;
      if (iv[i][0] >= cur + len) return cur;
      cur = ceil5(Math.max(cur, iv[i][1]));
    }
    return cur;
  }

  function mergeBusy(busy, from, to) {
    var iv = busy.map(function (b) { return [Math.max(b[0], from), Math.min(b[1], to)]; })
      .filter(function (b) { return b[1] > b[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    iv.forEach(function (b) {
      var last = out[out.length - 1];
      if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]); else out.push(b.slice());
    });
    return out;
  }
  // Free windows of at least minMin minutes between from and to.
  function freeGaps(busy, from, to, minMin) {
    var gaps = [], cur = from, min = (minMin || 0) * 60000;
    mergeBusy(busy, from, to).forEach(function (b) {
      if (b[0] - cur >= min && b[0] > cur) gaps.push([cur, b[0]]);
      cur = Math.max(cur, b[1]);
    });
    if (to - cur >= min && to > cur) gaps.push([cur, to]);
    return gaps;
  }
  function busyMinutes(busy, from, to) {
    return mergeBusy(busy, from, to).reduce(function (a, b) { return a + (b[1] - b[0]); }, 0) / 60000;
  }

  // ---- shortcuts: {code, alt, ctrl, shift, meta} ----
  function shortcutFromEvent(e) {
    return { code: e.code, alt: !!e.altKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, meta: !!e.metaKey };
  }
  function shortcutLabel(sc) {
    if (!sc || !sc.code) return '';
    var k = sc.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace(/^Numpad/, 'Num ');
    return [sc.ctrl && 'Ctrl', sc.alt && 'Alt', sc.shift && 'Shift', sc.meta && 'Meta', k].filter(Boolean).join('+');
  }
  function sameShortcut(a, b) {
    return !!a && !!b && a.code === b.code && !!a.alt === !!b.alt && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
  }
  function matchesShortcut(e, sc) {
    return !!sc && e.code === sc.code && !!e.altKey === !!sc.alt && !!e.ctrlKey === !!sc.ctrl && !!e.shiftKey === !!sc.shift && !!e.metaKey === !!sc.meta;
  }
  // Combinations Chrome (or Windows) handles before a web page ever sees them.
  var RESERVED = ['Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
    'Ctrl+L', 'Ctrl+K', 'Ctrl+E', 'Ctrl+F', 'Ctrl+P', 'Ctrl+S', 'Ctrl+D', 'Ctrl+H', 'Ctrl+J', 'Ctrl+U', 'Ctrl+O', 'Ctrl+R', 'Ctrl+A',
    'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Q', 'Ctrl+G', 'Ctrl+B',
    'Alt+D', 'Alt+F', 'Alt+E', 'Alt+Left', 'Alt+Right', 'Alt+Home', 'Alt+F4', 'Alt+Space', 'Alt+Tab', 'Alt+Enter'];
  // Returns '' when the shortcut is fine, otherwise a short reason. templates: all templates; selfId: the one being edited.
  function checkShortcut(sc, templates, selfId, hotkey) {
    if (!sc || !sc.code) return 'No key pressed.';
    if (!(sc.alt || sc.ctrl || sc.meta)) return 'Use Alt, Ctrl or ⌘ together with a key.';
    var label = shortcutLabel(sc);
    if (RESERVED.indexOf(label) >= 0) return 'Chrome or Windows already uses ' + label + '. Try Alt with a letter.';
    if (/^F\d+$/.test(sc.code) && !sc.alt && !sc.ctrl && !sc.meta) return 'Use a modifier key too.';
    if (sameShortcut(sc, hotkey)) return label + ' already opens the planner.';
    if (sc.alt && !sc.ctrl && !sc.shift && !sc.meta && /^Digit[1-9]$/.test(sc.code)) return 'Alt+1…9 are the automatic numbers of your first nine templates.';
    for (var i = 0; i < (templates || []).length; i++) {
      var t = templates[i];
      if (t.id !== selfId && sameShortcut(t.shortcut, sc)) return label + ' is already used by “' + t.name + '”.';
    }
    return '';
  }

  // ---- storage (chrome.storage.sync: one key per template, plus an order list) ----
  var store = {
    getSettings: async function () {
      var r = await chrome.storage.sync.get('settings');
      return Object.assign({}, DEFAULTS, r.settings || {});
    },
    setSettings: async function (patch) {
      var cur = await store.getSettings();
      await chrome.storage.sync.set({ settings: Object.assign(cur, patch) });
    },
    getTemplates: async function () {
      var all = await chrome.storage.sync.get(null);
      if (!all.seeded) {
        var data = { seeded: true, order: SEEDS.map(function (t) { return t.id; }) };
        SEEDS.forEach(function (t) { data['t_' + t.id] = t; });
        await chrome.storage.sync.set(data);
        all = Object.assign(all, data);
      }
      var order = all.order || [], out = [];
      order.forEach(function (id) { if (all['t_' + id]) out.push(all['t_' + id]); });
      return out;
    },
    saveTemplate: async function (t) {
      var r = await chrome.storage.sync.get('order');
      var order = r.order || [];
      if (order.indexOf(t.id) < 0) order.push(t.id);
      var data = { order: order }; data['t_' + t.id] = t;
      await chrome.storage.sync.set(data);
    },
    deleteTemplate: async function (id) {
      var r = await chrome.storage.sync.get('order');
      await chrome.storage.sync.set({ order: (r.order || []).filter(function (x) { return x !== id; }) });
      await chrome.storage.sync.remove('t_' + id);
    },
    setOrder: async function (ids) { await chrome.storage.sync.set({ order: ids }); },
    replaceAll: async function (templates) {
      var all = await chrome.storage.sync.get(null), rm = [];
      Object.keys(all).forEach(function (k) { if (k.indexOf('t_') === 0) rm.push(k); });
      if (rm.length) await chrome.storage.sync.remove(rm);
      var data = { seeded: true, order: templates.map(function (t) { return t.id; }) };
      templates.forEach(function (t) { data['t_' + t.id] = t; });
      await chrome.storage.sync.set(data);
    }
  };

  var CT = { COLORS: COLORS, DEFAULTS: DEFAULTS, SEEDS: SEEDS, REMINDER_CHOICES: REMINDER_CHOICES,
    colorHex: colorHex, parseTokens: parseTokens, matchScore: matchScore, dayAt: dayAt,
    ceil5: ceil5, round15: round15, findSlot: findSlot, freeGaps: freeGaps, busyMinutes: busyMinutes,
    shortcutFromEvent: shortcutFromEvent, shortcutLabel: shortcutLabel, sameShortcut: sameShortcut, matchesShortcut: matchesShortcut,
    checkShortcut: checkShortcut, store: store };
  root.CT = CT;
  if (typeof module !== 'undefined' && module.exports) module.exports = CT;
})(typeof self !== 'undefined' ? self : globalThis);
