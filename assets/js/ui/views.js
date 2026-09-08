/* ui/views.js — rendering and events for Today, Backlog, Inbox and Lists.
 * Pulls data through task-store.js / rhythms.js / lists.js, mutates state
 * through store.js, and re-renders via the `onChange` callback the app
 * shell passes in. No logic lives here beyond turning data into DOM and
 * DOM events into store calls.
 */
'use strict';

import { todayList, remainingCapacity, CAP } from '../task-store.js';
import { todaysStrip } from '../rhythms.js';
import { todayISO } from '../day-math.js';
import { groupLists, itemsForList } from '../lists.js';

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// -- Today ------------------------------------------------------------

export function renderToday(container, store, { context, onChange }) {
  const today = todayISO();
  const strip = todaysStrip(store.rhythms, store.rhythmLog, { context, today });
  const list = todayList(store.tasks, { context });
  const remaining = remainingCapacity(store.tasks, { context });

  const section = h(`
    <div>
      ${strip.length ? `<div class="section">
        <div class="section-title">Today's rhythms</div>
        <div class="rhythm-strip"></div>
      </div>` : ''}
      <div class="section">
        <div class="section-title">
          Today
          <span class="fig cap-meter${remaining === 0 ? ' at-cap' : ''}">${CAP - remaining}/${CAP}</span>
        </div>
        <ul class="task-list"></ul>
        ${list.length === 0 ? '<p class="empty-note">Nothing committed yet — pull something from Backlog.</p>' : ''}
      </div>
      <div class="section">
        <div class="section-title">Rhythms <button type="button" class="rhythm-log-btn" id="toggle-add-rhythm">+ new</button></div>
        <div id="add-rhythm-form"></div>
      </div>
    </div>
  `);

  if (strip.length) {
    const stripEl = section.querySelector('.rhythm-strip');
    for (const row of strip) stripEl.appendChild(renderRhythmRow(row, store, onChange));
  }

  const ul = section.querySelector('.task-list');
  for (const task of list) {
    ul.appendChild(renderTaskRow(task, store, onChange, { showDemote: true }));
  }

  wireAddRhythmForm(section, store, context, onChange);

  container.appendChild(section);
}

function renderRhythmRow(row, store, onChange) {
  const { rhythm } = row;
  const el = h(`
    <div class="rhythm-row">
      <span class="rhythm-name${row.overdue ? ' is-overdue' : ''}">${escapeHtml(rhythm.name)}</span>
      <span class="rhythm-status"></span>
    </div>
  `);
  const status = el.querySelector('.rhythm-status');
  if (rhythm.kind === 'daily') {
    status.innerHTML = `<span class="streak">${row.streak}🔥</span>`;
    const btn = h('<button type="button" class="rhythm-log-btn">Done</button>');
    btn.addEventListener('click', async () => { await store.logRhythm(rhythm.id); onChange(); });
    status.appendChild(btn);
  } else if (rhythm.kind === 'quota') {
    const pips = h('<span class="pips"></span>');
    for (const p of row.pips) {
      pips.appendChild(h(`<span class="pip${p.filled ? ' filled' : ''}${p.ghost ? ' ghost' : ''}"></span>`));
    }
    status.appendChild(pips);
    const btn = h('<button type="button" class="rhythm-log-btn">Log</button>');
    btn.addEventListener('click', async () => { await store.logRhythm(rhythm.id); onChange(); });
    status.appendChild(btn);
  } else {
    const btn = h(`<button type="button" class="rhythm-log-btn">${row.overdue ? 'Missed — log now' : 'Done'}</button>`);
    btn.addEventListener('click', async () => { await store.logRhythm(rhythm.id); onChange(); });
    status.appendChild(btn);
  }
  return el;
}

function wireAddRhythmForm(section, store, context, onChange) {
  const toggle = section.querySelector('#toggle-add-rhythm');
  const target = section.querySelector('#add-rhythm-form');
  toggle.addEventListener('click', () => {
    target.innerHTML = '';
    target.appendChild(buildAddRhythmForm(store, context, onChange));
  });
}

