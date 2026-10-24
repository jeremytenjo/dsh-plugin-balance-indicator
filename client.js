/**
 * Browser half of the DeepSeek balance indicator.
 *
 * Registers one pill in the composer dock beside the session stat pills. It
 * reads the loopback balance route, refreshes on a slow interval and on focus,
 * and links to the Platform usage page.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-balance-indicator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'deepseek-balance-indicator';
    const ROUTE = '/__dsh/deepseek-balance';
    const POLL_MS = 60_000;
    const MIN_REFRESH_MS = 10_000;
    const USAGE_FALLBACK = 'https://platform.deepseek.com/usage';

    const EN = {
      loading: 'Balance…',
      loadingTitle: 'Reading your DeepSeek Platform balance…',
      signedOut: 'Sign in',
      signedOutTitle: 'Sign in to DeepSeek in Settings → Account to see your remaining balance.',
      signedOutAria: 'DeepSeek balance unavailable: not signed in.',
      failed: 'Balance unavailable',
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
.dsh-balance-anchor {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.dsh-balance-pill {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 1px 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
}
.dsh-balance-pill svg {
  flex: none;
  width: 14px;
  height: 14px;
}
button.dsh-balance-pill {
  cursor: pointer;
}
button.dsh-balance-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
button.dsh-balance-pill:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-balance-pill[data-phase='signed-out'],
.dsh-balance-pill[data-phase='loading'] {
  color: var(--dsw-alias-label-caption);
}
.dsh-balance-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
      url.searchParams.set('tz', String(-new Date().getTimezoneOffset() * 60));
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
      const [state, setState] = React.useState({ phase: 'loading', data: null });
      const mounted = React.useRef(true);
      const controller = React.useRef(null);
      const lastFetch = React.useRef(0);
      const fetching = React.useRef(false);

      const load = React.useCallback(
        async (force) => {
          const now = Date.now();
          if (fetching.current && !force) return;
          if (!force && now - lastFetch.current < MIN_REFRESH_MS) return;
          lastFetch.current = now;
          fetching.current = true;
          controller.current?.abort();
          const next = new AbortController();
          controller.current = next;
          try {
            const body = await requestBalance(next.signal, force, clientCtx);
            if (!mounted.current || next.signal.aborted) return;
            const phase =
              body.status === 'ready' || body.status === 'signed-out' ? body.status : 'failed';
            setState({ phase, data: body });
          } catch {
            if (!mounted.current || next.signal.aborted) return;
            setState((previous) =>
              previous.phase === 'ready' ? previous : { phase: 'failed', data: previous.data },
            );
          } finally {
            if (controller.current === next) fetching.current = false;
          }
        },
        [clientCtx],
      );

      React.useEffect(() => {
        mounted.current = true;
        load(true);
        const interval = window.setInterval(() => load(true), POLL_MS);
        const refresh = () => {
          if (document.visibilityState === 'visible') load(false);
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
          mounted.current = false;
          window.clearInterval(interval);
          window.removeEventListener('focus', refresh);
          document.removeEventListener('visibilitychange', refresh);
          controller.current?.abort();
        };
      }, [load]);

      const wallet = primaryWallet(state.data, lang);
      const amount = wallet === null ? null : formatAmount(wallet, lang);
      let text;
      if (state.phase === 'ready') text = amount ?? t('empty');
      else if (state.phase === 'signed-out') text = t('signedOut');
      else if (state.phase === 'failed') text = t('failed');
      else text = t('loading');

      let ariaLabel;
      if (state.phase === 'ready') ariaLabel = t('readyAria', { amount: amount ?? t('empty') });
      else if (state.phase === 'signed-out') ariaLabel = t('signedOutAria');
      else if (state.phase === 'failed') ariaLabel = t('failedAria');
      else ariaLabel = t('loadingTitle');

      const interactive = state.phase === 'ready' || state.phase === 'failed';
      const onClick = () => {
        if (state.phase === 'ready') {
          const usageUrl = state.data?.links?.usageUrl;
          window.open(typeof usageUrl === 'string' && usageUrl !== '' ? usageUrl : USAGE_FALLBACK, '_blank', 'noopener,noreferrer');
          return;
        }
        load(true);
      };

      const pillProps = {
        className: 'dsh-balance-pill',
        'data-phase': state.phase,
        title: tooltip(t, state, lang),
        'aria-label': ariaLabel,
        'data-composer-stat': 'deepseek-balance',
      };
      if (interactive) {
        pillProps.type = 'button';
        pillProps.onClick = onClick;
      }

      return h(
        'span',
        { className: 'dsh-balance-anchor' },
        h(interactive ? 'button' : 'span', pillProps, h(WalletIcon), h('span', { className: 'dsh-balance-label' }, text)),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const Balance = (props) => h(BalanceIndicator, { ...props, clientCtx: ctx });
        ctx.effect(() => ensureStyles(), 'deepseek-balance: styles');
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'deepseek-balance: en locale');
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'deepseek-balance: zh locale');
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.composer.dock', () =>
              ctx.slots.register(
                {
                  name: 'conversation.composer.dock',
                  id: 'deepseek-balance',
                  order: 2,
                  locale: NS,
                },
                Balance,
              ),
            ),
          'deepseek-balance: composer dock',
        );
      },
    };
  },
});
