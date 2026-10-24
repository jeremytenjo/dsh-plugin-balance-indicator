/**
 * Browser half of the DeepSeek balance indicator.
 *
 * Registers one action in the left sidebar footer beside the account row. The
 * balance is a TanStack Query cache entry: it reads the loopback balance
 * route, polls on a slow interval, refreshes on focus and reconnect, and
 * exposes retry through the same query. Selecting the amount opens the
 * Platform usage page.
 *
 * The sidebar footer is one row shared with the shipped Plugins launcher, so
 * the action is a compact pill and renders only while the sidebar is wide.
 *
 * This file is the source; `scripts/build-client.mjs` bundles it into the
 * plugin's `client.js` so the page can load it through the module loader.
 */

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as React from 'react';

const h = React.createElement;

const NS = 'deepseek-balance-indicator';
const ROUTE = '/__dsh/deepseek-balance';
const QUERY_ROOT = ['dsh-balance-indicator', 'balance'];
const POLL_MS = 60_000;
const STALE_MS = 20_000;
const GC_MS = 5 * 60_000;
const USAGE_FALLBACK = 'https://platform.deepseek.com/usage';

const EN = {
  loading: 'Balance…',
  loadingTitle: 'Reading your DeepSeek Platform balance…',
  signedOut: 'Sign in',
  signedOutTitle: 'Sign in to DeepSeek in Settings → Account to see your remaining balance.',
  signedOutAria: 'DeepSeek balance unavailable: not signed in.',
  failed: 'Balance unavailable',
  failedShort: 'Unavailable',
  failedTitle: 'Could not read your DeepSeek balance. Select to retry.',
  failedAria: 'DeepSeek balance unavailable. Select to retry.',
  label: 'DeepSeek balance',
  bonus: 'Bonus balance',
  empty: '—',
  updated: 'Updated {time}',
  openUsage: 'Select to open platform.deepseek.com/usage.',
  readyAria: 'DeepSeek balance {amount}. Select to open usage in a new tab.',
};

const ZH = {
  loading: '余额…',
  loadingTitle: '正在读取 DeepSeek 平台余额…',
  signedOut: '未登录',
  signedOutTitle: '在“设置 → 账户”中登录 DeepSeek 后即可查看剩余余额。',
  signedOutAria: 'DeepSeek 余额不可用：尚未登录。',
  failed: '余额不可用',
  failedShort: '不可用',
  failedTitle: '无法读取 DeepSeek 余额。点击重试。',
  failedAria: 'DeepSeek 余额不可用。点击重试。',
  label: 'DeepSeek 余额',
  bonus: '赠送余额',
  empty: '—',
  updated: '更新于 {time}',
  openUsage: '点击打开 platform.deepseek.com/usage。',
  readyAria: 'DeepSeek 余额 {amount}。点击在新标签页中打开用量页面。',
};

const STYLES = `
.dsh-balance-seat {
  box-sizing: border-box;
  display: flex;
  flex: none;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dsh-balance-pill {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  height: 42px;
  margin: 0;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
}
.dsh-balance-pill svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
button.dsh-balance-pill {
  cursor: pointer;
}
button.dsh-balance-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
button.dsh-balance-pill:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-balance-pill[data-phase='signed-out'],
.dsh-balance-pill[data-phase='loading'],
.dsh-balance-pill[data-phase='failed'] {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-balance-amount {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
`;