function buildAddRhythmForm(store, context, onChange) {
  const form = h(`
    <form class="ritual-step" style="margin-top:.6rem;">
      <div class="ritual-choices" style="margin-bottom:.8rem;">
        <input type="text" name="name" placeholder="Name (e.g. Meditate)" required
          style="font-family:var(--font-serif);font-size:var(--fs-md);border:0;border-bottom:1px solid var(--line-strong);background:transparent;flex:1;min-width:10rem;padding:.3rem 0;">
      </div>
      <div class="ritual-choices" style="margin-bottom:.8rem;">
        <label><input type="radio" name="kind" value="daily" checked> Daily</label>
        <label><input type="radio" name="kind" value="quota"> Quota (x per week)</label>
        <label><input type="radio" name="kind" value="scheduled"> Scheduled (a fixed day)</label>
      </div>
      <div class="ritual-choices" id="kind-fields" style="margin-bottom:.8rem;"></div>
      <div class="ritual-choices">
        <button type="submit">Add rhythm</button>
      </div>
    </form>
  `);

  const kindFields = form.querySelector('#kind-fields');
  function renderKindFields(kind) {
    kindFields.innerHTML = '';
    if (kind === 'quota') {
      kindFields.appendChild(h('<label>Floor <input type="number" name="quota_floor" min="1" value="2" style="width:3.5rem;"></label>'));
      kindFields.appendChild(h('<label>Stretch <input type="number" name="quota_stretch" min="1" value="4" style="width:3.5rem;"></label>'));
    } else if (kind === 'scheduled') {
      kindFields.appendChild(h(`
        <label>Day of week
          <select name="weekday">
            <option value="0">Monday</option><option value="1">Tuesday</option>
            <option value="2">Wednesday</option><option value="3">Thursday</option>
            <option value="4">Friday</option><option value="5">Saturday</option>
            <option value="6" selected>Sunday</option>
          </select>
        </label>
      `));
    }
  }
  renderKindFields('daily');
  for (const radio of form.querySelectorAll('input[name="kind"]')) {
    radio.addEventListener('change', (e) => renderKindFields(e.target.value));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const kind = data.get('kind');
    const rhythm = { name: data.get('name'), kind, context };
    if (kind === 'quota') {
      rhythm.quota_floor = Number(data.get('quota_floor')) || 1;
      rhythm.quota_stretch = Number(data.get('quota_stretch')) || rhythm.quota_floor;
    } else if (kind === 'scheduled') {
      rhythm.weekday = Number(data.get('weekday'));
    }
    await store.addRhythm(rhythm);
    onChange();
  });

  return form;
}

function renderTaskRow(task, store, onChange, opts = {}) {
  const row = h(`
    <li class="task-row${task.state === 'done' ? ' is-done' : ''}">
      <button type="button" class="task-ring" aria-label="Mark done"></button>
      <div class="task-main">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">${task.deadline ? `<span class="tag-today">Due ${task.deadline}</span>` : ''}</div>
      </div>
      <div class="task-actions"></div>
    </li>
  `);
  row.querySelector('.task-ring').addEventListener('click', async () => {
    if (task.state === 'done') await store.reopenTask(task.id);
    else await store.completeTask(task.id);
    onChange();
  });
  const actions = row.querySelector('.task-actions');
  if (opts.showDemote && task.state === 'today') {
    const demote = h('<button type="button">Demote</button>');
    demote.addEventListener('click', async () => { await store.demoteTask(task.id); onChange(); });
    actions.appendChild(demote);
  }
  if (opts.showCommit && task.state === 'backlog') {
    const commit = h('<button type="button">Today</button>');
    commit.addEventListener('click', async () => {
      const result = await store.commitToday(task.id);
      if (!result.ok && result.reason === 'cap') {
        alert('Today is full (5). Demote something first.');
      }
      onChange();
    });
    actions.appendChild(commit);
  }
  return row;
}

// -- Backlog ------------------------------------------------------------

export function renderBacklog(container, store, { context, onChange }) {
  const backlog = store.tasks
    .filter((t) => t.state === 'backlog' && t.context === context)
    .sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : 1;
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.last_seen_at < b.last_seen_at ? -1 : 1;
    });

  const section = h(`
    <div class="section">
      <div class="section-title">Backlog <span class="fig">${backlog.length}</span></div>
      <ul class="task-list"></ul>
      ${backlog.length === 0 ? '<p class="empty-note">Nothing waiting. Triage the inbox to fill this.</p>' : ''}
    </div>
  `);
  const ul = section.querySelector('.task-list');
  for (const task of backlog) {
    ul.appendChild(renderTaskRow(task, store, onChange, { showCommit: true }));
  }
  container.appendChild(section);
}

