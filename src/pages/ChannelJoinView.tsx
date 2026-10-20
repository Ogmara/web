/**
 * ChannelJoinView — deeplink landing page for joining a channel.
 *
 * URL: #/join/{channelId}[?node=<host>][&inv=<base64url invite>]
 * Public / ReadPublic channels: channel info + join button (permissionless).
 * Private channels: invite-gated (spec 05 §8.4, spec 06 §6.5). The invite
 * comes from the personal link's `inv=` parameter or from the active wallet's
 * pending `channel_invite` notification (`findPendingInvite`). Without a
 * usable invite there is NO Join button — only the invite-only text and a
 * copy-my-address button. The same invite bytes go to federate and join.
 */

import { Component, createMemo, createResource, createSignal, onCleanup, Show } from 'solid-js';
import {
  OgmaraClient,
  validateNodeUrl,
  decodeInviteFromUrl,
  decodeChannelInvite,
  INVITE_EXPIRY_MARGIN_MS,
  INVITE_FUTURE_TOLERANCE_MS,
  type ChannelDetailResponse,
} from '@ogmara/sdk';
import { t, currentLanguage } from '../i18n/init';
import { getClient, getCurrentNodeUrl } from '../lib/api';
import { authStatus, walletAddress } from '../lib/auth';
import { navigate, queryParam } from '../lib/router';
import { copyToClipboard } from '../lib/share';
import { getSwitchGeneration } from '../lib/walletScope';
import {
  evaluateInvite,
  resolveJoinInvite,
  isJoinableInvite,
  isMemberState,
  isPrivateJoinRejection,
  membershipEvidence,
  isInviteGatedChannel,
  currentChannelRecord,
  isPreviewCreator,
  isTransientFederateError,
  privateJoinAction,
  type InviteCandidate,
  type InviteEvalContext,
} from '../lib/privateInvite';
import { addJoinedChannel } from '../components/Sidebar';

interface ChannelJoinProps {
  channelId: string;
}

/** Resource value: the detail plus the (route id, wallet) it was fetched for. */
type ChannelFetch = { id: string; wallet: string | null; detail: ChannelDetailResponse | null };

const hostLabel = (url: string): string => {
  try { return new URL(url).hostname; } catch { return url; }
};

/** The `?node=` host hint, decoded (the router already decoded once; legacy links double-encode). */
const nodeHint = (): string => {
  const raw = queryParam('node');
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
};

/** Decode the personal invite link's `inv=` parameter. UNVERIFIED, display/attach only. */
const linkInviteFromRoute = (): InviteCandidate | null => {
  const raw = queryParam('inv');
  if (!raw) return null;
  const bytes = decodeInviteFromUrl(raw);
  if (!bytes) return null;
  const decoded = decodeChannelInvite(bytes);
  return decoded ? { decoded, bytes } : null;
};

