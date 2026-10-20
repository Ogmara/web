/**
 * Regression test for audit W1 (web 0.83.0): ChannelJoinView's `channel`
 * resource keeps the PREVIOUS route's value while the next one loads (no
 * Suspense). Going from #/join/1 (public) to #/join/2 (private) used to
 * render channel 1's public Join for channel 2 and join 2 without an invite.
 *
 * Mirrors the view's wiring (resource source { id, wallet }, fetcher returns
 * { id, wallet, detail }) and reads it through the SAME guard the view uses
 * (`currentChannelRecord` + `isInviteGatedChannel`). The negative control
 * reads the raw resource value and must reproduce the stale public record.
 * A source probe pins the view to that wiring.
 *
 * Run: node --conditions=browser --test src/pages/channelJoinStaleRecord.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoot, createSignal, createResource } from 'solid-js';
import { currentChannelRecord, isInviteGatedChannel } from '../lib/privateInvite.ts';

type Detail = { channel: { channel_id: number; channel_type: number } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('stale public record never drives the next (private) route', async () => {
  await createRoot(async (dispose) => {
    const [routeId, setRouteId] = createSignal('1');
    const wallet = () => 'klv1me';
    let release2: () => void = () => {};
    const [res] = createResource(
      () => ({ id: routeId(), wallet: wallet() }),
      async ({ id, wallet: w }) => {
        if (id === '2') await new Promise<void>((r) => { release2 = r; });
        const detail: Detail = { channel: { channel_id: Number(id), channel_type: id === '1' ? 0 : 2 } };
        return { id, wallet: w, detail };
      },
    );
    const guarded = () => currentChannelRecord(res(), { routeId: routeId(), wallet: wallet(), channelId: Number(routeId()) });
    const publicPath = () => { const d = guarded(); return !!d && !isInviteGatedChannel(d.channel.channel_type, Number(routeId())); };

    await wait(5);
    assert.equal(publicPath(), true, 'positive control: channel 1 is public');

    setRouteId('2');
    await wait(5);
    // Negative control: the raw value is still channel 1's public record.
    assert.equal(res()?.detail.channel.channel_id, 1);
    assert.equal(res()?.detail.channel.channel_type, 0);
    // The guard hides it: no public path for channel 2 while it loads.
    assert.equal(guarded(), null);
    assert.equal(publicPath(), false);

    release2();
    await wait(5);
    assert.equal(guarded()?.channel.channel_id, 2);
    assert.equal(publicPath(), false, 'channel 2 is private: gated');
    dispose();
  });
});

test('source probe: ChannelJoinView reads the record through the guard and gates public joins on it', () => {
  const src = readFileSync(new URL('./ChannelJoinView.tsx', import.meta.url), 'utf8');
  assert.match(src, /currentChannelRecord\(channelRes\(\)/);
  assert.match(src, /isInviteGatedChannel\(d\.channel\?\.channel_type, channelIdNum\(\)\)/);
  // Both public join handlers require positive evidence.
  const fed = src.slice(src.indexOf('const handleFederateAndJoin'), src.indexOf('const handlePublicJoin'));
  assert.match(fed, /if \(!isPublicPath\(\)\) return;/);
  const pub = src.slice(src.indexOf('const handlePublicJoin'), src.indexOf('/** Invite-gate block'));
  assert.match(pub, /if \(!isPublicPath\(\)\) return;/);
  // The old fail-open guard must be gone.
  assert.doesNotMatch(pub, /if \(isPrivate\(\)\) return;/);
});