// -- Inbox ------------------------------------------------------------

export function renderInbox(container, store, { context, onChange }) {
  const inbox = store.tasks
    .filter((t) => t.state === 'inbox')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const section = h(`
    <div class="section">
      <div class="section-title">Inbox <span class="fig">${inbox.length}</span></div>
      <ul class="task-list"></ul>
      ${inbox.length === 0 ? '<p class="empty-note">Nothing to triage.</p>' : ''}
    </div>
  `);
  const ul = section.querySelector('.task-list');
  for (const task of inbox) {
    const row = h(`
      <li class="task-row">
        <div class="task-main"><div class="task-title">${escapeHtml(task.title)}</div></div>
        <div class="task-actions"></div>
      </li>
    `);
    const actions = row.querySelector('.task-actions');
    const work = h('<button type="button">Work</button>');
    work.addEventListener('click', async () => { await store.triage(task.id, 'work'); onChange(); });
    const home = h('<button type="button">Home</button>');
    home.addEventListener('click', async () => { await store.triage(task.id, 'home'); onChange(); });
    const toList = h('<button type="button">→ List</button>');
    toList.addEventListener('click', async () => {
      const list = store.lists[0];
      if (!list) { alert('Create a list first, from the Lists tab.'); return; }
      await store.sendInboxItemToList(task.id, list.id);
      onChange();
    });
    const bin = h('<button type="button">Bin</button>');
    bin.addEventListener('click', async () => { await store.discardTask(task.id); onChange(); });
    actions.append(work, home, toList, bin);
    ul.appendChild(row);
  }
  container.appendChild(section);
}

// -- Lists (Home-only) --------------------------------------------------

export function renderLists(container, store, { onChange }) {
  const grouped = groupLists(store.lists);

  const wrap = h('<div class="section"><div class="section-title">Lists</div></div>');
  const addListForm = h(`
    <form class="ritual-choices" style="margin-bottom:1rem;">
      <input type="text" name="name" placeholder="New list…" style="font-family:var(--font-serif);font-size:var(--fs-md);border:0;border-bottom:1px solid var(--line-strong);background:transparent;flex:1;min-width:8rem;padding:.3rem 0;">
      <button type="submit">Add list</button>
    </form>
  `);
  addListForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = addListForm.elements.name;
    if (!input.value.trim()) return;
    await store.addList(input.value);
    input.value = '';
    onChange();
  });
  wrap.appendChild(addListForm);

  for (const [group, lists] of Object.entries(grouped)) {
    if (group) wrap.appendChild(h(`<div class="list-group-title">${escapeHtml(group)}</div>`));
    for (const list of lists) {
      wrap.appendChild(renderListBlock(list, store, onChange));
    }
  }
  container.appendChild(wrap);
}

function renderListBlock(list, store, onChange) {
  const items = itemsForList(store.listItems, list.id);
  const block = h(`
    <div class="list-block">
      <div class="list-name">${escapeHtml(list.name)}</div>
      <ul class="list-items"></ul>
      <form class="ritual-choices">
        <input type="text" name="text" placeholder="Add item…" style="font-family:var(--font-serif);border:0;border-bottom:1px solid var(--line-strong);background:transparent;flex:1;min-width:8rem;padding:.3rem 0;">
        <button type="submit">Add</button>
      </form>
    </div>
  `);
  const ul = block.querySelector('.list-items');
  for (const item of items) {
    const row = h(`
      <li class="list-item${item.bought ? ' is-bought' : ''}">
        <button type="button" class="list-item-check" aria-label="Toggle bought"></button>
        <span class="list-item-text">${escapeHtml(item.text)}</span>
      </li>
    `);
    row.querySelector('.list-item-check').addEventListener('click', async () => {
      await store.toggleItemBought(item.id);
      onChange();
    });
    ul.appendChild(row);
  }
  const form = block.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.elements.text;
    if (!input.value.trim()) return;
    await store.addListItem(list.id, input.value);
    input.value = '';
    onChange();
  });
  return block;
}