function ensureStyles() {
  if (typeof document === 'undefined') return () => {};
  const style = document.createElement('style');
  style.dataset.dshDeepseekBalance = '';
  style.textContent = STYLES;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

function activeLocale(clientCtx) {
  try {
    const locale = clientCtx?.locale?.getSnapshot?.().active;
    if (typeof locale === 'string' && locale.length > 0) return locale;
  } catch {
    // Fall through to English when the locale service is unavailable.
  }
  return 'en';
}

function readClientVersion() {
  try {
    const version = window.__DSH_BOOT__?.release?.version;
    if (typeof version === 'string' && version.length > 0) return version;
  } catch {
    // Older shells have no boot manifest; the Host falls back to Electron.
  }
  return '';
}

function timezoneOffsetSeconds() {
  return -new Date().getTimezoneOffset() * 60;
}

function currencySymbol(currency) {
  if (currency === 'CNY') return '¥';
  if (currency === 'USD') return '$';
  return `${currency} `;
}

function formatAmount(wallet, lang) {
  const value = Number(wallet.balance);
  if (!Number.isFinite(value)) return `${wallet.balance} ${wallet.currency}`;
  let text;
  try {
    text = new Intl.NumberFormat(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    text = value.toFixed(2);
  }
  return `${currencySymbol(wallet.currency)}${text}`;
}

function formatTime(at, lang) {
  try {
    return new Date(at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(at).toLocaleTimeString();
  }
}

function walletList(data, key) {
  const list = data?.[key];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (wallet) =>
      wallet !== null &&
      typeof wallet === 'object' &&
      typeof wallet.currency === 'string' &&
      typeof wallet.balance === 'string',
  );
}

function primaryWallet(data, lang) {
  const wallets = walletList(data, 'wallets');
  if (wallets.length === 0) return null;
  const preferred = /^zh/i.test(lang) ? 'CNY' : 'USD';
  return wallets.find((wallet) => wallet.currency === preferred) ?? wallets[0];
}

function tooltip(t, state, lang) {
  if (state.phase === 'loading') return t('loadingTitle');
  if (state.phase === 'signed-out') return t('signedOutTitle');
  if (state.phase !== 'ready') return t('failedTitle');
  const lines = [t('label')];
  for (const wallet of walletList(state.data, 'wallets')) {
    lines.push(`${formatAmount(wallet, lang)} ${wallet.currency}`);
  }
  const bonus = walletList(state.data, 'bonusWallets').filter((wallet) => Number(wallet.balance) > 0);
  if (bonus.length > 0) {
    lines.push(t('bonus'));
    for (const wallet of bonus) {
      lines.push(`${formatAmount(wallet, lang)} ${wallet.currency}`);
    }
  }
  if (typeof state.data?.fetchedAt === 'number') {
    lines.push(t('updated', { time: formatTime(state.data.fetchedAt, lang) }));
  }
  lines.push(t('openUsage'));
  return lines.join('\n');
}

async function requestBalance(signal, force, clientCtx) {
  const url = new URL(ROUTE, window.location.origin);
  url.searchParams.set('locale', activeLocale(clientCtx));
  url.searchParams.set('tz', String(timezoneOffsetSeconds()));
  const version = readClientVersion();
  if (version !== '') url.searchParams.set('v', version);
  if (force) url.searchParams.set('refresh', '1');
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('The balance endpoint returned an unreadable response.');
  }
  if (!response.ok || body === null || body.ok !== true) {
    throw new Error('The balance request failed.');
  }
  return body;
}

function balancePhase(body) {
  return body?.status === 'ready' || body?.status === 'signed-out' ? body.status : 'failed';
}

/**
 * One cache entry per language and timezone. A successful response carrying a
 * `failed` status stays data (not an error) so the previous amount can keep
 * rendering while the Host retries on the next poll.
 */
function useBalanceQuery(clientCtx, lang, forceRef) {
  return useQuery({
    queryKey: [...QUERY_ROOT, lang, timezoneOffsetSeconds()],
    queryFn: ({ signal }) => {
      const force = forceRef.current;
      forceRef.current = false;
      return requestBalance(signal, force, clientCtx);
    },
    staleTime: STALE_MS,
    gcTime: GC_MS,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

function WalletIcon() {
  return h(
    'svg',
    {
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M2.25 4.5A1.75 1.75 0 0 1 4 2.75h6.85c.62 0 1.18.32 1.5.81' }),
    h('rect', { x: 2.25, y: 4.5, width: 11.5, height: 8.75, rx: 1.9 }),
    h('path', { d: 'M10.4 8.9h2.1' }),
  );
}

function BalanceIndicator(props) {
  const { t, clientCtx } = props;
  const lang = activeLocale(clientCtx);
  const forceRef = React.useRef(false);
  const query = useBalanceQuery(clientCtx, lang, forceRef);
  const data = query.data ?? null;
  const phase = data === null ? (query.isError ? 'failed' : 'loading') : balancePhase(data);
  const state = { phase, data };

  const wallet = primaryWallet(data, lang);
  const amount = wallet === null ? null : formatAmount(wallet, lang);
  let text;
  if (phase === 'ready') text = amount ?? t('empty');
  else if (phase === 'signed-out') text = t('signedOut');
  else if (phase === 'failed') text = t('failedShort');
  else text = t('loading');

  let ariaLabel;
  if (phase === 'ready') ariaLabel = t('readyAria', { amount: amount ?? t('empty') });
  else if (phase === 'signed-out') ariaLabel = t('signedOutAria');
  else if (phase === 'failed') ariaLabel = t('failedAria');
  else ariaLabel = t('loadingTitle');

  const interactive = phase === 'ready' || phase === 'failed';
  const onClick = () => {
    if (phase === 'ready') {
      const usageUrl = data?.links?.usageUrl;
      window.open(typeof usageUrl === 'string' && usageUrl !== '' ? usageUrl : USAGE_FALLBACK, '_blank', 'noopener,noreferrer');
      return;
    }
    forceRef.current = true;
    query.refetch();
  };

  const pillProps = {
    className: 'dsh-balance-pill',
    'data-phase': phase,
    title: tooltip(t, state, lang),
    'aria-label': ariaLabel,
  };
  if (query.isFetching) pillProps['aria-busy'] = 'true';
  if (interactive) {
    pillProps.type = 'button';
    pillProps.onClick = onClick;
  }

  return h(
    'span',
    { className: 'dsh-balance-seat' },
    h(interactive ? 'button' : 'span', pillProps, h(WalletIcon), h('span', { className: 'dsh-balance-amount' }, text)),
  );
}

/**
 * The sidebar footer renders one row shared with the shipped Plugins launcher.
 * The rail (56px) cannot host a second action beside it, so the balance only
 * renders while the sidebar is wide; the cached query survives the collapse.
 */
function BalanceSlot(props) {
  const { wide, clientCtx, queryClient } = props;
  if (!wide) return null;
  return h(
    QueryClientProvider,
    { client: queryClient },
    h(BalanceIndicator, { ...props, clientCtx }),
  );
}

export const inject = ['slots', 'locale'];

export function apply(ctx) {
  const queryClient = new QueryClient({
    // The query owns its polling and refetch behavior; the client only stops
    // React Query's default exponential retry from delaying the honest
    // failure state.
    defaultOptions: { queries: { retry: false } },
  });
  const Balance = (props) => h(BalanceSlot, { ...props, clientCtx: ctx, queryClient });

  ctx.effect(() => ensureStyles(), 'deepseek-balance: styles');
  ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'deepseek-balance: en locale');
  ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'deepseek-balance: zh locale');
  ctx.effect(
    () => () => {
      // Drops cached balances and stops every observer's poll timer on dispose.
      queryClient.clear();
    },
    'deepseek-balance: query cache',
  );
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'deepseek-balance',
            // The shipped Plugins launcher claims the full row width, so the
            // compact balance sits before it instead of after it.
            order: -1,
            locale: NS,
          },
          Balance,
        ),
      ),
    'deepseek-balance: sidebar footer',
  );
}
