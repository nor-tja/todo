/* auth.js — Supabase magic-link email auth, no SDK.
 *
 * Supabase exposes its GoTrue auth service over plain HTTPS under
 * /auth/v1/, so — same principle as sync.js against PostgREST — this is
 * `fetch` calls and no dependency.
 *
 * Flow (implicit grant, the right choice for a static site with no
 * server to run a token exchange):
 *   1. requestMagicLink(email) -> POST /auth/v1/otp. Supabase emails a
 *      link to `${redirectTo}#access_token=...&refresh_token=...&...`.
 *   2. The user clicks it, lands back on the app; parseSessionFromUrl()
 *      reads the tokens out of location.hash.
 *   3. The session is held in memory and mirrored to a pluggable store
 *      (localStorage in the browser) so a reload does not sign the user
 *      out. refreshSession() exchanges the refresh_token for a new
 *      access_token once the old one is close to expiring.
 *
 * No password to type on a phone — which is the whole reason the spec
 * chose magic-link over email+password.
 */
'use strict';

/** How long before real expiry we treat a session as due for refresh. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Sends the magic-link email. Returns once Supabase has accepted the
 * request — the link itself arrives by email, out of band.
 * @param {{ url: string, anonKey: string, fetchImpl?: typeof fetch }} config
 * @param {string} email
 * @param {{ redirectTo?: string }} [opts]
 */
export async function requestMagicLink({ url, anonKey, fetchImpl }, email, opts = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const body = { email, create_user: true };
  if (opts.redirectTo) body.options = { redirect_to: opts.redirectTo };
  const res = await doFetch(`${url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`could not send magic link: ${res.status} ${text}`);
  }
}

/**
 * Parses the access/refresh tokens Supabase appends to the redirect URL's
 * fragment after a magic-link click. Pure — takes the hash string, not
 * `location`, so it is unit-testable.
 *
 * @param {string} hash - e.g. "#access_token=...&refresh_token=...&expires_in=3600&token_type=bearer"
 * @param {{ now?: number }} [opts] - now in epoch ms, for computing expires_at
 * @returns {object|null} a session, or null if the hash carries no tokens
 */
export function parseSessionFromUrl(hash, opts = {}) {
  const trimmed = (hash || '').replace(/^#/, '');
  if (!trimmed) return null;
  const params = new URLSearchParams(trimmed);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  const now = opts.now ?? Date.now();
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: now + expiresIn * 1000,
    token_type: params.get('token_type') ?? 'bearer',
  };
}

/**
 * Whether a session is expired, or close enough to expiring that it
 * should be refreshed before use.
 * @param {{ expires_at: number }|null} session
 * @param {{ now?: number }} [opts]
 */
export function isExpired(session, opts = {}) {
  if (!session) return true;
  const now = opts.now ?? Date.now();
  return session.expires_at - REFRESH_SKEW_MS <= now;
}

/**
 * Exchanges a refresh_token for a new session.
 * @param {{ url: string, anonKey: string, fetchImpl?: typeof fetch }} config
 * @param {string} refreshToken
 * @param {{ now?: number }} [opts]
 */
export async function refreshSession({ url, anonKey, fetchImpl }, refreshToken, opts = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`could not refresh session: ${res.status} ${text}`);
  }
  const data = await res.json();
  const now = opts.now ?? Date.now();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type ?? 'bearer',
  };
}

/** localStorage-backed session store — the browser default. */
export class LocalStorageSessionStore {
  constructor(key = 'todo-app-session') {
    this.key = key;
  }
  get() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  set(session) {
    try {
      localStorage.setItem(this.key, JSON.stringify(session));
    } catch { /* storage unavailable (private browsing, quota) — session stays in memory only */ }
  }
  clear() {
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
  }
}

/** In-memory session store, for tests and as a graceful fallback. */
export class MemorySessionStore {
  constructor() { this._session = null; }
  get() { return this._session; }
  set(session) { this._session = session; }
  clear() { this._session = null; }
}

/**
 * Ties the pieces above into the thing ui/*.js and sync.js actually hold:
 * a single object that knows the current access token, refreshes it
 * lazily when it's stale, and persists across reloads via `store`.
 */
export class AuthClient {
  constructor({ url, anonKey, fetchImpl, store } = {}) {
    this.url = url;
    this.anonKey = anonKey;
    this.fetchImpl = fetchImpl;
    this.store = store ?? new MemorySessionStore();
  }

  get session() {
    return this.store.get();
  }

  get isSignedIn() {
    return this.session != null;
  }

  requestMagicLink(email, opts) {
    return requestMagicLink({ url: this.url, anonKey: this.anonKey, fetchImpl: this.fetchImpl }, email, opts);
  }

  /** Call once on app load, before reading location.hash is lost to routing. */
  completeSignIn(hash, opts = {}) {
    const session = parseSessionFromUrl(hash, opts);
    if (session) this.store.set(session);
    return session;
  }

  /** Returns a usable access token, refreshing first if it's stale. Null if signed out. */
  async getAccessToken(opts = {}) {
    let session = this.session;
    if (!session) return null;
    if (isExpired(session, opts)) {
      session = await refreshSession({ url: this.url, anonKey: this.anonKey, fetchImpl: this.fetchImpl },
        session.refresh_token, opts);
      this.store.set(session);
    }
    return session.access_token;
  }

  signOut() {
    this.store.clear();
  }
}

// -- internal ---------------------------------------------------------------

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
