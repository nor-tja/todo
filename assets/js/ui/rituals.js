/* ui/rituals.js — guided, one-item-at-a-time morning and weekly review
 * screens, sequenced by review.js. Large targets and keyboard shortcuts
 * (1-4), per the spec: "not a screen requiring discipline to visit."
 */
'use strict';

import { morningRitual, weeklyRitual } from '../review.js';
import { todayISO } from '../day-math.js';

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

export class RitualController {
  /**
   * @param {object} store
   * @param {{ kind: 'morning'|'weekly', context: 'work'|'home', onDone: () => void, leftoverIds?: string[] }} opts
   *   `leftoverIds` are the ids task-store.rollover() just demoted, from
   *   app.js's once-per-day rollover at boot. Rollover normally runs
   *   before the ritual is ever opened (so Today is always correct even
   *   if the ritual is skipped), which means review.js's own live
   *   rolledOver diff would already read empty by the time this runs —
   *   this is how "yesterday's leftovers, first" still works despite that.
   */
  constructor(store, { kind, context, onDone, leftoverIds = [] }) {
    this.store = store;
    this.kind = kind;
    this.context = context;
    this.onDone = onDone;
    this.leftoverIds = leftoverIds;
    this.today = todayISO();
    this.stepIndex = 0;
    this.steps = this.kind === 'morning' ? this._buildMorningSteps() : this._buildWeeklySteps();
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  _buildMorningSteps() {
    const result = morningRitual(this.store.tasks, this.store.rhythms, this.store.rhythmLog, {
      today: this.today, context: this.context,
    });
    const steps = [];
    const leftovers = this.leftoverIds.length
      ? this.store.tasks.filter((t) => this.leftoverIds.includes(t.id))
      : result.rolledOver; // fallback: ritual run in the same tick as rollover (e.g. tests)
    for (const task of leftovers) steps.push({ type: 'leftover', task });
    for (const task of result.inbox) steps.push({ type: 'inbox', task });
    for (const task of result.deadlineNominations) steps.push({ type: 'deadline', task });
    for (const nom of result.quotaNominations) steps.push({ type: 'quota-nom', ...nom });
    steps.push({ type: 'pick-five' });
    return steps;
  }

  _buildWeeklySteps() {
    const result = weeklyRitual(this.store.tasks, this.store.rhythms, this.store.rhythmLog, {
      today: this.today, context: this.context,
    });
    const steps = [];
    steps.push({ type: 'finished', tasks: result.finished });
    steps.push({ type: 'performance', rows: result.rhythmPerformance });
    for (const task of result.backlogRotation) steps.push({ type: 'rotation', task });
    for (const task of result.repeatedlyDeclined) steps.push({ type: 'declined', task });
    return steps;
  }

  renderInto(container) {
    this.container = container;
    this._render();
  }

  async _advance() {
    this.stepIndex += 1;
    if (this.stepIndex >= this.steps.length) {
      this.destroy();
      this.onDone();
      return;
    }
    this._render();
  }

  _render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    const progress = h(`<div class="ritual-progress">Step ${this.stepIndex + 1} of ${this.steps.length}</div>`);
    this.container.appendChild(progress);
    const step = this.steps[this.stepIndex];
    const el = this._renderStep(step);
    this.container.appendChild(el);
  }

  _renderStep(step) {
    switch (step.type) {
      case 'leftover': return this._taskChoiceStep(
        `Yesterday: “${escapeHtml(step.task.title)}” didn't get done.`,
        [
          ['Commit to Today', async () => { await this.store.commitToday(step.task.id); }],
          ['Leave in Backlog', async () => {}],
        ],
      );
      case 'inbox': return this._taskChoiceStep(
        `“${escapeHtml(step.task.title)}”`,
        [
          ['Work', async () => { await this.store.triage(step.task.id, 'work'); }],
          ['Home', async () => { await this.store.triage(step.task.id, 'home'); }],
          ['→ List', async () => {
            const list = this.store.lists[0];
            if (!list) { alert('Create a list first, from the Lists tab.'); return; }
            await this.store.sendInboxItemToList(step.task.id, list.id);
          }],
          ['Bin', async () => { await this.store.discardTask(step.task.id); }],
        ],
      );
      case 'deadline': return this._taskChoiceStep(
        `“${escapeHtml(step.task.title)}” is due ${step.task.deadline}. Slot it in today?`,
        [
          ['Commit to Today', async () => { await this.store.commitToday(step.task.id); }],
          ['Not now', async () => { await this.store.declineTask(step.task.id); }],
        ],
      );
      case 'quota-nom': return this._taskChoiceStep(
        `${escapeHtml(step.rhythm.name)}: ${step.stillNeeded} left by Sunday. Slot it in today?`,
        [
          ['Log now', async () => { await this.store.logRhythm(step.rhythm.id); }],
          ['Not now', async () => {}],
        ],
      );
      case 'pick-five': return this._pickFiveStep();
      case 'finished': return this._infoListStep(
        step.tasks.length ? 'Finished this week' : 'Nothing finished this week yet',
        step.tasks.map((t) => t.title),
      );
      case 'performance': return this._performanceStep(step.rows);
      case 'rotation': return this._taskChoiceStep(
        `“${escapeHtml(step.task.title)}” — still on the list.`,
        [
          ['This week', async () => { await this.store.commitToday(step.task.id); }],
          ['Not now', async () => { await this.store.declineTask(step.task.id); }],
          ['Don’t need it', async () => { await this.store.discardTask(step.task.id); }],
        ],
      );
      case 'declined': return this._taskChoiceStep(
        `“${escapeHtml(step.task.title)}” has been declined ${step.task.declined_count} times.`,
        [
          ['This week', async () => { await this.store.commitToday(step.task.id); }],
          ['Not now', async () => { await this.store.declineTask(step.task.id); }],
          ['Don’t need it', async () => { await this.store.discardTask(step.task.id); }],
        ],
      );
      default: return h('<div></div>');
    }
  }

