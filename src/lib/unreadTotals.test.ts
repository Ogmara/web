/**
 * Aggregate unread badges count only visible channels (web 0.82.0).
 * Run: node --conditions=browser --test src/lib/unreadTotals.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumVisibleUnread } from './unreadTotals.ts';

test('sums only the visible ids', () => {
  const map = { '1': 3, '2': 5, '99': 40 };
  assert.equal(sumVisibleUnread(map, [1, 2]), 8);
  assert.equal(sumVisibleUnread(map, new Set([2])), 5);
  assert.equal(sumVisibleUnread(map, []), 0);
});

test('a hidden channel with unread never reaches the aggregate', () => {
  assert.equal(sumVisibleUnread({ '7': 120 }, [1]), 0);
});

test('missing / malformed / negative values and duplicate ids are ignored', () => {
  const map = { '1': 2, '2': -4, '3': Number.NaN, '4': Infinity, '5': '6' as unknown as number };
  assert.equal(sumVisibleUnread(map, [1, 1, 2, 3, 4, 5, 6]), 2);
  assert.equal(sumVisibleUnread(null, [1]), 0);
  assert.equal(sumVisibleUnread(undefined, [1]), 0);
});

test('does not mutate the raw map', () => {
  const map = { '1': 1, '2': 2 };
  const before = JSON.stringify(map);
  sumVisibleUnread(map, [1]);
  assert.equal(JSON.stringify(map), before);
});
