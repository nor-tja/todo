/* Track C — lists (things you are not committing to).
 *
 * Pure logic, same style as task-store.js and rhythms.js. Lists sit
 * entirely outside Inbox/Backlog/Today: no dates, no priorities, no
 * assignment, no review. "New hand cream" is not a task.
 *
 * Lists have no `context` field at all — per the spec, lists are Home-only
 * by nature and simply absent from the UI in Work mode, rather than
 * filtered by a stored context like tasks and rhythms are.
 *
 * Grouping is exactly one level deep: a list belongs to an optional
 * group_name (e.g. "Want to buy"), and groups do not nest further. The
 * initial structure from the spec:
 *
 *   Want to buy
 *     For me · For the house · For the kids
 *
 * is three lists ("For me", "For the house", "For the kids") that all
 * share group_name "Want to buy" — not one list with three sub-lists.
 */
'use strict';

/**
 * @param {string} name
 * @param {{ group_name?: string|null, sort_order?: number, id?: string }} [opts]
 */
export function createList(name, opts = {}) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('a list needs a name');
  return {
    id: opts.id ?? randomId(),
    user_id: null,
    name: trimmed,
    group_name: opts.group_name ?? null,
    sort_order: opts.sort_order ?? 0,
  };
}

/**
 * @param {string} listId
 * @param {string} text
 * @param {{ id?: string, now?: string }} [opts]
 */
export function createListItem(listId, text, opts = {}) {
  const trimmed = String(text).trim();
  if (!trimmed) throw new Error('a list item needs text');
  return {
    id: opts.id ?? randomId(),
    user_id: null,
    list_id: listId,
    text: trimmed,
    bought: false,
    created_at: opts.now ?? new Date().toISOString(),
  };
}

/** Flips an item's bought state. Pure — returns a new item. */
export function toggleBought(item) {
  return { ...item, bought: !item.bought };
}

/**
 * Groups a flat array of lists by group_name, one level deep. Ungrouped
 * lists (group_name null) come back under the key '' so callers can render
 * them as a section with no heading rather than losing them.
 *
 * @param {object[]} lists
 * @returns {Record<string, object[]>} insertion-ordered by first appearance
 */
export function groupLists(lists) {
  const groups = {};
  for (const list of [...lists].sort((a, b) => a.sort_order - b.sort_order)) {
    const key = list.group_name ?? '';
    if (!groups[key]) groups[key] = [];
    groups[key].push(list);
  }
  return groups;
}

/**
 * Items for one list, not-bought first (what's left to get), then bought,
 * each group in creation order — so the list reads top-to-bottom as a
 * shrinking shopping list rather than shuffling as items are checked off.
 * @param {object[]} items
 * @param {string} listId
 */
export function itemsForList(items, listId) {
  const mine = items.filter((i) => i.list_id === listId);
  const open = mine.filter((i) => !i.bought).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const bought = mine.filter((i) => i.bought).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return [...open, ...bought];
}

// -- internal ---------------------------------------------------------------

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
