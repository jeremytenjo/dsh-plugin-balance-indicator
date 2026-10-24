# DeepSeek Balance for DeepSeek Harness

Shows how much DeepSeek Platform balance you have left, in the left sidebar footer just above the account row.

The badge reads `¥12.34` / `$12.34` from your signed-in DeepSeek account, refreshes every 60 seconds and when the window regains focus, and opens [platform.deepseek.com/usage](https://platform.deepseek.com/usage) when clicked. The refresh button beside the amount forces an immediate read. Bonus credit, per-currency breakdown, and the last refresh time appear on hover.

## Features

- **Remaining balance at a glance** at the bottom of the left sidebar, beside the account and Plugins controls.
- **Bonus credit separate from paid balance**, listed in the tooltip instead of being silently added.
- **Live enough**: one [TanStack Query](https://tanstack.com/query) cache entry refreshes on mount, every 60 seconds, and when the window regains focus or the network reconnects; the Host coalesces requests with a 20-second cache.
- **Manual refresh**: the refresh button beside the amount bypasses the Host cache, spins while the read runs, and never opens the usage page by mistake.
- **Click through to usage**: opens the Platform usage page from the account's own `usageUrl`.
- **Honest states**: `Sign in` when no DeepSeek account is connected, `Unavailable` when the query fails (click to retry), and no fake zero balance.
- **English and Chinese** UI, following the Harness language setting.
- **No secrets in the browser**: the route returns wallet amounts and links only.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` (the version this plugin was built against).
- A DeepSeek account signed in through Harness **Settings → Account**. The balance comes from the Platform account session; an API-key-only setup has no balance to read.
- Network access from the Harness Host to `platform.deepseek.com`.

## Install

```bash
git clone https://github.com/jeremytenjo/dsh-plugin-balance-indicator.git
dsh plugin --profile desktop add ./dsh-plugin-balance-indicator
```

Restart the Host or reload the page, then start or open a session. The badge appears at the bottom of the left sidebar, above the account row. Replace `desktop` with the profile name shown by `dsh --profile <name> --dump-config`.

Manual installation is also possible: add the package directory to the profile's `dependencies` as a `link:`, add it to `dsh.profile.bundles`, and run the profile's package install. Prefer the plugin command; it owns those files.

## Usage

| State | Footer badge | Badge click |
| --- | --- | --- |
| Signed in, balance loaded | `¥12.34` | Opens the Platform usage page |
| Balance with bonus credit | `¥12.34` (hover for bonus lines) | Opens the Platform usage page |
| Not signed in | `Sign in` | — |
| Query failed | `Unavailable` | Retries |
| First load | `Balance…` | — |

The refresh button sits directly beside the amount and works in every state. It asks the Host for a forced read (`refresh=1`, bypassing the 20-second cache), spins while that read runs, and changes its label from “Refresh balance” to “Refreshing balance…” for screen readers. If a poll is already in flight, a refresh click cancels it and restarts with the forced read, so the button never returns a stale cached amount.

Hovering the badge shows every wallet currency, bonus wallets with a positive balance, the last successful refresh time, and the click hint.

The badge uses the sidebar footer's own 42px action row, radius, and theme tokens, so it inherits light and dark themes without configuration. The sidebar footer is a single row shared with the shipped Plugins launcher: the balance and its refresh button take only their content width and sit first, and they stay hidden while the sidebar is collapsed to the 56px rail (the cached balance reappears immediately on expand).

## How it works

```
client.js  ── GET /__dsh/deepseek-balance ──▶  index.js
                                               │
                                               ├─ ctx.deepseekAccount.getState()
                                               └─ ctx.deepseekAccount.getBalance(client)
                                                       │
                                                       ▼
                                          platform.deepseek.com
```

`index.js` is the Host half. It registers one exact loopback route and calls the Harness account service, which already owns the Platform credential and the `/api/v0/users/get_user_summary` query. The plugin never reads the credential store, never logs a token, and returns only:

```json
{
  "ok": true,
  "status": "ready",
  "wallets": [{ "currency": "CNY", "balance": "12.34" }],
  "bonusWallets": [{ "currency": "CNY", "balance": "2.00" }],
  "links": {
    "usageUrl": "https://platform.deepseek.com/usage",
    "topUpUrl": "https://platform.deepseek.com/top_up"
  },
  "fetchedAt": 1790000000000
}
```

The route accepts loopback requests only, rejects a foreign `Origin` and cross-site fetches, sends `cache-control: no-store`, and caps the wallet list and string lengths. Account query failures are not cached, so a retry or the next poll recovers; successful reads are cached for 20 seconds to coalesce multiple windows.

`client.js` is the browser half. It registers a lazy factory with the package name, adds a `sidebar.footer.action` entry with order `-1` (before the shipped Plugins launcher), and registers its English and Chinese strings through the client locale service. The slot passes the sidebar's `wide` flag: the badge renders only while the sidebar is expanded, because the collapsed 56px rail already holds the Plugins launcher.

The badge's state lives in one TanStack Query entry keyed by language and timezone, with the route response as its data:

- `staleTime: 20s` matches the Host cache, so a focus refetch only asks again once that cache could have moved.
- `refetchInterval: 60s` polls while the window is visible; `refetchOnWindowFocus` and `refetchOnReconnect` cover the gaps.
- A click on the failure state calls `refetch()` with the route's `refresh=1` flag; the query's own retry loop is disabled so a failure is reported immediately instead of after backoff.
- The refresh button sets the same force flag and calls `refetch()`. It is not disabled while fetching, so keyboard focus is never dropped; instead the icon spins, the accessible label changes, and the 60-second interval restarts after the read.
- A response whose Host query failed (`status: "failed"`) is cached as data, not as an error, so the failed state appears immediately and the 60-second poll recovers on its own. A network error after a successful load keeps the last known amount visible instead of replacing it.
- The `QueryClient` is created per enabled plugin instance, provided to the badge's subtree, and cleared in the effect cleanup when the plugin is disabled. The cached entry survives collapsing the sidebar, so expanding again shows the last amount while any stale fetch runs.

`src/client.js` is the editable source. `scripts/build-client.mjs` bundles it with esbuild into `client.js`, keeping React external so the page's shared module table supplies it and TanStack Query bundled in, since the table does not provide it. Do not edit `client.js` directly.

## Configuration

None. The Platform origin belongs to the Harness account provider; this plugin follows it rather than hard-coding an API host. The usage fallback is `https://platform.deepseek.com/usage` and is used only if the account supplies no link.

## Development

```bash
pnpm install
pnpm run build
node --check index.js
node --check client.js
```

`pnpm install` brings the build toolchain. esbuild is build-only; TanStack Query is compiled into `client.js` rather than loaded as a separate page module. `pnpm run build` bundles `src/client.js` into the module-loader artifact `client.js`. Editing the Host half or `src/client.js` and reloading the plugin (Settings → Plugins → disable/enable) or restarting the Host is enough after a build. The locale metadata in `locale/*.json` supplies the Plugin Manager title, description, and icon.

Files:

- `index.js` — Host route, cache, account calls, origin checks.
- `src/client.js` — sidebar footer badge source: query definition, formatting, refresh control, tooltip, locale dictionaries.
- `scripts/build-client.mjs` — esbuild bundle wrapped in the `__ModuleLoader__` factory.
- `client.js` — generated browser bundle; do not edit.
- `cordis.patch.yml` — inserts the `deepseek-balance-indicator` row.
- `locale/en.json`, `locale/zh.json` — Plugin Manager metadata.
- `icon.svg` — original wallet icon.

## Security and privacy

The balance is read through the existing Harness account session. This plugin adds no credential storage, no cookies, no analytics, and no third-party requests; the browser talks only to its own loopback Harness origin. Amounts and currency codes leave the Host, but account identity, profile, token, and masked contact details do not.

## Limitations

- The account session is required; API-key-only sessions show `Sign in`.
- Only the Platform wallet summary is shown. Per-model spend and request history live on the usage page.
- With multiple currencies, the badge shows the currency matching the UI language (`CNY` for Chinese, `USD` otherwise) and lists the rest in the tooltip.
- Background polling is intentionally slow to be gentle on the Platform API; use the refresh button (or the usage page) for an exact current read.
- The badge lives in the sidebar footer and is hidden while the sidebar is collapsed to the rail; it needs an expanded sidebar, not an active session.
- The footer is one row shared with the Plugins launcher, so the launcher's right-aligned run count can be clipped by the badge's width in a narrow sidebar.

## License

MIT © 2026 Jeremy Tenjo
