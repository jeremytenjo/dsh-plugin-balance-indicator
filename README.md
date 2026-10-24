# DeepSeek Balance for DeepSeek Harness

Shows how much DeepSeek Platform balance you have left, right beside the session stats in the DeepSeek Harness composer.

The pill reads `¥12.34` / `$12.34` from your signed-in DeepSeek account, refreshes every 60 seconds and when the window regains focus, and opens [platform.deepseek.com/usage](https://platform.deepseek.com/usage) when clicked. Bonus credit, per-currency breakdown, and the last refresh time appear on hover.

## Features

- **Remaining balance at a glance** in the composer dock, next to turns, tokens, cache hit, and context usage.
- **Bonus credit separate from paid balance**, listed in the tooltip instead of being silently added.
- **Live enough**: refreshes on mount, every 60 seconds, and on window focus; the Host coalesces requests with a 20-second cache.
- **Click through to usage**: opens the Platform usage page from the account's own `usageUrl`.
- **Honest states**: `Sign in` when no DeepSeek account is connected, `Balance unavailable` when the query fails (click to retry), and no fake zero balance.
- **English and Chinese** UI, following the Harness language setting.
- **No secrets in the browser**: the route returns wallet amounts and links only.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` (the version this plugin was built against).
- A DeepSeek account signed in through Harness **Settings → Account**. The balance comes from the Platform account session; an API-key-only setup has no balance to read.
- Network access from the Harness Host to `platform.deepseek.com`.

## Install

```bash
git clone https://github.com/jeremytenjo/deepseek-plugin-deepseek-balance-indicator.git
dsh plugin --profile desktop add ./deepseek-plugin-deepseek-balance-indicator
```

Restart the Host or reload the page, then start or open a session. The pill appears in the status row above the composer. Replace `desktop` with the profile name shown by `dsh --profile <name> --dump-config`.

Manual installation is also possible: add the package directory to the profile's `dependencies` as a `link:`, add it to `dsh.profile.bundles`, and run the profile's package install. Prefer the plugin command; it owns those files.

## Usage

| State | Pill | Click |
| --- | --- | --- |
| Signed in, balance loaded | `¥12.34` | Opens the Platform usage page |
| Balance with bonus credit | `¥12.34` (hover for bonus lines) | Opens the Platform usage page |
| Not signed in | `Sign in` | — |
| Query failed | `Balance unavailable` | Retries |
| First load | `Balance…` | — |

Hovering shows every wallet currency, bonus wallets with a positive balance, the last successful refresh time, and the click hint.

The pill uses the same typography, spacing, and theme tokens as the built-in stat pills, so it inherits light and dark themes without configuration.

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

`client.js` is the browser half. It registers a lazy factory with the package name, adds a `conversation.composer.dock` entry with order `2` (after the built-in activity and usage pills), and registers its English and Chinese strings through the client locale service. There is no build step and no runtime dependency.

## Configuration

None. The Platform origin belongs to the Harness account provider; this plugin follows it rather than hard-coding an API host. The usage fallback is `https://platform.deepseek.com/usage` and is used only if the account supplies no link.

## Development

```bash
node --check index.js
node --check client.js
```

The package is plain ESM plus a hand-written client bundle, so editing a file and reloading the plugin (Settings → Plugins → disable/enable) or restarting the Host is enough. The locale metadata in `locale/*.json` supplies the Plugin Manager title, description, and icon.

Files:

- `index.js` — Host route, cache, account calls, origin checks.
- `client.js` — composer pill, polling, formatting, tooltip, locale dictionaries.
- `cordis.patch.yml` — inserts the `deepseek-balance-indicator` row.
- `locale/en.json`, `locale/zh.json` — Plugin Manager metadata.
- `icon.svg` — original wallet icon.

## Security and privacy

The balance is read through the existing Harness account session. This plugin adds no credential storage, no cookies, no analytics, and no third-party requests; the browser talks only to its own loopback Harness origin. Amounts and currency codes leave the Host, but account identity, profile, token, and masked contact details do not.

## Limitations

- The account session is required; API-key-only sessions show `Sign in`.
- Only the Platform wallet summary is shown. Per-model spend and request history live on the usage page.
- With multiple currencies, the pill shows the currency matching the UI language (`CNY` for Chinese, `USD` otherwise) and lists the rest in the tooltip.
- Refresh is intentionally slow to be gentle on the Platform API; use the click-through for an exact current view.
- The pill appears in the composer dock for an active session, alongside the same stats row the built-in pills use.

## License

MIT © 2026 Jeremy Tenjo