  _taskChoiceStep(prompt, choices) {
    const el = h(`
      <div class="ritual-step">
        <div class="ritual-prompt">${prompt}</div>
        <div class="ritual-choices"></div>
      </div>
    `);
    const choicesEl = el.querySelector('.ritual-choices');
    choices.forEach(([label, action], i) => {
      const btn = h(`<button type="button">${label}<span class="kbd">${i + 1}</span></button>`);
      btn.dataset.key = String(i + 1);
      btn.addEventListener('click', async () => { await action(); await this._advance(); });
      choicesEl.appendChild(btn);
    });
    return el;
  }

  _infoListStep(title, items) {
    const el = h(`
      <div class="ritual-step">
        <div class="ritual-prompt">${title}</div>
        <ul class="task-list"></ul>
        <div class="ritual-choices"><button type="button" data-key="1">Continue<span class="kbd">1</span></button></div>
      </div>
    `);
    const ul = el.querySelector('.task-list');
    for (const title2 of items) {
      ul.appendChild(h(`<li class="task-row"><div class="task-main"><div class="task-title">${escapeHtml(title2)}</div></div></li>`));
    }
    el.querySelector('button').addEventListener('click', () => this._advance());
    return el;
  }

  _performanceStep(rows) {
    const el = h(`
      <div class="ritual-step">
        <div class="ritual-prompt">Rhythm performance</div>
        <ul class="task-list"></ul>
        <div class="ritual-choices"><button type="button" data-key="1">Continue<span class="kbd">1</span></button></div>
      </div>
    `);
    const ul = el.querySelector('.task-list');
    for (const row of rows) {
      let detail = '';
      if ('streak' in row) detail = `streak ${row.streak}`;
      else if ('count' in row) detail = `${row.count}/${row.rhythm.quota_floor}${row.metFloor ? ' — floor met' : ''}`;
      else if ('hits' in row) detail = `${row.hits} this week`;
      ul.appendChild(h(`<li class="task-row"><div class="task-main"><div class="task-title">${escapeHtml(row.rhythm.name)}</div><div class="task-meta">${detail}</div></div></li>`));
    }
    el.querySelector('button').addEventListener('click', () => this._advance());
    return el;
  }

  _pickFiveStep() {
    const remaining = this.store.tasks.filter((t) => t.state === 'today' && t.context === this.context).length;
    const backlog = this.store.tasks
      .filter((t) => t.state === 'backlog' && t.context === this.context)
      .sort((a, b) => (a.deadline ? -1 : 1));
    const el = h(`
      <div class="ritual-step">
        <div class="ritual-prompt">Pick up to five for today. (${remaining}/5 committed)</div>
        <ul class="task-list"></ul>
        <div class="ritual-choices"><button type="button" data-key="1">Finish morning review<span class="kbd">1</span></button></div>
      </div>
    `);
    const ul = el.querySelector('.task-list');
    for (const task of backlog.slice(0, 12)) {
      const row = h(`
        <li class="task-row">
          <div class="task-main"><div class="task-title">${escapeHtml(task.title)}</div></div>
          <div class="task-actions"><button type="button">Today</button></div>
        </li>
      `);
      row.querySelector('button').addEventListener('click', async () => {
        const result = await this.store.commitToday(task.id);
        if (!result.ok) { alert('Today is full (5).'); return; }
        this._render();
      });
      ul.appendChild(row);
    }
    el.querySelector('.ritual-choices button').addEventListener('click', () => this._advance());
    return el;
  }

  _onKeyDown(e) {
    if (!this.container) return;
    const btn = this.container.querySelector(`button[data-key="${e.key}"]`);
    if (btn) { e.preventDefault(); btn.click(); }
  }
}
