/* app.js — bootstrap: config check, auth gate, local store, shell wiring.
 * Rendering and events only past this point — all the logic it calls into
 * lives in task-store.js / rhythms.js / review.js / lists.js / sync.js /
 * auth.js / store.js, per the module table in the design spec.
 */
'use strict';

import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_REDIRECT_TO, isConfigured } from './config.js';
import { AuthClient, LocalStorageSessionStore } from './auth.js';
import { createPostgrestClient, SyncQueue, IndexedDBQueueStore } from './sync.js';
import { LocalDB } from './local-db.js';
import { Store } from './store.js';
import { rollover, remainingCapacity } from './task-store.js';
import { todayISO } from './day-math.js';
import { renderToday, renderBacklog, renderInbox, renderLists } from './ui/views.js';
import { RitualController } from './ui/rituals.js';

const els = {
  configNotice: document.getElementById('config-notice'),
  signin: document.getElementById('signin'),
  signinForm: document.getElementById('signin-form'),
  signinEmail: document.getElementById('signin-email'),
  signinStatus: document.getElementById('signin-status'),
  app: document.getElementById('app'),
  modeToggle: document.getElementById('mode-toggle'),
  waitingLine: document.getElementById('waiting-line'),
  capture: document.getElementById('capture'),
  nav: document.getElementById('nav'),
  view: document.getElementById('view'),
};

const MODE_KEY = 'todo-app-mode';
const LAST_ROLLOVER_KEY = 'todo-app-last-rollover';
const rolloverIdsKey = (day) => `todo-app-rollover-ids-${day}`;

const state = {
  mode: localStorage.getItem(MODE_KEY) || 'home',
  view: 'today',
};

let store;
let auth;
let syncQueue;
let ritualController = null;

async function main() {
  if (!isConfigured()) {
    els.configNotice.hidden = false;
    // No Supabase project yet: run local-only rather than blocking behind
    // a sign-in screen that can't work without config. Everything still
    // lands in IndexedDB; there is just nothing to sync to until
    // config.js is filled in (see SETUP.md).
    await bootApp({ offlineOnly: true });
    return;
  }

  auth = new AuthClient({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    store: new LocalStorageSessionStore(),
  });
  auth.completeSignIn(location.hash);
  if (location.hash.includes('access_token')) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  wireSignIn();

  if (!auth.isSignedIn) {
    showSignIn();
    return;
  }

  await bootApp({});
}

function wireSignIn() {
  els.signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = els.signinEmail.value.trim();
    if (!email) return;
    els.signinStatus.textContent = 'Sending…';
    try {
      await auth.requestMagicLink(email, { redirectTo: AUTH_REDIRECT_TO });
      els.signinStatus.textContent = 'Check your email for a sign-in link.';
    } catch (err) {
      els.signinStatus.textContent = String(err.message || err);
    }
  });
}

function showSignIn() {
  els.signin.hidden = false;
  els.app.hidden = true;
}

async function bootApp(opts = {}) {
  els.signin.hidden = true;
  els.app.hidden = false;

  if (opts.offlineOnly) {
    syncQueue = null;
  } else {
    const client = createPostgrestClient({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      getAccessToken: () => auth.session && auth.session.access_token,
      fetchImpl: (...args) => fetch(...args),
    });
    syncQueue = new SyncQueue({
      client,
      store: new IndexedDBQueueStore(),
      onDropped: (op, err) => console.warn('sync: dropped op', op, err),
    });
  }

  store = new Store({ localDb: new LocalDB(), syncQueue });
  await store.load();
  await ensureRolloverForToday();

  applyMode(state.mode);
  wireModeToggle();
  wireCapture();
  wireNav();
  wireKeyboardShortcut();
  registerServiceWorker();

  render();

  if (syncQueue) window.addEventListener('online', () => syncQueue.replay());
}

/**
 * Daily rollover — "at the user's local midnight, uncompleted `today`
 * tasks return to backlog" — applied the first time the app is opened on
 * a given day, whichever screen that happens to be. Runs at most once per
 * day (idempotent either way, since task-store.rollover() is itself
 * idempotent, but this also avoids re-touching last_seen_at repeatedly).
 *
 * Which tasks it affected is recorded under a per-day key so the morning
 * ritual can still surface them as "yesterday's leftovers" even if it
 * runs later than the boot that actually performed the rollover.
 */
