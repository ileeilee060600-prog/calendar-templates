# Chrome Web Store listing — Calendar Templates

Everything to paste into the Chrome Web Store Developer Dashboard and the Google Cloud console.
Upload file: `dist/calendar-templates-<version>.zip` (made by `build.ps1`).

---

## Store listing tab

**Name:** Calendar Templates

**Summary (max 132 characters):**
Event templates and a fast day planner for Google Calendar. Press Alt+T, pick a template, and it lands in your next free slot.

**Category:** Productivity → Workflow & Planning
**Language:** English

**Description:**

Plan your day in Google Calendar in seconds.

Calendar Templates adds reusable event templates and a fast day planner right inside Google Calendar. Save the blocks you schedule again and again (deep work, workouts, lunch, reviews) with their title, length, color, reminders, calendar, location and notes. Then press Alt+T, pick one and press Enter.

★ ONE KEYSTROKE
• Alt+T opens the planner on top of Google Calendar.
• Enter adds the selected template to the next free slot of the day, so blocks never overlap.
• Alt+1 … Alt+9 add your first nine templates directly, even without opening the planner. Give any template its own shortcut.
• Type naturally: “deep work 14:30 45m”, “gym 6pm 1h”, “call @9 20m”.
• Unknown text becomes a quick one-off block.

★ PLAN VISUALLY
• A live timeline of the day next to your templates.
• Drag a template onto the timeline to place it.
• Drag your own blocks to move them; drag the bottom edge to resize. Smooth, snapping to 15 minutes (Shift for 5).
• Draw on empty time to pick a range.
• The Free time card lists your open windows; click one to fill it.
• Ctrl+← / → to plan tomorrow or any other day. After 6 pm it opens on tomorrow.

★ TEMPLATES THAT FIT HOW YOU WORK
• Reminders default to “At time of event”.
• Choose any Google Calendar event color and the calendar to add to.
• Create a template from an event you already schedule.
• Templates sync between your computers through Chrome. Export and import as JSON.

★ PRIVATE BY DESIGN
• Your calendar data goes only between your browser and Google.
• No servers of ours, no analytics, no ads.
• Every change has Undo.

Calendar Templates is an independent extension and is not affiliated with Google. Google Calendar is a trademark of Google LLC.

**Screenshots (1280×800), in this order:** `store/screenshot-0-hero.png`, `store/screenshot-1.png`, `store/screenshot-2.png`, `store/screenshot-3.png`
**Small promo tile (440×280):** `store/promo-small-hero.png` (or `store/promo-small.png`)
**Store icon:** `icons/128.png`
**Official URL / Homepage:** https://ileeilee060600-prog.github.io/calendar-templates/
**Support URL:** https://github.com/ileeilee060600-prog/calendar-templates/issues

---

## Privacy practices tab

**Single purpose:**
Lets users create reusable event templates and add them to their Google Calendar day from a planner shown on calendar.google.com.

**Permission justifications:**

- **storage** — Saves the user's templates and preferences (synced between their own browsers by Chrome), the short-lived sign-in token in session storage, and the user's account address as a sign-in hint.
- **identity** — Runs Google sign-in (OAuth) with `chrome.identity.launchWebAuthFlow` so the extension can read and add events in the user's Google Calendar.
- **Host permission https://calendar.google.com/\*** — Shows the planner on Google Calendar (content script) when the user presses the shortcut or the toolbar button.
- **Host permission https://www.googleapis.com/\*** — Calls the Google Calendar API to read the day's events and calendar list, and to create, move or delete the events the user asks for.
- **Host permission https://oauth2.googleapis.com/\*** — Revokes the sign-in token when the user presses Disconnect.

**Are you using remote code?** No. All code is in the package.

**Data usage — what the extension collects or uses:**
- ☑ Personally identifiable information — the user's Google account email address, stored locally as a sign-in hint.
- ☑ Authentication information — the OAuth access token, kept in session memory.
- ☑ Website content — calendar event titles, times and colors read from Google Calendar to draw the day and find free time.
- All other categories: not collected.

**Certify (all three):**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://ileeilee060600-prog.github.io/calendar-templates/privacy.html

---

## Google Cloud console (project "Calendar")

### Branding
- App name: Calendar Templates
- User support email: your Gmail
- App logo: leave empty (a logo forces brand verification before publishing)
- Application home page: https://ileeilee060600-prog.github.io/calendar-templates/
- Application privacy policy link: https://ileeilee060600-prog.github.io/calendar-templates/privacy.html
- Authorized domains: `ileeilee060600-prog.github.io`
- Developer contact: your Gmail

### Clients → the Web application client
Authorized redirect URIs must contain one line per extension ID:
- `https://ampgacndpcfojobbfbaembfnmjfdaekk.chromiumapp.org/` (unpacked dev copy, already there)
- `https://fgeknhmdlnljkggnhmnnpjbckpnedlad.chromiumapp.org/` (Chrome Web Store item fgeknhmdlnljkggnhmnnpjbckpnedlad, added)

### Audience → Publish app
After Branding is filled. In production but unverified: up to 100 users, each sees "Google hasn't verified this app" once.

### Verification (to remove the warning and the 100-user cap)
Data access → the two scopes are "sensitive", so Google reviews the app (no paid security assessment).
- Verify the domain in Google Search Console: add `https://ileeilee060600-prog.github.io/calendar-templates/` as a URL-prefix property, verify with the HTML file method (put the file in the site folder and push).
- Scope justification, `calendar.events`:
  "The extension shows the events of the day the user is planning (to find free time), creates the events the user picks from their templates, moves or resizes events the user drags in the planner, and deletes an event when the user presses Undo. calendar.events is the narrowest scope that allows creating and editing events."
- Scope justification, `calendar.calendarlist.readonly`:
  "Used to list the user's calendars with their colors and access level, so the planner draws events in the right color, only reads calendars the user shows, and lets the user choose a calendar they can add events to."
- Demo video (YouTube, unlisted), 1–2 minutes: show the OAuth consent screen with the app name and scopes, then open Google Calendar, press Alt+T, add a template, drag a block, press Undo.
