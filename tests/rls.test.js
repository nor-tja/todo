/* Security tests for supabase/schema.sql.
 *
 * The static checks below run anywhere, with no network and no live
 * project — they parse the SQL text itself. They are the enforcement for
 * the spec's requirement: "a test asserts that every table has RLS
 * enabled."
 *
 * The one live check (an anonymous, unauthenticated request against every
 * table returns zero rows) needs a real Supabase project and is written
 * further down, gated on SUPABASE_URL / SUPABASE_ANON_KEY environment
 * variables. It skips itself — rather than failing — when they are not
 * set, which is expected until config.js is filled in (see SETUP.md).
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');

const TABLES = ['tasks', 'rhythms', 'rhythm_log', 'lists', 'list_items', 'review_sessions'];

test('every table in the data model has row level security enabled', () => {
  const missing = TABLES.filter(
    (t) => !new RegExp(`alter table ${t} enable row level security`, 'i').test(SQL),
  );
  assert.deepEqual(missing, [], `no "enable row level security" for: ${missing.join(', ')}`);
});

test('every table has at least one policy scoping rows to auth.uid() = user_id', () => {
  const missing = TABLES.filter((t) => {
    const policyBlock = new RegExp(`create policy[\\s\\S]*?on ${t}[\\s\\S]*?;`, 'i').exec(SQL);
    if (!policyBlock) return true;
    return !/auth\.uid\(\)\s*=\s*user_id/.test(policyBlock[0]);
  });
  assert.deepEqual(missing, [], `no owner-scoped policy for: ${missing.join(', ')}`);
});

test('every table\'s user_id defaults to auth.uid(), so a client cannot forge another user\'s row', () => {
  for (const t of TABLES) {
    const tableBlock = new RegExp(`create table if not exists ${t} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(SQL);
    assert.ok(tableBlock, `no create table found for ${t}`);
    assert.match(tableBlock[1], /user_id\s+uuid not null default auth\.uid\(\)/,
      `${t}.user_id does not default to auth.uid()`);
  }
});

test('rhythm_log enforces one entry per rhythm per day at the database level', () => {
  assert.match(SQL, /unique\s*\(rhythm_id,\s*done_on\)/i,
    'rhythm_log has no unique(rhythm_id, done_on) — a replayed sync could double-log a day');
});

// -- live check, opt-in only ------------------------------------------------

test('anonymous requests return zero rows from every table (live project)', async (t) => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    t.skip('SUPABASE_URL / SUPABASE_ANON_KEY not set — run against a live project to exercise this');
    return;
  }
  for (const table of TABLES) {
    const res = await fetch(`${url}/rest/v1/${table}?select=id`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    assert.equal(res.status, 200, `${table}: expected 200, got ${res.status}`);
    const rows = await res.json();
    assert.deepEqual(rows, [], `${table}: anonymous request returned rows — RLS is not filtering them out`);
  }
});