export const ChannelJoinView: Component<ChannelJoinProps> = (props) => {
  const [joining, setJoining] = createSignal(false);
  const [error, setError] = createSignal('');
  // The node rejected the join for lack of a valid invite proof.
  const [inviteRejected, setInviteRejected] = createSignal(false);
  const [addressCopied, setAddressCopied] = createSignal(false);
  const [notFound, setNotFound] = createSignal(false);
  // The channel isn't on the current node, but a host hint (`?node=`, else the
  // invite's anchor node) names a node where it lives. We preview it from there.
  // Tagged with the (route id, wallet) it was fetched for; read through
  // `crossNode()`, which ignores a preview for another channel/account.
  const [crossNodeRaw, setCrossNode] = createSignal<{ host: string; detail: ChannelDetailResponse; id: string; wallet: string | null } | null>(null);

  // Coarse clock so an invite that expires while the page is open loses its
  // Join button; the click handler re-checks against the exact time anyway.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  const channelIdNum = () => parseInt(props.channelId, 10);

  const linkInvite = createMemo(linkInviteFromRoute);

  // Keyed on the wallet too: the detail (private-channel visibility) is
  // per caller, and a preview fetched for a previous account must not stay on
  // screen — or drive the join buttons — for the next one.
  //
  // The fetcher returns `{ id, wallet, detail }` and `channel()` only yields the
  // detail while id + wallet match the CURRENT route/wallet and the record's
  // own channel_id equals the route id. Without that, createResource keeps the
  // PREVIOUS key's value while the next loads: going from #/join/1 (public) to
  // #/join/2 (private) would render channel 1's public Join button for 2 and
  // join 2 with no invite (audit W1).
  const [channelRes] = createResource(
    // Falsy without an id, exactly like the previous `() => props.channelId` source.
    // `ready` is part of the key: the not-found branch consults the pending
    // invite only when auth is ready, so a cold start on #/join/X must re-fetch
    // once auth becomes ready (it is read inside the untracked fetcher).
    () => (props.channelId ? { id: props.channelId, wallet: walletAddress(), ready: authStatus() === 'ready' } : false),
    async ({ id, wallet }): Promise<ChannelFetch> => {
      setNotFound(false);
      setCrossNode(null);
      setInviteRejected(false);
      setError('');
      const cid = parseInt(id, 10);
      // The fetcher body outlives a wallet or channel change; never let a
      // stale run write the side signals the CURRENT view reads.
      const stale = () => walletAddress() !== wallet || props.channelId !== id;
      try {
        const detail = await getClient().getChannelDetail(cid);
        // A record for a different channel id is not this channel.
        if (detail?.channel?.channel_id !== cid) throw new Error('channel id mismatch');
        return { id, wallet, detail };
      } catch {
        if (stale()) return { id, wallet, detail: null };
        // Not on the current node. Host hint: the link's `?node=`, else the
        // anchor node named inside the link's invite, else the anchor node of
        // this wallet's pending invite (spec 05 §8.4 step 4).
        const cur = getCurrentNodeUrl();
        const usable = (h: string | undefined): h is string => !!h && !!validateNodeUrl(h) && h !== cur;
        let hint = nodeHint();
        if (!usable(hint)) {
          const li = linkInvite();
          hint = li && li.decoded.channelId === cid ? (li.decoded.anchorNode ?? '') : '';
        }
        if (!usable(hint) && wallet && authStatus() === 'ready') {
          try {
            const p = await getClient().findPendingInvite(cid);
            if (stale()) return { id, wallet, detail: null };
            hint = p?.anchorNode ?? '';
          } catch { /* no pending invite reachable — fall through */ }
        }
        if (usable(hint)) {
          try {
            const detail = await new OgmaraClient({ nodeUrl: hint }).getChannelDetail(cid);
            if (stale()) return { id, wallet, detail: null };
            if (detail?.channel?.channel_id === cid) {
              setCrossNode({ host: hint, detail, id, wallet });
              return { id, wallet, detail: null };
            }
            // A host answering with another channel's record: treat as not found.
          } catch {
            // host unreachable or channel really gone — fall through to not-found
          }
        }
        if (!stale()) setNotFound(true);
        return { id, wallet, detail: null };
      }
    },
  );

  /** This node's record for the CURRENT route + wallet, else null (see above). */
  const channel = (): ChannelDetailResponse | null =>
    currentChannelRecord(channelRes(), { routeId: props.channelId, wallet: walletAddress(), channelId: channelIdNum() });

  /** The cross-node preview for the CURRENT route + wallet, else null. */
  const crossNode = () => {
    const cn = crossNodeRaw();
    if (!cn) return null;
    return currentChannelRecord(cn, { routeId: props.channelId, wallet: walletAddress(), channelId: channelIdNum() })
      ? cn
      : null;
  };

  /** The record the page shows: local, else the cross-node preview. */
  const shownDetail = (): ChannelDetailResponse | null => channel() ?? crossNode()?.detail ?? null;

  // Fail-closed for GATING (isInviteGatedChannel): only an explicit Public (0)
  // / ReadPublic (1) type with an id BELOW the private floor takes the
  // permissionless path; Private, anything unrecognised, and a "public" claim
  // for a private-range id (a hostile `?node=` host) get the invite gate.
  // False while no record is shown (nothing rendered yet) — the public join
  // handlers therefore also require a shown record themselves.
  const isPrivate = () => {
    const d = shownDetail();
    if (!d) return false;
    return isInviteGatedChannel(d.channel?.channel_type, channelIdNum());
  };
  /** Positive evidence for the permissionless path: a shown record that is NOT gated. */
  const isPublicPath = () => {
    const d = shownDetail();
    return !!d && !isInviteGatedChannel(d.channel?.channel_type, channelIdNum());
  };

  // Pending invite for THIS wallet + channel, only fetched for a private
  // channel with an authenticated wallet. The value is tagged with the
  // (wallet, channel) it was fetched for and ignored otherwise: createResource
  // keeps the previous value while a new key loads.
  const [pending] = createResource(
    () => {
      const wallet = walletAddress();
      if (!props.channelId || !wallet || authStatus() !== 'ready' || !isPrivate()) return false;
      return { id: props.channelId, wallet };
    },
    async ({ id, wallet }) => {
      let cand: InviteCandidate | null = null;
      try {
        const p = await getClient().findPendingInvite(parseInt(id, 10));
        if (p) cand = { decoded: p, bytes: p.invite };
      } catch { /* treated as no pending invite */ }
      return { id, wallet, cand };
    },
  );
  const pendingCandidate = (): InviteCandidate | null => {
    const p = pending();
    if (!p || p.wallet !== walletAddress() || p.id !== props.channelId) return null;
    return p.cand;
  };
  const pendingLoading = () => {
    if (pending.loading) return true;
    const p = pending();
    // A value for another key is a stale carry-over: still effectively loading.
    return !!p && (p.wallet !== walletAddress() || p.id !== props.channelId);
  };

  // Is the active wallet ALREADY a member of this private channel on THIS
  // node? Only asked for a channel record from the home node (a cross-node
  // preview means the channel isn't here, so no membership here either). The
  // value is tagged with (wallet, generation, channel) and re-checked after the
  // await; anything stale, failed or inconclusive is "unknown" → the invite
  // gate (fail closed). The list is one page (node max 200).
  const [memberList] = createResource(
    () => {
      const wallet = walletAddress();
      if (!props.channelId || !wallet || authStatus() !== 'ready' || !channel() || !isPrivate()) return false;
      return { id: props.channelId, wallet, gen: getSwitchGeneration() };
    },
    async ({ id, wallet, gen }) => {
      try {
        const resp = await getClient().getChannelMembers(parseInt(id, 10), { limit: 200 });
        if (walletAddress() !== wallet || getSwitchGeneration() !== gen || props.channelId !== id) return null;
        return { id, wallet, gen, members: Array.isArray(resp?.members) ? resp.members : null };
      } catch {
        return null;
      }
    },
  );
  const membership = () => {
    const cid = channelIdNum();
    const rec = channel(); // matched record only (route id + wallet + channel_id)
    const ml = memberList();
    const mlCurrent = !!ml && ml.wallet === walletAddress() && ml.gen === getSwitchGeneration() && ml.id === props.channelId;
    return membershipEvidence({
      wallet: walletAddress(),
      channelId: cid,
      recordChannelId: rec?.channel?.channel_id ?? null,
      creator: rec?.channel?.creator ?? null,
      members: mlCurrent ? ml!.members : null,
      membersWallet: mlCurrent ? ml!.wallet : null,
      membersChannelId: mlCurrent ? parseInt(ml!.id, 10) : null,
    });
  };

  const evalCtx = (at: number): InviteEvalContext => ({
    channelId: channelIdNum(),
    wallet: walletAddress(),
    now: at,
    expiryMarginMs: INVITE_EXPIRY_MARGIN_MS,
    futureToleranceMs: INVITE_FUTURE_TOLERANCE_MS,
    // Matched record only (shownDetail goes through channel()/crossNode()).
    creator: shownDetail()?.channel?.creator ?? null,
    moderators: shownDetail()?.moderators ?? null,
    membership: membership(),
  });

  const inviteState = createMemo(() => resolveJoinInvite(linkInvite(), pendingCandidate(), evalCtx(now())));

  const formatDate = (ms: number): string => {
    try {
      return new Date(ms).toLocaleString(currentLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(ms).toISOString();
    }
  };

  const handleCopyAddress = async () => {
    const me = walletAddress();
    if (!me) return;
    if (await copyToClipboard(me)) {
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    }
  };

  // Already a member: open the channel (no join needed). Re-evaluated at click
  // time for the CURRENT wallet; the sidebar write is synchronous with it.
  const handleOpenMemberChannel = () => {
    const cid = channelIdNum();
    if (!walletAddress() || !isMemberState(resolveJoinInvite(null, null, evalCtx(Date.now())))) return;
    addJoinedChannel(cid);
    window.dispatchEvent(new Event('ogmara:channels-changed'));
    navigate(`/chat/${cid}`);
  };

  // The channel is NOT on the home node and the cross-node preview names the
  // active wallet as its creator: the creator hosts it here with a no-invite
  // federate (the node verifies the creator against the host's record and
  // adds them). The preview is untrusted — a lying host only earns a 403/502.
  // Membership stays home-only; this is a separate action.
  const previewIsCreator = () => {
    const cn = crossNode();
    if (channel() || !cn) return false;
    if (!isInviteGatedChannel(cn.detail.channel?.channel_type, channelIdNum())) return false;
    return isPreviewCreator(walletAddress(), cn.detail.channel?.creator, cn.detail.channel?.channel_id, channelIdNum());
  };
  const privateAction = () => privateJoinAction({
    walletReady: authStatus() === 'ready' && !!walletAddress(),
    state: inviteState(),
    crossNode: !!crossNode() && !channel(),
    previewCreator: previewIsCreator(),
  });

  const handleCreatorHost = async () => {
    const me = walletAddress();
    const gen = getSwitchGeneration();
    const routeId = props.channelId;
    const cid = channelIdNum();
    const cn = crossNode();
    const changed = () =>
      walletAddress() !== me || getSwitchGeneration() !== gen || props.channelId !== routeId || !Object.is(channelIdNum(), cid);
    if (!me || authStatus() !== 'ready') { navigate('/wallet'); return; }
    if (!cn || privateAction() !== 'creator-host') return;
    setJoining(true);
    setError('');
    setInviteRejected(false);
    try {
      // No invite: the creator is authorised by the node's own check and is
      // added as a member by the federate itself (no joinChannel needed).
      await getClient().federateChannel(cid, cn.host);
      if (changed()) return;
      addJoinedChannel(cid);
      window.dispatchEvent(new Event('ogmara:channels-changed'));
      navigate(`/chat/${cid}`);
    } catch (e: any) {
      if (changed()) return;
      if (isTransientFederateError(e)) setError(t('channel_invite_busy_retry'));
      else if (isPrivateJoinRejection(e, true)) setInviteRejected(true);
      else setError(e?.message || t('channel_federate_failed'));
    } finally {
      setJoining(false);
    }
  };

  // Private join: federate (when the channel lives on another node, or to
  // refresh from a `?node=` host) and join, both with the SAME invite bytes.
  // Captured once: every await below re-checks wallet, switch generation and
  // the channel on screen, so a wallet change mid-join never joins / records
  // the channel for the account that became active (spec 06 §6.10).
  const handlePrivateJoin = async () => {
    const me = walletAddress();
    const gen = getSwitchGeneration();
    const cid = channelIdNum();
    const cn = crossNode();
    const changed = () =>
      walletAddress() !== me || getSwitchGeneration() !== gen || !Object.is(channelIdNum(), cid);
    if (!me || authStatus() !== 'ready') { navigate('/wallet'); return; }
    const state = inviteState();
    // Re-check against the exact clock: the reactive one ticks every 30 s.
    const fresh = state.candidate ? evaluateInvite(state.candidate, evalCtx(Date.now())) : state;
    if (!isJoinableInvite(fresh) || !fresh.candidate || fresh.candidate.decoded.targetUser !== me) {
      setNow(Date.now());
      return;
    }
    const invite = fresh.candidate.bytes;
    setJoining(true);
    setError('');
    setInviteRejected(false);
    try {
      const client = getClient();
      if (cn) {
        // FEDERATE + join: tell THIS (the member's home) node to replicate the
        // channel — the node verifies the invite before fetching from the host.
        await client.federateChannel(cid, cn.host, { invite });
        if (changed()) return;
        // Announce membership to the host + other members (gossips; best-effort:
        // the federate above already recorded the verified membership here).
        try { await client.joinChannel(cid, { invite }); } catch { /* recorded by federate */ }
      } else {
        // On this node already. A `?node=` host hint re-federates to refresh
        // metadata + re-ensure the gossip subscription (best-effort).
        const hint = nodeHint();
        if (hint && validateNodeUrl(hint) && hint !== getCurrentNodeUrl()) {
          try { await client.federateChannel(cid, hint, { invite }); } catch { /* best-effort refresh */ }
          if (changed()) return;
        }
        await client.joinChannel(cid, { invite });
      }
      if (changed()) return;
      addJoinedChannel(cid);
      window.dispatchEvent(new Event('ogmara:channels-changed'));
      navigate(`/chat/${cid}`);
    } catch (e: any) {
      if (changed()) return;
      if (isTransientFederateError(e)) setError(t('channel_invite_busy_retry'));
      else if (isPrivateJoinRejection(e, true)) setInviteRejected(true);
      else setError(e?.message || t(cn ? 'channel_federate_failed' : 'error_generic'));
    } finally {
      setJoining(false);
    }
  };

  // Public / ReadPublic channels on another node (behaviour unchanged).
  const handleFederateAndJoin = async () => {
    const cn = crossNode();
    if (!cn) return;
    if (!isPublicPath()) return; // gated channels go through handlePrivateJoin only
    const me = walletAddress();
    const cid = channelIdNum();
    // Abort silently if the account or the channel on screen changed mid-flow.
    const changed = () => walletAddress() !== me || !Object.is(channelIdNum(), cid);
    if (!me) { navigate('/wallet'); return; }
    setJoining(true);
    setError('');
    try {
      const client = getClient();
      await client.federateChannel(cid, cn.host);
      // The account may have changed during the await: never join (or record
      // the channel) as whoever is active now. Abort silently.
      if (changed()) return;
      // Announce membership to the host + other members (gossips; best-effort).
      try { await client.joinChannel(cid); } catch { /* membership also recorded locally by federate */ }
      if (changed()) return;
      addJoinedChannel(cid);
      window.dispatchEvent(new Event('ogmara:channels-changed'));
      navigate(`/chat/${cid}`);
    } catch (e: any) {
      if (changed()) return;
      setError(isTransientFederateError(e) ? t('channel_invite_busy_retry') : (e?.message || t('channel_federate_failed')));
    } finally {
      setJoining(false);
    }
  };

  // Public / ReadPublic channels on this node (behaviour unchanged).
  const handlePublicJoin = async () => {
    // Captured once: every await below re-checks it, so a wallet change mid-join
    // never joins / records the channel for the account that became active.
    const me = walletAddress();
    const cid = channelIdNum();
    const changed = () => walletAddress() !== me || !Object.is(channelIdNum(), cid);
    // Positive evidence only: a matched record that is not invite-gated. A
    // missing/stale record is NOT "public" (audit W1).
    if (!isPublicPath()) return; // private joins go through handlePrivateJoin only
    setJoining(true);
    setError('');
    try {
      // Authenticated users: send join envelope so the node tracks membership.
      // Best-effort — the channel is readable without it.
      if (me) {
        try { await getClient().joinChannel(cid); } catch { /* user can still read */ }
      }
      if (changed()) return;
      // Add to local sidebar and navigate
      addJoinedChannel(cid);
      window.dispatchEvent(new Event('ogmara:channels-changed'));
      navigate(`/chat/${cid}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  /** Invite-gate block for a private channel (local or cross-node). */
  const PrivateGate = () => (
    <>
      <Show when={authStatus() !== 'ready' || !walletAddress()}>
        <p class="join-private-hint">{t('channel_private_invite_link')}</p>
        <button class="join-btn" onClick={() => navigate('/wallet')}>
          {t('auth_connect_prompt')}
        </button>
      </Show>
      <Show when={authStatus() === 'ready' && walletAddress() && isMemberState(inviteState())}>
        <button class="join-btn" onClick={handleOpenMemberChannel}>
          {t('channel_invite_already_member')}
        </button>
      </Show>
      <Show when={authStatus() === 'ready' && walletAddress() && !isMemberState(inviteState())}>
        <Show
          when={!inviteRejected() && isJoinableInvite(inviteState())}
          fallback={
            <Show
              when={inviteRejected() || (!pendingLoading() && !memberList.loading) || inviteState().kind !== 'none'}
              fallback={<div class="join-loading">{t('loading')}</div>}
            >
              <Show
                when={!inviteRejected() && privateAction() === 'creator-host'}
                fallback={
              <div class="join-invite-gate">
                <Show when={!inviteRejected() && inviteState().kind === 'wrong-account'}>
                  <p class="join-invite-status">{t('channel_invite_wrong_account')}</p>
                </Show>
                <Show when={!inviteRejected() && inviteState().kind === 'expired'}>
                  <p class="join-invite-status">
                    {t('channel_invite_expired', { date: formatDate(inviteState().candidate!.decoded.expiresAt) })}
                  </p>
                </Show>
                <p class="join-invite-title">{t('channel_invite_required')}</p>
                <p class="join-invite-desc">
                  {t('channel_invite_required_desc', { address: walletAddress() ?? '' })}
                </p>
                <button class="join-btn join-btn-secondary" onClick={handleCopyAddress}>
                  {addressCopied() ? t('channel_invite_address_copied') : t('channel_invite_copy_my_address')}
                </button>
              </div>
                }
              >
                <p class="join-private-hint">
                  {t('channel_on_other_node', { node: hostLabel(crossNode()!.host) })}
                </p>
                <button class="join-btn" onClick={handleCreatorHost} disabled={joining()}>
                  {joining() ? t('loading') : t('channel_invite_creator_host')}
                </button>
              </Show>
            </Show>
          }
        >
          <Show when={crossNode()}>
            <p class="join-private-hint">
              {t('channel_on_other_node', { node: hostLabel(crossNode()!.host) })}
            </p>
          </Show>
          <Show when={inviteState().kind === 'inviter-unverifiable'}>
            <p class="join-invite-note">{t('channel_invite_inviter_unverifiable')}</p>
          </Show>
          <button class="join-btn" onClick={handlePrivateJoin} disabled={joining()}>
            {joining() ? t('loading') : t('channel_join')}
          </button>
        </Show>
      </Show>
      <Show when={error()}>
        <div class="join-error">{error()}</div>
      </Show>
    </>
  );

  return (
    <div class="join-view">
      <Show when={notFound() && !crossNode()}>
        <div class="join-card">
          <h2 class="join-name">{t('channel_not_found')}</h2>
          <p class="join-desc">{t('channel_not_found_desc')}</p>
          <button class="join-btn" onClick={() => navigate('/news')}>{t('nav_news')}</button>
        </div>
      </Show>

      {/* The channel lives on another node (host-scoped) — preview it from the
          host and federate it to the member's home node on join (no switch). */}
      <Show when={crossNode()}>
        <div class="join-card">
          <h2 class="join-name">
            🔒 {crossNode()!.detail.channel.display_name || crossNode()!.detail.channel.slug}
          </h2>
          <Show when={(crossNode()!.detail.channel as any).description}>
            <p class="join-desc">{(crossNode()!.detail.channel as any).description}</p>
          </Show>
          <div class="join-meta">
            {(crossNode()!.detail as any)?.member_count ?? crossNode()!.detail.channel.member_count ?? 0} {t('channel_members')}
          </div>
          <Show
            when={isPrivate()}
            fallback={
              <>
                <p class="join-private-hint">
                  {t('channel_on_other_node', { node: hostLabel(crossNode()!.host) })}
                </p>
                <button class="join-btn" onClick={handleFederateAndJoin} disabled={joining()}>
                  {joining() ? t('loading') : t('channel_join')}
                </button>
                <Show when={error()}>
                  <div class="join-error">{error()}</div>
                </Show>
              </>
            }
          >
            <PrivateGate />
          </Show>
        </div>
      </Show>

      <Show when={!notFound() && !crossNode() && !channel()}>
        <div class="join-loading">{t('loading')}</div>
      </Show>
      <Show when={!notFound() && channel()}>
        <div class="join-card">
          <h2 class="join-name">
            {isPrivate() ? '🔒' : '#'} {channel()!.channel.display_name || channel()!.channel.slug}
          </h2>
          <Show when={channel()!.channel.description}>
            <p class="join-desc">{(channel()!.channel as any).description}</p>
          </Show>
          <div class="join-meta">
            {(channel() as any)?.member_count ?? channel()!.channel.member_count ?? 0} {t('channel_members')}
          </div>

          <Show
            when={isPrivate()}
            fallback={
              <>
                {/* Public / ReadPublic: can be joined anonymously */}
                <button class="join-btn" onClick={handlePublicJoin} disabled={joining()}>
                  {joining() ? t('loading') : t('channel_join')}
                </button>
                <Show when={error()}>
                  <div class="join-error">{error()}</div>
                </Show>
              </>
            }
          >
            <PrivateGate />
          </Show>
        </div>
      </Show>

      <style>{`
        .join-view {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: var(--spacing-lg);
        }
        .join-loading { color: var(--color-text-secondary); }
        .join-card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          max-width: 400px;
          width: 100%;
          text-align: center;
        }
        .join-name { font-size: var(--font-size-xl); margin-bottom: var(--spacing-sm); }
        .join-desc { color: var(--color-text-secondary); margin-bottom: var(--spacing-md); }
        .join-meta { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-lg); }
        .join-btn {
          padding: var(--spacing-sm) var(--spacing-xl);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-md);
        }
        .join-btn:disabled { opacity: 0.5; }
        .join-btn-secondary {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }
        .join-private-hint {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-md);
          padding: var(--spacing-sm);
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-md);
        }
        .join-invite-gate {
          padding: var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-md);
        }
        .join-invite-status {
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--color-text-primary);
          margin-bottom: var(--spacing-sm);
        }
        .join-invite-title { font-weight: 600; margin-bottom: var(--spacing-xs); }
        .join-invite-desc {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-md);
          overflow-wrap: anywhere;
        }
        .join-invite-note {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-md);
        }
        .join-error {
          margin-top: var(--spacing-md);
          color: #f44;
          font-size: var(--font-size-sm);
        }
      `}</style>
    </div>
  );
};
