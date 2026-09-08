# Todo app — design

**Date:** 2026-09-08
**Status:** Approved design, pending implementation plan
**Address:** `todo.katjanorstad.no` (own repo, GitHub Pages)

## Problem

Todoist works but doesn't fit. Four complaints, all from one root cause: **a list has no
notion of commitment.** Everything ever typed sits at the same level forever, so nothing
feels urgent and everything feels urgent.

1. Everything looks equally urgent — no real prioritisation.
2. Work and home bleed together — projects and labels aren't enough separation.
3. Too slow to capture a thought — friction means things never get written down.
4. No planning or review rhythm — it's a list, not a system.

Ideas are currently captured on paper and on a reMarkable. That will not change, and the
app should not try to compete with it. Paper wins on capture because it is frictionless
and doesn't open a screen full of notifications.

## Core principle

> **"Today" is a promise you make, not a filter over due dates.**

Everything below follows from this. The mechanism that enforces it is scarcity, not
priority flags — priority flags always inflate until everything is P1.

## Three tracks

Conflating these three is precisely why a generic todo app fails. They have different
lifecycles and belong in different places.

### Track A — Tasks (things that finish)

A task is in exactly one of four states:

| State | Meaning |
|---|---|
| `inbox` | Captured, undecided. One line of text, no other fields. |
| `backlog` | Triaged into Work or Home. Real, but not now. |
| `today` | Committed to today. **Hard cap of 5.** |
| `done` | Finished. Retained — seeing what you did matters. |

**The cap is the whole design.** Committing a sixth task requires demoting one. That is a
real decision, and it is the one Todoist never forces. The cap is **fixed at 5** in v1 and
not configurable — a configurable cap is a cap that rises.

**Daily rollover.** At the user's local midnight, uncompleted `today` tasks return to
`backlog`. They do *not* silently carry over. The morning ritual surfaces them first, as
yesterday's leftovers, so each day's five are re-promised rather than inherited. Rollover
uses the existing `day-math.js` from katjanorstad.no, which already handles timezone-correct
day boundaries and has tests.

**Nothing rots.** The backlog is never displayed in full. The weekly review deals a
**rotating sample** — roughly five items, least-recently-seen first — each offering
*This week* / *Not now* / *Don't need it*. "Not now" sends the item to the back of the
rotation. A home-maintenance task resurfaces every few weeks without the user ever
scrolling past sixty items, and without a separate "someday" bucket.

### Track B — Rhythms (things that repeat)

Rhythms live in their own strip and **never count against the cap of 5**. Ticking hand
cream is not a unit of work.

Three flavours:

| Flavour | Example | Behaviour |
|---|---|---|
| `daily` | Meditate, hand cream | Streak count. Resets at local midnight. |
| `quota` | Exercise 2–4×/week | Floor and stretch target. No assigned days. |
| `scheduled` | Water plants (Sun), rent (1st) | Fixed weekday or day-of-month. |

**Quota** is the flavour no off-the-shelf app handles. There are no assigned days; the
user logs it when it happens. Progress shows as pips against the floor, with a ghost pip
for the stretch target, so hitting the floor reads as a win rather than a partial failure.

**The quota week runs Monday to Sunday** and resets at local midnight on Monday.

The quota **nominates itself** in the morning ritual when the days remaining in the week
equal the number still needed to reach the floor — that is, when every remaining day must
be used. *"Exercise: 2 left by Sunday. Slot it in today?"* It asks at most once per day and
does not nag.

**Scheduled** rhythms appear on their day only. Missed ones carry over with a quiet
marker rather than vanishing.

The strip only ever shows what is **still open today**. Completed rhythms disappear
immediately; rhythms not due today are absent. With 12 rhythms configured, a typical day
shows three or four rows. A good day physically shrinks the screen.

### Track C — Lists (things you are not committing to)

"New hand cream" is not a task. It has no deadline, it will not be done today, and in a
backlog it would trigger a nonsensical "this week?" prompt. Lists sit entirely outside
Inbox/Backlog/Today. They never nag, never appear in a review, never count toward anything.

A list has a name and items; an item has text and a bought/not-bought state. Lists may be
grouped one level deep. Initial structure:

```
Want to buy
  For me · For the house · For the kids
```

Deliberately dumb. No dates, no priorities, no assignment.

**Lists are Home-context only** and are hidden in Work mode.

## Modes

**Work and Home are modes, not labels.** A single toggle at the top. In Work mode, home
tasks, home rhythms and all lists are *absent* — not greyed out, not filtered.

Each device remembers its own default: the work laptop opens in Work, the home laptop
opens in Home, the phone remembers the last used.

