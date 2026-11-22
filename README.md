# Meetings Plus

**Subscribe to your calendar, click a meeting, get a pre-filled note.** No drag-and-drop, no Outlook open in the background, no export. Your calendar sits next to your notes, and every event is one click from a ready-to-type meeting note in your own vault.

![Meetings Plus in 26 seconds: the calendar sidebar, a meeting note in one click, T: and Q: lines harvested into tasks and open questions, and the same tasks in Tasks Plus](docs/demo.gif)

## How it works — 10 seconds

1. **Subscribe to a calendar.** Paste an ICS link from Outlook, Google, iCloud, Proton, or Fastmail. No new account, no migration.
2. **Today's meetings appear in the sidebar,** sorted by time — with a marker on the ones that already have notes.

   ![Sidebar](docs/screenshot-1.png)
3. **Click a meeting → a pre-filled note opens** in your chosen folder, with attendees, time, location, and agenda already filled in. Start typing.

   ![Meeting note](docs/screenshot-2.png)

That's the whole loop. Everything below is detail.

## Coming from Notion?

You ran meetings out of Notion, but you always wanted your calendar and your notes in the *same* place — without exporting to a separate calendar app, and without your meeting history living on someone else's server.

Meetings Plus subscribes to the calendar you already use (Outlook, Google, iCloud, and any standards-compliant ICS feed) and turns any event into a structured note in your own **local markdown vault** with one click. Attendees come in as `[[wikilinks]]`, so every meeting connects to the people and projects it touches — the relations muscle you had in Notion, now as plain-text links you own. No telemetry, no third-party services, no lock-in.

## What it does

- Subscribe to one or more **ICS calendar feeds** (Outlook, Google, iCloud, Proton, Fastmail — any standards-compliant ICS source)
- Today's meetings appear in a sidebar, sorted by time
- **Multi-day agenda**: flat per-day list with empty days collapsed into a one-line "N days without events" hint. Jump to any future date with the built-in date picker; quick-set how many days to show from the sidebar header
- **Catch up on past meetings**: navigate back up to 365 days (configurable, off by setting 0) and click a past meeting to write up its note after the fact — handy for transposing paper notes
- **One click on a meeting → fully pre-filled meeting note** in your configured folder, with attendees, time, location, agenda — ready to take notes
- **Already prepared?** The sidebar shows which meetings already have notes; clicking opens the existing one
- Optional **pre-meeting notifications** with a configurable lead time
- Optional **daily-note integration** — write today's schedule into your daily note as a managed block
- **Templater-friendly** — if Templater is installed and enabled, your `<% %>` tokens run after Meetings Plus substitutes its own `{{variables}}`
- **Privacy-first**: only network calls are to your calendar URLs, no telemetry, no third-party services
- **Works on mobile**: pure ICS over HTTPS, no native bindings

## Why not just drag events from Outlook?

The existing **Outlook Meeting Notes** plugin requires Outlook and Obsidian to be open simultaneously, and you drag calendar events between them. That's fragile and slow. Meetings Plus reads your calendar directly via ICS, so Outlook doesn't need to be open and nothing needs to be dragged — your meetings are just there in the sidebar, on desktop and mobile alike.

## Installation

### From the Obsidian community plugins directory

1. Open Obsidian → **Settings → Community plugins**
2. Search for **Meetings Plus**
3. Select **Install**, then **Enable**

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Copy them into your vault at `.obsidian/plugins/meetings-plus/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

## Getting started

1. Get your calendar's ICS URL (see the next section)
2. Open **Settings → Community plugins → Meetings Plus → Add calendar**
3. Paste the URL, give the calendar a name, optionally pick a color and folder
4. Save — the sidebar opens automatically with today's meetings

## How to get the ICS URL

**Outlook / Microsoft 365**
1. Open Outlook on the web → Calendar
2. Right-click the calendar → **Sharing and permissions** → **Publish a calendar**
3. Set permissions, then copy the ICS link

**Google Calendar**
1. Open Google Calendar → Settings (gear icon) → click the calendar you want under **Settings for my calendars**
2. Scroll to **Integrate calendar**
3. Copy **Secret address in iCal format**

**iCloud**
1. Open Calendar.app → right-click the calendar → **Share Calendar**
2. Enable **Public Calendar** → copy the URL

**Proton Calendar**
1. Open Proton Calendar settings → **Share** → **Public link**
2. Copy the URL

> Meetings Plus also supports HTTP Basic auth: `https://user:pass@host/cal.ics`

