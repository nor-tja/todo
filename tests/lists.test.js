import test from 'node:test';
import assert from 'node:assert';
import { createList, createListItem, toggleBought, groupLists, itemsForList } from '../assets/js/lists.js';

test('createList trims the name and defaults group_name to null', () => {
  const l = createList('  For me  ');
  assert.equal(l.name, 'For me');
  assert.equal(l.group_name, null);
});

test('createList rejects an empty name', () => {
  assert.throws(() => createList('   '));
});

test('createListItem starts not-bought', () => {
  const item = createListItem('list1', 'new hand cream');
  assert.equal(item.bought, false);
  assert.equal(item.text, 'new hand cream');
  assert.equal(item.list_id, 'list1');
});

test('createListItem rejects empty text', () => {
  assert.throws(() => createListItem('list1', ''));
});

test('toggleBought flips state without mutating the original', () => {
  const item = createListItem('list1', 'x');
  const bought = toggleBought(item);
  assert.equal(bought.bought, true);
  assert.equal(item.bought, false);
  const backToOpen = toggleBought(bought);
  assert.equal(backToOpen.bought, false);
});

test('groupLists groups one level deep, matching the spec example', () => {
  const lists = [
    createList('For me', { group_name: 'Want to buy', sort_order: 0 }),
    createList('For the house', { group_name: 'Want to buy', sort_order: 1 }),
    createList('For the kids', { group_name: 'Want to buy', sort_order: 2 }),
    createList('Reading list', { sort_order: 0 }),
  ];
  const grouped = groupLists(lists);
  assert.deepEqual(Object.keys(grouped), ['Want to buy', '']);
  assert.deepEqual(grouped['Want to buy'].map((l) => l.name), ['For me', 'For the house', 'For the kids']);
  assert.deepEqual(grouped[''].map((l) => l.name), ['Reading list']);
});

test('itemsForList puts not-bought first, each half in creation order', () => {
  const a = createListItem('l1', 'a', { now: '2026-09-01T00:00:00.000Z' });
  const b = toggleBought(createListItem('l1', 'b', { now: '2026-09-02T00:00:00.000Z' }));
  const c = createListItem('l1', 'c', { now: '2026-09-03T00:00:00.000Z' });
  const other = createListItem('l2', 'not this list', { now: '2026-09-01T00:00:00.000Z' });
  const ordered = itemsForList([b, c, a, other], 'l1');
  assert.deepEqual(ordered.map((i) => i.text), ['a', 'c', 'b']);
});
