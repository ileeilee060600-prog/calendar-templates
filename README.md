# Calendar Templates (Chrome extension)

A day planner for Google Calendar on desktop. Press **Alt+T** on calendar.google.com and a palette opens over the calendar, with your templates on the left and a live timeline of the day on the right.

## Install
1. `chrome://extensions` → Developer mode → **Load unpacked** → pick this folder. (The extension ID is fixed by the `key` in `manifest.json`.)
2. The options page opens. Press **Connect**. The project's own Google OAuth client is built in (`config.js`); Options › Advanced still accepts your own client.

## Publish (Chrome Web Store)
- `powershell -ExecutionPolicy Bypass -File build.ps1` → `dist/calendar-templates-<version>.zip` (no `key` field, forward-slash paths).
- `store/LISTING.md` has every text to paste (listing, permission justifications, data disclosures), the Google Cloud Branding values, and the OAuth verification answers. Images: `store/screenshot-*.png` (1280×800), `store/promo-small.png` (440×280).
- `docs/` is the GitHub Pages site (homepage + privacy policy) that Google and the store link to.
- After the first upload, add `https://<store-item-id>.chromiumapp.org/` to the Web client's redirect URIs in Google Cloud.
- Tests: `node test/lib.test.js`.

## Use
- **Type to filter**, ↑↓ to choose, **Enter** adds the block and keeps the planner open, so you can chain a whole day. **Shift+Enter** adds and closes (flip it in options). **Alt+1–9** adds the Nth template directly.
- Blocks go into the **next free slot** of the viewed day, so they never overlap. Override inline: `deep work 14:30 45m`, `gym 3pm 1h30`, `call @9 20m`.
- **The whole day fits without scrolling:** the timeline scales your day (start to end in options, plus anything scheduled) to the panel height. Only an unusually long day falls back to scrolling.
- **The timeline works like Calendar's day view.** Drag a template onto it to place it. Drag the preview to choose a time, and drag its bottom edge to change the length. Draw on empty time to pick a range. Click an event to plan right after it. Blocks follow the pointer smoothly and glide onto the nearest 15 min when you let go (hold Shift for 5 min); the label shows the time it will snap to. Esc cancels a drag.
- **Your own blocks can be moved and resized right there** (saved at once, with Undo). Meetings with guests and other people's events stay fixed. Every block the extension added (marked privately in the event, so it survives reloads) shows an × on hover to remove it, with Undo that recreates it. Events created before 1.7.1 carry no marker; delete those in Calendar itself.
- **Free time** card: the free windows of the day (from your day start, or now for today) with totals. Click one to put the next block there.
- **Ctrl+←/→** change day (add Shift for a week). After 18:00 it opens on tomorrow.
- Unknown text becomes a quick one-off block. **Alt+N** new template (Chrome reserves Ctrl+N), **Ctrl+E** edit, **Alt+↑↓** reorder. "Create from recent events" turns what you already schedule into a template.
- Each template: name, title, duration, color, reminders (default **At time of event**), calendar, location, description, optional fixed start. Every add has an **Undo**.

## Notes
- After an update (reload in chrome://extensions), open Calendar tabs refresh themselves; a leftover old script switches itself off. The planner footer shows the running version.
- Dragging is built for smoothness: while the planner is open, Calendar's own mouse handlers never see a move (window capture router), blocks move with a GPU transform once per frame (rAF), geometry is cached for the drag, and the timeline uses CSS containment.
- Adds are optimistic: the block appears at once and the API call finishes behind it. Days are cached, and the next and previous days are prefetched, so switching days is instant.
- Token never leaves the service worker. Scopes: `calendar.events`, `calendar.calendarlist.readonly`. Sessions renew silently.
- After adding, the extension sends Calendar's `r` (refresh) key as a best-effort so the block appears behind the planner. Unverified against the live app.
- Templates live in `chrome.storage.sync`; export/import JSON in options.
- Calendar enforces Trusted Types: the UI is built with DOM nodes only, in a shadow root.
- Files: `config.js` (built-in OAuth client and site URLs), `lib.js` (parsing, slot finding, free time, storage), `background.js` (OAuth + API), `content.js` (planner UI), `options.*`.