### Outlook: attendees

Outlook's published calendar links currently don't include attendees or the organizer, even when the calendar is published with "Can view all details". Meetings Plus shows attendees whenever a feed includes them, so with an Outlook link the attendee fields in your notes stay empty, and **Exclude meetings you declined** has nothing to work with. This is a limitation of Outlook's feed, tracked in [#34](https://github.com/jabaho9523/obsidian-meetings-plus/issues/34).

## Usage

- Click the **ribbon icon** to open the sidebar, or run **Meetings Plus: Open dashboard**
- **Single click** on a meeting row → create or open the meeting note
- **Right-click** for a context menu: open meeting link or hide for today
- **Commands** (via the command palette):
  - Meetings Plus: Open dashboard
  - Meetings Plus: Refresh all calendars
  - Meetings Plus: Create note for next meeting
  - Meetings Plus: Open next meeting link

## Templates

Each calendar has its own editable template. Variables are written as `{{name}}`; date variables accept a moment.js format string after a colon, e.g. `{{start:HH:mm}}`.

| Variable | Output |
|---|---|
| `{{title}}` | Meeting title |
| `{{date}}` | Meeting date in `YYYY-MM-DD` |
| `{{start}}`, `{{start:HH:mm}}` | Start datetime |
| `{{end}}`, `{{end:HH:mm}}` | End datetime |
| `{{end_date}}` | Last day the event covers (all-day `DTEND` is exclusive, so this is the day you expect) |
| `{{duration}}` | Duration in minutes |
| `{{duration_hm}}` | Duration as `1h 30m` |
| `{{all_day}}` | `true` / `false` |
| `{{timezone}}` | Timezone the event was authored in, e.g. `Europe/Berlin` |
| `{{location}}` | Location string |
| `{{geo}}`, `{{geo_url}}` | `GEO` coordinates, and an OpenStreetMap link to them |
| `{{meeting_url}}` | Best meeting link found (see below) |
| `{{conference_url}}` | RFC 7986 `CONFERENCE` URI (Google Meet, Teams, Zoom) |
| `{{event_url}}` | The event's `URL` property |
| `{{description}}` | Full description, stripped of HTML |
| `{{organizer}}`, `{{organizer_email}}` | Organizer display name and address |
| `{{attendees}}` | Comma-separated attendee names |
| `{{attendees_list}}` | Bulleted list of attendees |
| `{{attendees_wikilinks}}` | Comma-separated `[[Name]]` wikilinks |
| `{{attendees_emails}}` | Comma-separated attendee addresses |
| `{{attendees_table}}` | Markdown table of name, response, and role |
| `{{attendee_count}}` | Number of people invited (rooms and equipment excluded) |
| `{{my_response}}` | How *you* replied, when the calendar's email address is configured |
| `{{required_attendees}}`, `{{optional_attendees}}` | Split by `ROLE` |
| `{{attendees_accepted}}`, `{{attendees_declined}}`, `{{attendees_tentative}}`, `{{attendees_pending}}` | Split by `PARTSTAT` reply |
| `{{rooms}}` | Booked rooms and equipment (`CUTYPE=ROOM`/`RESOURCE`) |
| `{{categories}}`, `{{categories_yaml}}` | Event `CATEGORIES`, plain or as a YAML list |
| `{{status}}` | `confirmed` or `tentative` |
| `{{busy_status}}` | `free`, `tentative`, `busy`, `oof`, or `working-elsewhere` |
| `{{privacy}}` | `public`, `private`, or `confidential` (`CLASS`) |
| `{{priority}}` | `PRIORITY` (0–9) |
| `{{recurrence}}` | Human-readable rule, e.g. `Every 2 weeks on Mon, Wed` |
| `{{recurrence_rule}}` | Raw `RRULE` |
| `{{is_recurring}}`, `{{is_exception}}` | Whether this is a series occurrence, and whether it was individually moved or edited |
| `{{reminder_minutes}}` | Lead time of the event's own reminder (`VALARM`) |
| `{{attachments}}`, `{{attachments_list}}` | `ATTACH` links |
| `{{created}}`, `{{last_modified}}` | Timestamps from the feed — accept a format string like the date variables |
| `{{sequence}}` | `SEQUENCE`, bumped by the organizer on every revision |
| `{{calendar}}` | Calendar display name |
| `{{uid}}` | ICS UID |
| `{{dedup_key}}` | Internal dedup key (used in frontmatter) |
| `{{tags}}` | Calendar's tags as YAML list |