**Work mode is not empty.** It shows work-tagged rhythms (weekly report, standup notes)
and a quiet waiting line — *"6 in backlog, 2 in inbox. Nothing due before Friday."* — which
gives a sense of what is behind the screen without putting it on the screen.

## Capture

A text field sits at the top of every screen, always focused on load. Type, press Enter,
the item lands in the Inbox. **No date picker, no project, no priority, no tags.**

This is the field used to empty a reMarkable page. Because it only accepts lines of text,
transcribing a page is fast enough to do while re-reading it.

On the laptops, a keyboard shortcut focuses the field from anywhere in the app.

**Type is decided at triage, not at capture.** This is the thing Todoist cannot do — it
forces the decision at capture time, which is exactly when the user does not want to think.

## Rituals

### Morning (~2 minutes)

1. Yesterday's uncompleted commitments, first.
2. Inbox items, one at a time: `Work` / `Home` / `→ List` / `Bin`.
3. Nominations — deadlines within range, and quotas at risk. Each asks once.
4. Pick up to five for today.

### Weekly (~10 minutes)

1. What was actually finished this week.
2. Rhythm performance — streaks held, quotas met against floor and stretch.
3. Backlog rotation — ~5 least-recently-seen items, `This week` / `Not now` / `Don't need it`.
4. Anything declined three times, shown plainly. Repeated avoidance is a signal worth seeing.

Both rituals are guided, one item at a time, with large targets and keyboard shortcuts —
not a screen requiring discipline to visit.

## Deadlines

> **A deadline is a consequence, not a preference.** Not "when I'd like to do this" — "what
> goes wrong if I don't."

Most tasks have no date. Critically:

> **A deadline never inserts anything into Today. It only nominates.**

A dated task begins nominating in the morning ritual **three days before its deadline**, or
immediately if it is created closer than that. It asks once per morning. The user answers.
Today stays hand-picked and capped at 5.

Overdue items do not turn red and shout. They keep nominating, and the weekly review
surfaces anything declined three or more times.

## Visual design

Inherits katjanorstad.no's system. The role rules are enforced by test on that site and
are enforced here too.

**Typography**

| Role | Face | Used for |
|---|---|---|
| `--font-serif` | EB Garamond | Anything that is a sentence: task titles, running text |
| `--font-ui` | Avenir Next system stack | Furniture: labels, nav, tags, buttons. Tracked uppercase |
| `--font-mono` | DM Mono | Figures only: streaks, `2 / 5`, quota counts. **Never a word, never uppercase** |

**Base palette** (from `site.css`)

```
--bg    #f5f2ed    --ink         #1a1814
--muted #6e6963    --line        #d8d3cc
                   --line-strong #8f8b87
```

**Mode palette — Crimson & Teal** (Sanzo Wada, from the pomodoro palette set)

The mode switch is a palette switch. The user feels which mode they are in before reading
anything.

| | light | mid | dark | sand |
|---|---|---|---|---|
| Home (warm) | `#d9a2b0` | `#a92f4e` | `#7c2239` | `#dfb0bc` |
| Work (cool) | `#c2dcda` | `#509994` | `#3a706c` | `#cbe1e0` |

**Colour carries meaning, not decoration.** Filled ring = done. Sand wash across a row =
completed. Pips = quota progress, ghost pip = stretch target. Solid tag = due today.
Nothing else is coloured.

**Form.** Hairline rules, not cards. 2px radii. No drop shadows. The capture field is a
ruled line with an italic Garamond placeholder — paper being written on.

All colours are CSS custom properties, so porting the remaining ~30 pairings and the
shuffle button from the pomodoro later is an afternoon, not a rewrite.

## Architecture

Same stack as katjanorstad.no: **vanilla HTML/CSS/JS, ES modules, no build step, no npm
dependencies.**

| Piece | Choice |
|---|---|
| Frontend | Vanilla JS, no framework |
| Hosting | GitHub Pages, own repo, `todo.katjanorstad.no` |
| Data | Supabase (hosted Postgres) via plain `fetch` against PostgREST |
| Auth | Supabase magic-link email — no password to type on a phone |
| Offline | Service worker + IndexedDB with a replay queue |
| Tests | `node:test` + `node:assert` |

**Supabase needs no SDK.** It exposes PostgREST over HTTPS, so all access is
`fetch('…/rest/v1/tasks', { headers })`. The zero-dependency rule holds.

### Modules

Small files, one job each, following the `assets/js/` pattern. The first three are pure
logic — no DOM, no network — which is what makes them testable the way `day-math.js` is.

