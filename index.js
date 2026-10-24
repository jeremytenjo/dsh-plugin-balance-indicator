/**
 * Host half of the DeepSeek balance indicator.
 *
 * The browser reads one exact loopback route. The route asks the Harness
 * account service for the signed-in DeepSeek Platform wallet balances and
 * never returns credentials, tokens, or unmasked account data.
 */

const ROUTE = '/__dsh/deepseek-balance';
const CACHE_TTL_MS = 20_000;
const MAX_WALLETS = 8;
const MAX_AMOUNT_LENGTH = 64;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/;

export const inject = ['webServer', 'deepseekAccount'];

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

export function apply(ctx) {
  let cache = null;
  let pending = null;
  const version = resolveVersion();

  async function readBalance(client, force) {
    if (!force && cache !== null && Date.now() - cache.at < CACHE_TTL_MS) {
      return cache.value;
    }
    if (pending !== null) return pending;
    pending = (async () => {
      try {
        const state = await ctx.deepseekAccount.getState();
        const links = readLinks(state?.links);
        if (!state || state.status !== 'credential-stored') {
          const value = { status: 'signed-out', links };
          cache = { at: Date.now(), value };
          return value;
        }
        const detail = await ctx.deepseekAccount.getBalance(client);
        if (detail === null) {
          const value = { status: 'signed-out', links };
          cache = { at: Date.now(), value };
          return value;
        }
        if (detail.status !== 'ready') {
          // A failed query is not cached so the next poll or click can recover.
          return { status: 'failed', links };
        }
        const value = {
          status: 'ready',
          wallets: normalizeWallets(detail.value),
          bonusWallets: normalizeWallets(detail.bonusWallets),
          links,
          fetchedAt: Date.now(),
        };
        cache = { at: Date.now(), value };
        return value;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => handleRequest(ctx, req, res, readBalance, version),
      }),
    'deepseek-balance-indicator: route',
  );
}

async function handleRequest(ctx, req, res, readBalance, version) {
  try {
    if (req.method !== 'GET') {
      throw new RequestError(405, 'Only GET is supported.');
    }
    assertSameOrigin(ctx, req);
    const url = new URL(req.url ?? ROUTE, 'http://localhost');
    const client = {
      version: sanitizeVersion(url.searchParams.get('v')) || (await version) || '0.0.0',
      locale: sanitizeLocale(url.searchParams.get('locale')),
      timezoneOffsetSeconds: sanitizeOffset(url.searchParams.get('tz')),
    };
    const force = url.searchParams.get('refresh') === '1';
    const balance = await readBalance(client, force);
    send(res, 200, {
      ok: true,
      status: balance.status,
      wallets: balance.wallets ?? [],
      bonusWallets: balance.bonusWallets ?? [],
      links: balance.links,
      fetchedAt: balance.status === 'ready' ? balance.fetchedAt : null,
    });
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof RequestError) {
      send(res, error.status, { ok: false, error: error.message });
      return;
    }
    console.error('[deepseek-balance-indicator] could not read the account balance', error);
    send(res, 503, { ok: false, error: 'Could not read the DeepSeek balance.' });
  }
}

/**
 * Ask Electron for the running app version; the Platform client header reports
 * it, and the browser normally supplies the same value from its boot manifest.
 * @returns version string, or an empty string outside Electron.
 */
async function resolveVersion() {
  try {
    const electron = await import('electron');
    const app = electron?.app ?? electron?.default?.app;
    if (typeof app?.getVersion === 'function') {
      const value = app.getVersion();
      if (typeof value === 'string' && VERSION_PATTERN.test(value)) return value;
    }
  } catch {
    // Not an Electron host; the browser value or the fallback applies.
  }
  return '';
}

function assertSameOrigin(ctx, req) {
  const address = req.socket?.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    throw new RequestError(403, 'This action is only available over the local loopback connection.');
  }
  let expected;
  try {
    expected = ctx.webServer.getOrigin();
  } catch {
    throw new RequestError(503, 'The web server is not ready yet.');
  }
  const origin = req.headers.origin;
  if (origin && origin !== expected) {
    throw new RequestError(403, 'This request came from a different origin.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new RequestError(403, 'Cross-site requests are not allowed.');
  }
}

function readLinks(links) {
  return {
    usageUrl: readLink(links?.usageUrl),
    topUpUrl: readLink(links?.topUpUrl),
  };
}

function readLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeWallets(list) {
  if (!Array.isArray(list)) return [];
  const wallets = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.currency !== 'string' || entry.currency.length > 8) continue;
    if (typeof entry.balance !== 'string' || entry.balance.length > MAX_AMOUNT_LENGTH) continue;
    wallets.push({ currency: entry.currency, balance: entry.balance });
    if (wallets.length >= MAX_WALLETS) break;
  }
  return wallets;
}

function sanitizeVersion(value) {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : '';
}

function sanitizeLocale(value) {
  return typeof value === 'string' && value.length <= 32 && LOCALE_PATTERN.test(value)
    ? value
    : 'en';
}

function sanitizeOffset(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || Math.abs(seconds) > 86_400) return 0;
  return seconds;
}

function send(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