`{{meeting_url}}` prefers the Teams link Outlook publishes, then the standard
`CONFERENCE` property, then a Teams/Zoom/Meet/Webex link found in the location or
description, and finally any URL in those fields.

Overridden occurrences of a recurring event — the ones you moved or renamed for a
single week — are read from their own entry, so the title, location, and attendee
list reflect that occurrence rather than the series.

## Templater

If [Templater](https://github.com/SilentVoid13/Templater) is installed, Meetings Plus can run it on new meeting notes:

1. Enable **Settings → Meetings Plus → Run Templater on new notes**
2. Put Templater tags in a calendar's template alongside the `{{variables}}`:

```markdown
## {{title}}
Prepared on <% tp.date.now("YYYY-MM-DD") %>
```

Meetings Plus fills in its `{{ }}` variables first; Templater then processes the note.

When Meetings Plus creates a daily note, it uses the configured Daily notes or Periodic Notes template. With **Run Templater on new notes** enabled, that template is processed immediately after creation, before the schedule or meeting section is added. Refreshing the schedule in an existing daily note does not run Templater.

If neither Daily notes nor Periodic Notes is enabled, Meetings Plus creates or reuses a plain `YYYY-MM-DD.md` note in the vault root. If either plugin is enabled but template-aware creation fails, Meetings Plus reports the failure instead of creating a blank fallback.

> **Daily-note destinations:** Templater processes the *whole* daily note, not just the meeting section — any other Templater tags left in that note will run too. Templater runs only when the section is first created; clicking the meeting again just opens the note at its section.
>
> In Live Preview the `<!-- mp:section -->` markers around each daily-note section are hidden unless the cursor is on their line; turn off **Hide section markers in the editor** to always show them.

## Using Meetings Plus with HyperCap

Meetings Plus and HyperCap share meeting notes, so one meeting has one note no matter which app made it. Set the calendar's **Folder** in Meetings Plus to HyperCap's notes folder, or to a folder up to 4 levels above it.

Before creating a note, Meetings Plus looks for its own note (by `meeting_dedup_key`, anywhere in the vault). If there is none, it looks in the calendar's folder and its subfolders, at most 4 levels deep, skipping dot-folders such as `.trash`:

1. **Same uid and date:** a note whose `meeting_uid` and `date` match the meeting. This also works for recurring meetings.
2. **Same date, start, and name:** otherwise, among notes with a `meeting_uid`, those whose `date` and `start` match the meeting and whose file name (without a trailing ` (2)` to ` (999)`) is the name Meetings Plus would give the note, or whose first `# ` line after the front matter is the meeting title. Names and titles are compared ignoring case, extra spaces, and Unicode composition; `start` may be written `9:05`, `09:05`, or quoted.
3. Step 2 is used only when exactly one note matches; otherwise Meetings Plus creates a new note.

A note found this way opens where it is. If it is another app's note, Meetings Plus adds two properties, `meeting_dedup_key` and `meetings_plus_adopted: true`, and leaves every other line of the file as it was. Adopted notes are never renamed, moved, or rewritten afterwards, including when the meeting is rescheduled. A note Meetings Plus made for another of your calendars is opened unchanged. Found notes also show as existing in the sidebar, in the daily-note meeting list, and for pre-meeting notifications.

New notes follow HyperCap's file-name rule: characters not allowed in file names become spaces, leading dots and spaces are removed, names are capped at 200 bytes, and copies are numbered ` (2)` to ` (9)`. If all of those exist, Meetings Plus shows a notice and creates nothing.

Symlinked folders, symlinked notes, and notes with more than one hard link are treated like any other note in the folder.

**Known limit:** renaming or moving a meeting after its note exists makes a new note the next time you open it.

## Harvest tasks and questions

While a meeting runs, write action items and open questions as you go. Harvest collects them afterwards. It is off by default; turn on **Enable harvest** in the settings.

```
- T: Send the revised budget @Anna 📅 2026-11-14
- Q: Do we need sign-off from legal?
  - A: Yes, before the pilot starts
```

- `T:` is a task. `@name` says who it is for. Dates use the same markers as Tasks Plus and Obsidian Tasks: `📅` due, `⏳` scheduled, `⏰` deadline.
- `Q:` is a question. It counts as answered when a line indented under it starts with `A:`.
- Each works as a list item or as a plain line. The prefixes can be changed in the settings. Lines in code blocks are ignored.

**What Harvest changes in a note**

- Each `T:` line becomes a checkbox on the same line, with a block ID at the end: `- [ ] Send the revised budget @Anna 📅 2026-11-14 ^mp-t3k9a2`. The ID marks the line as harvested, so harvesting again changes nothing.
- `Q:` and `A:` lines stay as they are.
- The note's properties get `open_tasks_count`, `open_tasks` (the open task titles, without dates and IDs), `open_questions` and `open_questions_count` (and `things_count`, for tasks sent to Things in a later version). They are recounted on every harvest. A note with nothing to harvest gets no properties.
- Nothing else in the note is touched.

With **Count plain checkboxes as tasks** on, open `- [ ]` lines you typed yourself also get a block ID and are counted.

**When Harvest runs**

- **Harvest this note**, the button at the top of the sidebar, and the command **Harvest tasks and questions from this note** work on the note you have open, whatever note it is.
- **Harvest when leaving a note** (on once Harvest is enabled): a few seconds after you switch away from a note you edited, that note is harvested quietly.
- The command **Harvest from all notes in scope** goes through every note in scope.

**Harvest automatically from** sets what the last two cover: **Meetings Plus notes only** (the notes Meetings Plus made), or **Any note in these folders**, with a folder list that includes subfolders. Meeting notes from other apps, such as HyperCap's, are never harvested on leave or by the command for all notes; the command tells you how many it skipped. Harvest those one at a time with the button. In such a note Harvest never changes `meeting_uid`, `date`, `start`, the heading or the file name.

**Seeing the tasks and questions**

Harvested tasks are ordinary checkboxes in the meeting note, so [Tasks Plus](https://github.com/jabaho9523/obsidian-tasks-plus) and Obsidian Tasks show them without a copy. Ticking one there or in the note is the same edit.

With **Show tasks in the sidebar** on (it is, once Harvest is enabled), the sidebar shows them too:

- A meeting with a note shows how many of the note's checkboxes are open, such as "2 open". Click the count to list them under the meeting.
- **Open tasks**, at the bottom, lists the open harvested tasks from notes changed in the last 14 days (**Open tasks: days back**), newest note first, each with a link to its note. It covers the folders in **Harvest automatically from**, or your calendars' note folders with **Meetings Plus notes only**. It shows up to 50 tasks and is hidden when there are none.
- Ticking a task in the sidebar ticks it in the note, the same way Tasks Plus does: `- [x] Send the revised budget @Anna 📅 2026-11-14 ✅ 2026-11-18 ^mp-t3k9a2`. Unticking removes the `✅` date. This works in any note, notes from other apps included, because you run it on that one task.

The command **Create meetings overview** writes `Meetings overview.base` (in the first scope folder, or the vault root) and opens it. It lists notes, not lines, in two views: **Open tasks** and **Open questions**. The **Open tasks** view has a column with the task titles. An existing file is opened, never overwritten, so an overview made before 0.8.0 keeps its old columns: add the `open_tasks` property to its view, or delete the file and run the command again. Bases need Obsidian 1.9 or later and the Bases core plugin; the rest of Harvest works on older versions.

## Settings

Global options:

- **Refresh interval (minutes)** — how often calendars are fetched in the background
- **Look-ahead window (days)** — how many days of future meetings to load
- **Look-back window (days)** — how many days of past meetings you can browse (up to 365). Set to 0 to disable. Some calendars, such as Outlook published links, only include recent history.
- **Enable pre-meeting notifications** — show a notice before each meeting starts
- **Notification lead time (minutes)** — how far in advance to notify
- **Run Templater on new notes** — post-process meeting notes through Templater if installed
- **Open dashboard on startup** — auto-open the sidebar when Obsidian loads
- **Show what's new after updates** — see [What's new window](#whats-new-window)
- **Harvest** — see [Harvest tasks and questions](#harvest-tasks-and-questions)

Per-calendar options live in the calendar editor and cover URL, color, folder, title pattern, tags, template, and which features (standalone notes, daily-note append) apply.

### Filters

Each calendar can hide events you don't want cluttering the sidebar:

- **Exclude all-day events**
- **Exclude meetings you declined** — needs **Your email address**, so the plugin can find your own entry in the attendee list. Several addresses can be given, separated by commas, if the account has aliases. Feeds that don't publish attendee replies (many "publish calendar" URLs strip them) leave this with nothing to match, in which case nothing is hidden.
- **Exclude out-of-office blocks** — events your calendar marks as out of office
- **Exclude events marked as free** — reminders, birthdays, and anything else that doesn't block time

Filters apply when a feed is parsed, so changing one re-fetches that calendar and takes effect right away. Filtered events are hidden everywhere — sidebar, daily-note list, and pre-meeting notifications.

![Settings](docs/screenshot-3.png)

## What's new window

After an update with notable changes, a window shows the release notes once on each device, with a link to support the plugin. It only opens in the first 3 days after the update reaches the device. Other updates and first installs don't open it. The notes are always under **Settings → Meetings Plus → Release notes**, and the command **Show release notes** opens them too. Turn the window off with **Show what's new after updates**. The notes are bundled with the plugin, so the window makes no network calls.

## How it works (under the hood)

- Fetches each ICS feed with Obsidian's `requestUrl` (so it works on mobile and bypasses CORS)
- Parses with [ical.js](https://github.com/mozilla-comm/ical.js) — handles timezones, recurrence rules, and the messy real-world ICS variants
- Caches parsed meetings on disk so the sidebar loads instantly on cold start
- Detects Teams / Zoom / Meet / Webex links in the description, location, and Microsoft-specific properties
- Looks up existing meeting notes via the metadata cache (`meeting_dedup_key` in frontmatter) so re-clicking a meeting opens the existing note instead of creating a duplicate

Everything is local and offline except the ICS fetches themselves. There are no third-party services, no analytics, no telemetry.

## Privacy

Meetings Plus only talks to the calendar URLs you configure. It does not collect, log, or transmit calendar contents, attendee names, meeting titles, or fetch URLs anywhere else. There is no analytics layer.

Base64 is only used to send the username and password for calendar feeds that need Basic auth.

## Performance notes

Background refresh runs at your configured interval (default 15 min); on each refresh, all calendars fetch in parallel. Parsed meetings are cached per calendar so reloads are instant. Pre-meeting `setTimeout`s are cancelled and re-scheduled on every refresh so the schedule stays current.

## Plus Plugin Family

Part of the **Plus Plugin Family** for Obsidian — free, open-source, local-first:

- **[Paste Plus](https://github.com/jabaho9523/obsidian-paste-plus)** — Smart paste: URLs become titled links, images get clean filenames, HTML converts to markdown.
- **[Vault Plus](https://github.com/jabaho9523/obsidian-vault-plus)** — Vault health dashboard: find and fix orphans, broken links, empty notes, duplicates, and more.
- **[Link Plus](https://github.com/jabaho9523/obsidian-link-plus)** — Find every unlinked mention in your vault and convert them to wikilinks — one click or batch.
- **Meetings Plus** — Subscribe to calendars and create pre-filled meeting notes in one click. ICS-based, privacy-first.
- **[Tasks Plus](https://github.com/jabaho9523/obsidian-tasks-plus)** — Calm GTD over plain markdown: Inbox, Today, Upcoming, Anytime, Someday, Logbook.
- **[Assist Plus](https://github.com/jabaho9523/obsidian-assist-plus)** — Chat with Claude on your own API key, with strict control over what it sees and changes.

## Support

If Meetings Plus saves you time, you can support development here:

<a href="https://www.buymeacoffee.com/jabaho" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

0BSD — copy, paste, ship. Less drag-and-drop, more note-taking.
