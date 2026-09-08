import test from 'node:test';
import assert from 'node:assert';
import {
  requestMagicLink, parseSessionFromUrl, isExpired, refreshSession,
  MemorySessionStore, AuthClient,
} from '../assets/js/auth.js';

function fakeAuthServer() {
  const sent = [];
  const refreshed = [];
  async function fetchImpl(url, { method, body }) {
    const u = new URL(url);
    if (u.pathname.endsWith('/auth/v1/otp')) {
      sent.push(JSON.parse(body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (u.pathname.endsWith('/auth/v1/token')) {
      const req = JSON.parse(body);
      refreshed.push(req.refresh_token);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: `new-access-for-${req.refresh_token}`,
          refresh_token: `new-refresh-for-${req.refresh_token}`,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  }
  return { fetchImpl, sent, refreshed };
}

// -- requestMagicLink -------------------------------------------------

test('requestMagicLink posts the email to /auth/v1/otp', async () => {
  const server = fakeAuthServer();
  await requestMagicLink({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: server.fetchImpl }, 'katja@example.com');
  assert.equal(server.sent.length, 1);
  assert.equal(server.sent[0].email, 'katja@example.com');
});

test('requestMagicLink surfaces a failure', async () => {
  const failing = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(
    () => requestMagicLink({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: failing }, 'x@example.com'),
    /429/,
  );
});

// -- parseSessionFromUrl ------------------------------------------------

test('parseSessionFromUrl extracts tokens from a magic-link redirect hash', () => {
  const hash = '#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer';
  const session = parseSessionFromUrl(hash, { now: 1_000_000 });
  assert.equal(session.access_token, 'abc123');
  assert.equal(session.refresh_token, 'def456');
  assert.equal(session.expires_at, 1_000_000 + 3600 * 1000);
});

test('parseSessionFromUrl returns null when there are no tokens', () => {
  assert.equal(parseSessionFromUrl(''), null);
  assert.equal(parseSessionFromUrl('#type=recovery'), null);
});

test('parseSessionFromUrl tolerates a leading # or none', () => {
  const withHash = parseSessionFromUrl('#access_token=a&refresh_token=b&expires_in=60', { now: 0 });
  const withoutHash = parseSessionFromUrl('access_token=a&refresh_token=b&expires_in=60', { now: 0 });
  assert.deepEqual(withHash, withoutHash);
});

// -- isExpired ------------------------------------------------------------

test('isExpired is true for a null session', () => {
  assert.equal(isExpired(null), true);
});

test('isExpired accounts for the refresh skew, not just the exact instant', () => {
  const session = { expires_at: 100_000 };
  assert.equal(isExpired(session, { now: 100_000 - 59_000 }), true, 'inside the 60s skew window');
  assert.equal(isExpired(session, { now: 100_000 - 120_000 }), false, 'well before expiry');
});

// -- refreshSession ---------------------------------------------------------

test('refreshSession exchanges the refresh token for a new session', async () => {
  const server = fakeAuthServer();
  const session = await refreshSession(
    { url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: server.fetchImpl },
    'old-refresh',
    { now: 0 },
  );
  assert.equal(session.access_token, 'new-access-for-old-refresh');
  assert.equal(session.refresh_token, 'new-refresh-for-old-refresh');
  assert.equal(session.expires_at, 3600 * 1000);
});

// -- AuthClient -------------------------------------------------------------

test('AuthClient.completeSignIn stores the session from a redirect hash', () => {
  const store = new MemorySessionStore();
  const client = new AuthClient({ url: 'https://x.supabase.co', anonKey: 'anon', store });
  assert.equal(client.isSignedIn, false);
  client.completeSignIn('#access_token=a&refresh_token=b&expires_in=3600', { now: 0 });
  assert.equal(client.isSignedIn, true);
  assert.equal(client.session.access_token, 'a');
});

test('AuthClient.getAccessToken returns null when signed out', async () => {
  const client = new AuthClient({ url: 'https://x.supabase.co', anonKey: 'anon', store: new MemorySessionStore() });
  assert.equal(await client.getAccessToken(), null);
});

test('AuthClient.getAccessToken returns the current token without refreshing when fresh', async () => {
  const server = fakeAuthServer();
  const store = new MemorySessionStore();
  store.set({ access_token: 'still-good', refresh_token: 'r1', expires_at: 1_000_000_000 });
  const client = new AuthClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: server.fetchImpl, store });
  const token = await client.getAccessToken({ now: 0 });
  assert.equal(token, 'still-good');
  assert.equal(server.refreshed.length, 0);
});

test('AuthClient.getAccessToken refreshes and persists a stale session', async () => {
  const server = fakeAuthServer();
  const store = new MemorySessionStore();
  store.set({ access_token: 'expiring', refresh_token: 'r1', expires_at: 1000 });
  const client = new AuthClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: server.fetchImpl, store });
  const token = await client.getAccessToken({ now: 5000 });
  assert.equal(token, 'new-access-for-r1');
  assert.equal(client.session.access_token, 'new-access-for-r1', 'refreshed session is persisted to the store');
});

test('AuthClient.signOut clears the stored session', () => {
  const store = new MemorySessionStore();
  store.set({ access_token: 'a', refresh_token: 'b', expires_at: 999999999 });
  const client = new AuthClient({ url: 'https://x.supabase.co', anonKey: 'anon', store });
  client.signOut();
  assert.equal(client.isSignedIn, false);
});