async function ensureRolloverForToday() {
  const today = todayISO();
  if (localStorage.getItem(LAST_ROLLOVER_KEY) === today) return;
  const before = store.tasks;
  const rolledTasks = rollover(before, { today });
  const changedIds = before
    .map((t, i) => (t !== rolledTasks[i] ? t.id : null))
    .filter(Boolean);
  await store.setTasks(rolledTasks);
  localStorage.setItem(LAST_ROLLOVER_KEY, today);
  localStorage.setItem(rolloverIdsKey(today), JSON.stringify(changedIds));
}

// -- shell: mode, capture, nav --------------------------------------------

function applyMode(mode) {
  state.mode = mode;
  document.body.classList.remove('mode-home', 'mode-work');
  document.body.classList.add(`mode-${mode}`);
  localStorage.setItem(MODE_KEY, mode);
  for (const btn of els.modeToggle.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
}

function wireModeToggle() {
  els.modeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    applyMode(btn.dataset.mode);
    render();
  });
}

function wireCapture() {
  els.capture.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const title = els.capture.value.trim();
    if (!title) return;
    await store.capture(title);
    els.capture.value = '';
    render();
  });
}

function wireNav() {
  els.nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    if (state.view !== 'rituals') ritualController = null;
    render();
  });
}

function wireKeyboardShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' && !(e.key === 'k' && (e.metaKey || e.ctrlKey))) return;
    if (document.activeElement === els.capture) return;
    e.preventDefault();
    els.capture.focus();
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('sw registration failed', err));
  }
}

// -- render -----------------------------------------------------------

function render() {
  renderNav();
  renderWaitingLine();
  els.view.innerHTML = '';

  if (state.view === 'today') {
    renderToday(els.view, store, { context: state.mode, onChange: render });
  } else if (state.view === 'backlog') {
    renderBacklog(els.view, store, { context: state.mode, onChange: render });
  } else if (state.view === 'inbox') {
    renderInbox(els.view, store, { context: state.mode, onChange: render });
  } else if (state.view === 'lists') {
    renderLists(els.view, store, { onChange: render });
  } else if (state.view === 'rituals') {
    renderRituals();
  }
}

function renderNav() {
  const inboxCount = store.tasks.filter((t) => t.state === 'inbox').length;
  const cap = remainingCapacity(store.tasks, { context: state.mode });
  for (const btn of els.nav.querySelectorAll('button[data-view]')) {
    btn.setAttribute('aria-current', btn.dataset.view === state.view ? 'page' : 'false');
    if (btn.dataset.view === 'inbox') {
      btn.querySelector('.fig').textContent = inboxCount ? String(inboxCount) : '';
    }
    if (btn.dataset.view === 'today') {
      btn.querySelector('.fig').textContent = `${5 - cap}/5`;
    }
  }
  const listsBtn = els.nav.querySelector('button[data-view="lists"]');
  if (listsBtn) listsBtn.hidden = state.mode === 'work';
}

function renderWaitingLine() {
  if (state.mode !== 'work') {
    els.waitingLine.textContent = '';
    return;
  }
  const backlog = store.tasks.filter((t) => t.state === 'backlog' && t.context === 'work').length;
  const inbox = store.tasks.filter((t) => t.state === 'inbox').length;
  const withDeadline = store.tasks.filter(
    (t) => t.state === 'backlog' && t.context === 'work' && t.deadline,
  );
  const nextDeadline = withDeadline.sort((a, b) => (a.deadline < b.deadline ? -1 : 1))[0];
  const deadlineNote = nextDeadline ? ` Next due ${nextDeadline.deadline}.` : ' Nothing due soon.';
  els.waitingLine.innerHTML =
    `<span class="fig">${backlog}</span> in backlog, <span class="fig">${inbox}</span> in inbox.${deadlineNote}`;
}

function renderRituals() {
  els.view.innerHTML = `
    <div class="section">
      <div class="section-title">Rituals</div>
      <div class="ritual-choices">
        <button type="button" id="start-morning">Morning review</button>
        <button type="button" id="start-weekly">Weekly review</button>
      </div>
    </div>
  `;
  document.getElementById('start-morning').addEventListener('click', () => {
    const today = todayISO();
    const leftoverIds = JSON.parse(localStorage.getItem(rolloverIdsKey(today)) || '[]');
    ritualController = new RitualController(store, {
      kind: 'morning', context: state.mode, onDone: render, leftoverIds,
    });
    ritualController.renderInto(els.view);
  });
  document.getElementById('start-weekly').addEventListener('click', () => {
    ritualController = new RitualController(store, { kind: 'weekly', context: state.mode, onDone: render });
    ritualController.renderInto(els.view);
  });
}

main();
