'use strict';
const $ = id => document.getElementById(id);
const { store, DEFAULTS } = CT;

function label(hk) {
  const k = hk.code.replace(/^Key/, '').replace(/^Digit/, '');
  return [hk.ctrl && 'Ctrl', hk.alt && 'Alt', hk.shift && 'Shift', hk.meta && 'Meta', k].filter(Boolean).join('+');
}
function send(msg) {
  return new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })));
}
function setStatus(ok, text) { const s = $('status'); s.textContent = text ? '— ' + text : ''; s.className = ok ? 'ok' : 'bad'; }

async function init() {
  const s = await store.getSettings();
  $('redir').textContent = chrome.identity.getRedirectURL();
  const own = s.clientId && s.clientId !== CT_CONFIG.clientId ? s.clientId : '';
  $('clientId').value = own;
  if (own) $('adv').open = true;
  $('privacy').href = CT_CONFIG.privacy;
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  $('dayStart').value = s.dayStart; $('dayEnd').value = s.dayEnd;
  $('keepOpen').checked = s.keepOpen; $('quickKeys').checked = s.quickKeys !== false; $('eveningTomorrow').checked = s.eveningTomorrow;
  $('hk').textContent = $('hkLead').textContent = label(s.hotkey);
  const r = await send({ type: 'calendars' });
  r.ok ? setStatus(true, 'connected') : setStatus(false, r.code === 'AUTH' ? 'not connected yet' : (r.error || 'error'));
  renderShortcuts();
}

// ---- per-template shortcuts: click, then press the keys
let templates = [];
async function renderShortcuts() {
  const s = await store.getSettings();
  templates = await store.getTemplates();
  const box = $('scList'); box.textContent = '';
  templates.forEach(t => {
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = CT.colorHex(t.colorId) || '#9aa0a6';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.name;
    const er = document.createElement('span'); er.className = 'er';
    const btn = document.createElement('button'); btn.className = 'rec s' + (t.shortcut ? ' set' : '');
    btn.textContent = t.shortcut ? CT.shortcutLabel(t.shortcut) : 'Set shortcut';
    const clr = document.createElement('button'); clr.className = 't'; clr.textContent = 'Clear'; clr.style.display = t.shortcut ? '' : 'none';
    clr.onclick = async () => { const n = Object.assign({}, t); delete n.shortcut; await store.saveTemplate(n); renderShortcuts(); };
    btn.onclick = () => {
      btn.textContent = 'Press the keys…  (Esc cancels)'; btn.className = 'rec s on'; er.textContent = '';
      const on = async e => {
        if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { window.removeEventListener('keydown', on, true); renderShortcuts(); return; }
        const sc = CT.shortcutFromEvent(e), err = CT.checkShortcut(sc, templates, t.id, s.hotkey);
        if (err) { er.textContent = err; return; }
        window.removeEventListener('keydown', on, true);
        await store.saveTemplate(Object.assign({}, t, { shortcut: sc }));
        renderShortcuts();
      };
      window.addEventListener('keydown', on, true);
    };
    const row = document.createElement('div'); row.className = 'scrow2';
    row.append(dot, nm, er, btn, clr); box.append(row);
  });
}

$('copyRedir').onclick = () => navigator.clipboard.writeText($('redir').textContent);
$('connect').onclick = async () => {
  const id = $('clientId').value.trim();
  if (id && !/\.apps\.googleusercontent\.com$/.test(id)) { $('msg').textContent = 'That does not look like a client ID (ends with .apps.googleusercontent.com).'; return; }
  await store.setSettings({ clientId: id });
  $('msg').textContent = 'Opening Google sign-in…';
  const r = await send({ type: 'connect' });
  if (r.ok) { $('msg').textContent = ''; setStatus(true, 'connected'); }
  else { $('msg').textContent = r.error || 'Sign-in failed'; setStatus(false, 'not connected'); }
};
$('disconnect').onclick = async () => { await send({ type: 'disconnect' }); setStatus(false, 'disconnected'); };

for (const id of ['dayStart', 'dayEnd']) $(id).onchange = e => e.target.value && store.setSettings({ [id]: e.target.value });
for (const id of ['keepOpen', 'quickKeys', 'eveningTomorrow']) $(id).onchange = e => store.setSettings({ [id]: e.target.checked });

$('hk').onclick = () => {
  const b = $('hk'); b.textContent = 'Press keys…';
  const on = e => {
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    window.removeEventListener('keydown', on, true);
    if (e.key === 'Escape' || !(e.altKey || e.ctrlKey || e.metaKey)) { init(); $('hkHint').textContent = 'needs Alt, Ctrl or Meta'; return; }
    const hk = { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey };
    const clash = templates.find(t => CT.sameShortcut(t.shortcut, hk));
    if (clash) { init(); $('hkHint').textContent = label(hk) + ' is already the shortcut of “' + clash.name + '”'; return; }
    store.setSettings({ hotkey: hk }); b.textContent = $('hkLead').textContent = label(hk);
    $('hkHint').textContent = 'saved — refresh open Calendar tabs if it does not react';
  };
  window.addEventListener('keydown', on, true);
};

$('export').onclick = async () => {
  const t = await store.getTemplates();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'calendar-templates', templates: t }, null, 2)], { type: 'application/json' }));
  a.download = 'calendar-templates.json'; a.click();
};
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  try {
    const j = JSON.parse(await e.target.files[0].text());
    const list = (j.templates || []).filter(t => t && t.name && t.duration).map(t => Object.assign({ id: 'u' + Math.random().toString(36).slice(2, 9), title: '', description: '', location: '', calendarId: '', startTime: '', colorId: '', reminders: [0] }, t));
    await store.replaceAll(list);
    $('bmsg').textContent = 'Imported ' + list.length + ' templates.';
  } catch (err) { $('bmsg').textContent = 'Could not read that file.'; }
  e.target.value = '';
};
$('reset').onclick = async () => { await store.replaceAll(CT.SEEDS); $('bmsg').textContent = 'Sample templates restored.'; };

init();