| Module | Responsibility | Depends on |
|---|---|---|
| `day-math.js` | Timezone-correct day boundaries | — (ported from the site) |
| `task-store.js` | Four states, the cap, transitions, rollover | `day-math` |
| `rhythms.js` | Streaks, quota maths, schedule matching, nomination | `day-math` |
| `review.js` | Morning and weekly flow sequencing, backlog rotation | `task-store`, `rhythms` |
| `sync.js` | `fetch` wrappers, offline queue, replay | — |
| `ui/*.js` | Rendering and events only | all of the above |

### Data model

```sql
tasks
  id, user_id, title, notes,
  context      enum('work','home')      -- null while in inbox
  state        enum('inbox','backlog','today','done')
  deadline     date null                 -- rare, means consequence
  committed_on date null                 -- which day it was promised to
  declined_count int default 0           -- for the avoidance signal
  last_seen_at timestamptz               -- drives backlog rotation
  created_at, updated_at, completed_at, sort_order

rhythms
  id, user_id, name,
  kind         enum('daily','quota','scheduled')
  context      enum('work','home')
  quota_floor  int null, quota_stretch int null   -- kind='quota'
  weekday      int null, day_of_month int null    -- kind='scheduled'
  active       bool

rhythm_log
  id, user_id, rhythm_id, done_on date   -- unique(rhythm_id, done_on)

lists            id, user_id, name, group_name, sort_order
list_items       id, user_id, list_id, text, bought, created_at
review_sessions  id, user_id, kind('daily','weekly'), completed_at
```

Streaks and quota progress are **derived from `rhythm_log`**, never stored. A stored
counter is a second source of truth that drifts the first time a sync is replayed twice.

### Sync and offline

Every change writes to IndexedDB first and renders immediately, then enqueues a sync.
The queue replays on reconnect. Writes are idempotent, keyed by client-generated UUID, so
a replayed queue cannot double-apply.

**Conflict handling is last-write-wins per field.** A deliberate trade: this is one user
who is rarely on two devices simultaneously, so conflicts are genuinely rare, and CRDTs
would be a large amount of machinery for a problem that mostly doesn't occur. The cost is
that a truly simultaneous edit of the same field on two devices can lose one side.

### Security

The Supabase anon key ships in public JavaScript. That is normal and safe **only with Row
Level Security enabled**, so every row is filtered to the authenticated user by the
database itself. With RLS off, a public key means a public database.

This is a tested requirement: a test asserts that every table has RLS enabled and that an
unauthenticated request returns zero rows.

### Testing

Following the site's conventions:

- **Pure logic** — `task-store`, `rhythms`, `review`, `day-math`: direct unit tests. The
  cap, rollover at timezone boundaries, streak counting across gaps, quota nomination
  arithmetic, backlog rotation ordering.
- **Sync** — queue replay, idempotency, offline→online transition against a fake fetch.
- **Security** — RLS enabled on every table; anonymous reads return nothing.
- **Design system** — mirroring `typography.test.js`: mono is never used for a word,
  furniture is never serif, only the four semantic colour uses appear.

## Out of scope

Deliberately excluded from v1:

- **reMarkable integration.** Unofficial API, and handwriting OCR on messy notes is poor.
  High effort, likely disappointing.
- **Photo capture into the inbox.** Plausible later; unproven need now.
- **Projects or sub-projects.** Contexts plus lists cover the stated need. Adding grouping
  before it hurts is how apps become Todoist.
- **Sharing, collaboration, assignment.** Single user.
- **Native iOS app.** The PWA installs to the home screen and needs no Apple Developer
  account.
- **The palette switcher.** Colours are already tokens; adding it later is cheap.
- **Natural-language date parsing at capture.** Capture stays a single unparsed line.

## Build order

The tracks share a data model and a UI shell, so they belong in one spec — but they do not
have to land at once. The implementation plan should phase them, each phase independently
usable:

1. **Shell and Track A** — auth, capture, Inbox, Backlog, Today with the cap, rollover,
   Work/Home modes. Usable as a todo app on its own.
2. **Rituals** — morning triage and the weekly review, including backlog rotation.
   This is what turns the list into a system.
3. **Track B** — rhythms in all three flavours, streaks, quota nomination.
4. **Track C** — lists, and the `→ List` button in triage.
5. **Offline** — service worker, IndexedDB, replay queue. Deliberately last: it is easier
   to add to a working app than to debug alongside one.

## Success criteria

1. Capturing a thought from paper takes one keystroke to start and one to finish.
2. The Today screen never shows more than five tasks.
3. Work mode contains zero home content.
4. A backlog item cannot go more than ~6 weeks without being offered in a review.
5. Every device shows the same state within seconds of reconnecting.
6. The app works offline and syncs cleanly afterwards.
7. Zero runtime npm dependencies; no build step.
