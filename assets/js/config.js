/* Fill these in after creating a Supabase project — see SETUP.md.
 *
 * Safe to ship publicly (this file is loaded by the browser as plain JS):
 * the anon key only works because Row Level Security is enabled on every
 * table, see supabase/schema.sql. Never put a service-role key here.
 */
'use strict';

export const SUPABASE_URL = 'https://efxmsqxxdlszcbovnmmn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_RT0nR_FdCViPFsp2OM-PFQ_7KuL73Zk';

/** Where Supabase should send the user back to after a magic-link click. */
export const AUTH_REDIRECT_TO = typeof location !== 'undefined' ? location.origin + location.pathname : '';

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
