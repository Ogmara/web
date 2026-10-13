/**
 * Per-account detail routes do not carry over into a different account
 * (web 0.82.0). Run: node --conditions=browser --test src/lib/accountRoutes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralRouteForAccountDetail, routeAfterAccountChange } from './accountRoutes.ts';

const r = (view: string, params: Record<string, string> = {}) => ({ view, params });

test('neutral route per view (explicit table)', () => {
  const table: [ReturnType<typeof r>, string | null][] = [
    [r('chat', { channelId: '42' }), '/chat'],
    [r('chat'), null],
    [r('channel-settings', { channelId: '42' }), '/chat'],
    [r('channel-join', { channelId: '42' }), null], // invite links survive a switch
    [r('dm-conversation', { address: 'klv1peer' }), '/dm'],
    [r('dm'), null],
    [r('news'), null],
    [r('news-detail', { msgId: 'ab' }), null],
    [r('user', { address: 'klv1x' }), null],
    [r('settings'), null],
    [r('wallet'), null],
  ];
  for (const [route, expected] of table) {
    assert.equal(neutralRouteForAccountDetail(route), expected, JSON.stringify(route));
  }
});

test('A -> B (via null) on a channel/DM detail route redirects', () => {
  assert.equal(routeAfterAccountChange(r('chat', { channelId: '9' }), 'klv1a', 'klv1b'), '/chat');
  assert.equal(routeAfterAccountChange(r('dm-conversation', { address: 'p' }), 'klv1a', 'klv1b'), '/dm');
});

test('first login in a page keeps deep links', () => {
  assert.equal(routeAfterAccountChange(r('chat', { channelId: '9' }), null, 'klv1b'), null);
  assert.equal(routeAfterAccountChange(r('channel-join', { channelId: '9' }), null, 'klv1b'), null);
});

test('an invite link is left alone across an account change', () => {
  assert.equal(routeAfterAccountChange(r('channel-join', { channelId: '9' }), 'klv1a', 'klv1b'), null);
});

test('same account back, or signing out, does not redirect', () => {
  assert.equal(routeAfterAccountChange(r('chat', { channelId: '9' }), 'klv1a', 'klv1a'), null);
  assert.equal(routeAfterAccountChange(r('chat', { channelId: '9' }), 'klv1a', null), null);
});

test('non-account routes never redirect', () => {
  assert.equal(routeAfterAccountChange(r('news'), 'klv1a', 'klv1b'), null);
  assert.equal(routeAfterAccountChange(r('user', { address: 'x' }), 'klv1a', 'klv1b'), null);
});
