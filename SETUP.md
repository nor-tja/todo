# Setup

This implements the design in `docs/superpowers/specs/2026-09-08-todo-app-design.md`.
Everything is vanilla JS, ES modules, no build step, no npm runtime dependencies —
`package.json` exists only to mark `"type": "module"` for the test runner.

## Run the tests

```sh
npm test
```

131 tests across day-math, task-store, rhythms, review, lists, sync, auth, the store
glue layer, the RLS schema, and the design-system rules. All pure logic is covered;
`assets/js/app.js` and `assets/js/ui/*.js` are rendering/wiring and are not unit
tested (see "What isn't tested" below).

## Run it locally

ES modules need to be served over HTTP, not opened as a `file://` URL. Any static
server works, e.g.:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`. Without a Supabase project configured (see
below), the app runs entirely local — it stores everything in this browser's
IndexedDB and shows a small notice that nothing is syncing yet. That's enough to
use every screen and every ritual.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   plenty for one user).
2. In the project's SQL Editor, paste and run `supabase/schema.sql`. It's
   idempotent, so re-running it is safe if you tweak anything.
3. In Project Settings → API, copy the **Project URL** and the **anon public**
   key.
4. Fill them into `assets/js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```

5. In Authentication → URL Configuration, add the URL you'll serve the app from
   (e.g. `https://todo.katjanorstad.no` and `http://localhost:8000` for local
   testing) to the **Redirect URLs** allow-list — otherwise Supabase will refuse
   to send the magic-link user back to the app.
6. Reload the app. The config notice disappears and you'll get a sign-in screen
   instead — enter an email, click the link it sends you, and you're in.

The anon key is safe to ship in this public JS file *because* every table in
`schema.sql` has Row Level Security enabled, filtering every row to
`auth.uid() = user_id`. `tests/rls.test.js` checks this statically; if you want
to also check it against your live project, run:

```sh
SUPABASE_URL=https://xxxxxxxx.supabase.co SUPABASE_ANON_KEY=eyJ... npm test
```

That adds one more live test — an anonymous request against every table should
come back empty.

## Deploy to GitHub Pages at `todo.katjanorstad.no`

1. Push this repo to its own GitHub repo (the spec calls for "own repo,
   GitHub Pages" — separate from katjanorstad.no's repo).
2. In the repo's Settings → Pages, set the source to the `main` branch, root.
3. The `CNAME` file isn't in this repo yet — add one containing exactly
   `todo.katjanorstad.no` at the repo root (same pattern as the katjanorstad.no
   repo's own `CNAME`), and commit it.
4. In your DNS provider, add a `CNAME` record for `todo` pointing at
   `<your-github-username>.github.io`.
5. Back in Supabase's Redirect URLs, add `https://todo.katjanorstad.no`.

## Icons

`assets/icons/icon-192.png` and `icon-512.png` are placeholders (a simple ring +
dot in the home palette) generated for this build, just so the PWA manifest
resolves to something real rather than a broken image. Swap them for real
artwork whenever you want — nothing else depends on their content, only their
paths and sizes.

## What's built

Every module in the spec's architecture table:

- `day-math.js`, `task-store.js`, `rhythms.js`, `review.js`, `lists.js` — pure
  logic, fully unit tested (Tracks A, B, C; both rituals; the cap; rollover;
  streaks; quota nomination; scheduled carryover; backlog rotation).
- `sync.js` — PostgREST client (insert = idempotent upsert, update = per-field
  patch, delete = idempotent), plus the offline queue with replay and
  transient/permanent failure handling. Tested against a fake fetch.
- `auth.js` — Supabase magic-link flow (request link, parse the redirect
  tokens, refresh, sign out), tested against a fake auth endpoint.
- `local-db.js` — the IndexedDB mirror every write goes through first.
- `store.js` — glues the above into the app's actual state, tested against
  fake local-db/sync-queue implementations.
- `supabase/schema.sql` — the full data model with RLS on every table.
- `assets/css/site.css` + `app.css` — the typography and colour system from
  the spec (role tokens, the Crimson & Teal mode palette, the four semantic
  colour uses), checked by `tests/design-system.test.js`.
- `assets/js/app.js` + `ui/*.js` — the actual screens: capture, Today/Backlog/
  Inbox, Work/Home mode, the guided morning and weekly rituals with keyboard
  shortcuts (1-4), the rhythms strip (including a small "+ new" form to create
  rhythms — the spec doesn't describe this screen explicitly, so it's kept
  deliberately minimal), Lists (Home-only), and a service worker + manifest for
  offline/installable use.

I exercised the whole flow (capture → triage → commit → complete, adding and
logging a rhythm, both rituals, the mode toggle, lists) in a real headless
browser while building this, not just by reading the code.

## What isn't tested (and is worth your own pass)

- The UI/wiring layer (`app.js`, `ui/*.js`) has no automated tests — only the
  manual browser pass above. If you change it, re-check by hand.
- Auth and sync are tested against fakes, not a live Supabase project. Once you
  have credentials in `config.js`, actually sign in and watch a task round-trip
  to the Supabase table editor before trusting it.
- The service worker's offline behaviour (kill the network mid-session, reload)
  hasn't been exercised against a real deploy — only written to match the
  spec's intent (cache-first shell, network never intercepted for `/rest/v1`
  or `/auth/v1`).
- Multi-device conflict behaviour (last-write-wins per field) is unit tested at
  the sync-queue level, but not tried with two real browsers editing the same
  task at once.

## Deliberately deferred (matches the spec's "Out of scope")

reMarkable integration, photo capture, projects/sub-projects, sharing, a
native iOS app, the palette switcher, natural-language date parsing at
capture.
