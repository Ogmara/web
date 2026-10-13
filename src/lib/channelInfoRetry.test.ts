/**
 * Channel-record retry schedule (web 0.82.0, parity with desktop).
 * Run: node --conditions=browser --test src/lib/channelInfoRetry.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialChannelInfoRetry, nextChannelInfoRetry } from './channelInfoRetry.ts';

function run(keys: string[]): (number | null)[] {
  let st = initialChannelInfoRetry();
  const out: (number | null)[] = [];
  for (const k of keys) {
    const step = nextChannelInfoRetry(st, k);
    st = step.state;
    out.push(step.delayMs);
  }
  return out;
}

test('backoff 3/6/9/12 s, then gives up for that key', () => {
  assert.deepEqual(run(['a:1', 'a:1', 'a:1', 'a:1', 'a:1', 'a:1']), [3000, 6000, 9000, 12000, null, null]);
});

test('a new channel or a new wallet re-arms the budget', () => {
  assert.deepEqual(run(['a:1', 'a:1', 'a:1', 'a:1', 'a:1', 'a:2', 'b:2']), [3000, 6000, 9000, 12000, null, 3000, 3000]);
});

test('returning to an exhausted key after another one starts fresh (budget is per current key)', () => {
  assert.deepEqual(run(['a:1', 'a:1', 'a:1', 'a:1', 'a:2', 'a:1']), [3000, 6000, 9000, 12000, 3000, 3000]);
});
