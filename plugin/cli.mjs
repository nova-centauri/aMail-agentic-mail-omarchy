// One-shot commands for the Omarchy plugin. The QML panel spawns these for
// anything that needs a round-trip beyond the state file (reading a thread,
// acting on a conversation). Output is JSON on stdout; errors are JSON too
// with a non-zero exit so the panel can show them.
import fs from 'node:fs';
import {
  ApiError, CONFIG_FILE, DEFAULT_CONFIG, MODES, NUMERIC_LIMITS, STATE_FILE, TOKEN_FILE, clampInt, coerceSetting,
  compactAccount, createApi, isHttpUrl, isSafeId, loadConfig, loadToken, normalizeUrl, pokeDaemon, readJson,
  saveConfig, saveToken, signalDaemon,
} from './lib.mjs';

const [command, ...rest] = process.argv.slice(2);
// A consumer that stops reading (the panel closing a job, `| head`) must not
// turn into a crash dump; just stop.
process.stdout.on('error', (error) => { if (error?.code === 'EPIPE') process.exit(0); });

function out(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(message, code = 1, extra = {}) {
  out({ ok: false, error: message, ...extra });
  process.exit(code);
}

function opt(name, fallback = null) {
  const index = rest.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return rest[index + 1] ?? fallback;
}

function positional(index) {
  const values = rest.filter((value, i) => !value.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--')));
  return values[index];
}

// Ids arrive from the panel (which got them from the daemon's state file, which
// got them from the server) and from IPC callers. They end up in URL paths and
// notification hints, so anything outside the expected alphabet is refused.
function safeId(value, what = 'id') {
  if (!isSafeId(value)) fail(`invalid ${what}`, 2);
  return value;
}

function api() {
  const config = loadConfig();
  const token = loadToken(config);
  if (!config.url) fail('aMail is not configured. Run: amail-plugin connect <url>', 2);
  if (!token) fail('No access token. Run: amail-plugin connect <url>', 2);
  return { config, client: createApi({ url: config.url, token }) };
}

const textOf = (message, limit = 6000) => {
  const text = String(message.textBody || '').trim()
    || String(message.htmlBody || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
};

const ACTIONS = {
  read: (client, id) => client.post(`/api/messages/${id}/read`, { read: true }),
  unread: (client, id) => client.post(`/api/messages/${id}/unread`, {}),
  star: (client, id) => client.post(`/api/messages/${id}/star`, { star: true }),
  unstar: (client, id) => client.post(`/api/messages/${id}/star`, { star: false }),
  archive: (client, id) => client.post(`/api/messages/${id}/archive`, { archived: true }),
  unarchive: (client, id) => client.post(`/api/messages/${id}/archive`, { archived: false }),
  trash: (client, id) => client.post(`/api/messages/${id}/trash`, { trashed: true }),
  spam: (client, id) => client.post(`/api/messages/${id}/spam`, { spam: true }),
  analyzed: (client, id, by) => client.post(`/api/messages/${id}/analyzed`, { analyzed: true, by }),
  unanalyzed: (client, id) => client.post(`/api/messages/${id}/unanalyzed`, {}),
  snooze: (client, id, _by, until) => client.post(`/api/messages/${id}/snooze`, until ? { until } : {}),
};

async function main() {
  switch (command) {
    case 'thread': {
      const id = positional(0);
      if (!id) fail('usage: thread <conversationId>', 2);
      safeId(id, 'conversation id');
      const { client, config } = api();
      const payload = await client.get(`/api/threads/${encodeURIComponent(id)}`);
      const messages = (payload.messages || []).map((message) => ({
        id: message.id,
        from: message.from,
        to: message.to || [],
        cc: message.cc || [],
        subject: message.subject,
        sentAt: message.sentAt || message.receivedAt,
        isRead: Boolean(message.isRead),
        isAnalyzed: Boolean(message.isAnalyzed),
        analyzedBy: message.analyzedBy || '',
        isSent: Boolean(message.isSent),
        attachments: (message.attachments || []).map((attachment) => ({ filename: attachment.filename, size: attachment.size })),
        text: textOf(message),
      }));
      if (config.markReadOnOpen && opt('no-read') === null && messages.some((message) => !message.isRead)) {
        client.post(`/api/messages/${encodeURIComponent(id)}/read`, { read: true }).then(() => pokeDaemon()).catch(() => {});
      }
      out({ ok: true, thread: { id: payload.thread?.id || id, subject: payload.thread?.subject || messages.at(-1)?.subject || '', accountId: payload.thread?.accountId || null }, messages });
      return;
    }
    case 'action': {
      const id = positional(0);
      const action = positional(1);
      if (!id || !Object.hasOwn(ACTIONS, action)) fail(`usage: action <conversationId> <${Object.keys(ACTIONS).join('|')}> [--by name] [--until iso]`, 2);
      safeId(id, 'conversation id');
      const { client, config } = api();
      const by = String(opt('by', config.agentName) || config.agentName).slice(0, 64);
      const untilRaw = opt('until');
      const until = untilRaw && Number.isFinite(Date.parse(untilRaw)) ? new Date(Date.parse(untilRaw)).toISOString() : undefined;
      if (untilRaw && !until) fail('--until must be an ISO 8601 date', 2);
      const result = await ACTIONS[action](client, encodeURIComponent(id), by, until);
      pokeDaemon();
      out({ ok: true, action, id, remoteSync: result?.message?.remoteSync || null });
      return;
    }
    case 'read-all': {
      // Mark every unread inbox conversation read as a throttled job.
      //
      // A large inbox means thousands of POSTs, each of which also sets the
      // IMAP flag server-side, so this deliberately runs light: bounded
      // concurrency (default 2), a pacing gap between requests, and an
      // adaptive backoff to one worker when the server gets slow. Progress
      // is streamed as JSON lines so the panel can draw a bar and an ETA:
      //   {"type":"progress","done":n,"total":N,"failed":f,"rate":r,"etaSeconds":s}
      //   {"type":"done",...}
      const { client } = api();
      const accountId = opt('account', '');
      if (accountId) safeId(accountId, 'account id');
      const dryRun = rest.includes('--dry-run');
      const maxConcurrency = clampInt(opt('concurrency', 2), { min: 1, max: 4 }, 2);
      const limit = clampInt(opt('limit', 5000), { min: 1, max: 20_000 }, 5000);
      const paceMs = clampInt(opt('pace', 40), { min: 0, max: 10_000 }, 40);
      const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

      emit({ type: 'start', phase: 'scan' });
      const ids = [];
      for (let page = 1; page <= Math.ceil(limit / 200); page += 1) {
        const payload = await client.get(`/api/messages?folder=inbox&q=${encodeURIComponent('is:unread')}&pageSize=200&page=${page}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`);
        const batch = (payload.messages || []).filter((conversation) => !conversation.isRead).map((conversation) => conversation.id);
        ids.push(...batch);
        emit({ type: 'progress', phase: 'scan', done: 0, total: Math.min(limit, Number(payload.total) || ids.length), scanned: ids.length });
        if ((payload.messages || []).length < 200 || ids.length >= limit) break;
      }
      const queue = [...new Set(ids)].slice(0, limit);
      const total = queue.length;
      let done = 0;
      let failed = 0;
      let concurrency = maxConcurrency;
      let slowStreak = 0;
      const startedAt = Date.now();
      let lastEmit = 0;
      const report = (type = 'progress') => {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = elapsed > 0 ? done / elapsed : 0;
        const remaining = total - done - failed;
        emit({ type, phase: 'mark', done, failed, total, rate: Number(rate.toFixed(2)), etaSeconds: rate > 0 ? Math.round(remaining / rate) : null, concurrency, dryRun });
        lastEmit = Date.now();
      };
      report('start');
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let active = 0;
      const worker = async () => {
        while (queue.length && !stopped) {
          // Adaptive: workers beyond the current allowance park until it grows back.
          if (active >= concurrency) { await sleep(100); continue; }
          active += 1;
          const id = queue.shift();
          const t0 = Date.now();
          try {
            if (!dryRun) await client.post(`/api/messages/${encodeURIComponent(id)}/read`, { read: true }, { timeout: 60_000 });
            else await sleep(15);
            done += 1;
          } catch {
            failed += 1;
          } finally {
            active -= 1;
          }
          const took = Date.now() - t0;
          if (took > 2500) { slowStreak += 1; if (slowStreak >= 3 && concurrency > 1) { concurrency = 1; slowStreak = 0; } }
          else if (took < 800) { slowStreak = 0; if (concurrency < maxConcurrency && (done + failed) % 25 === 0) concurrency += 1; }
          if (Date.now() - lastEmit >= 250) report();
          if (paceMs) await sleep(paceMs);
        }
      };
      let stopped = false;
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; });
      await Promise.all(Array.from({ length: Math.min(maxConcurrency, total || 1) }, worker));
      pokeDaemon();
      report(stopped ? 'cancelled' : 'done');
      if (stopped) process.exit(130);
      return;
    }
    case 'list': {
      const { client } = api();
      const q = String(opt('q', '') || '').slice(0, 512);
      const folder = String(opt('folder', 'inbox') || 'inbox');
      const limit = clampInt(opt('limit', 50), { min: 1, max: 500 }, 50);
      const payload = await client.get(`/api/messages?folder=${encodeURIComponent(folder)}&pageSize=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      out({ ok: true, total: payload.total, folderCounts: payload.folderCounts, messages: payload.messages });
      return;
    }
    case 'accounts': {
      const { client } = api();
      const payload = await client.get('/api/accounts');
      out({ ok: true, accounts: (payload.accounts || []).map(compactAccount) });
      return;
    }
    case 'health': {
      const { client, config } = api();
      const payload = await client.get('/api/health');
      out({ ok: true, url: config.url, mode: config.mode, health: payload });
      return;
    }
    case 'sync': {
      const { client } = api();
      const accountId = positional(0);
      if (accountId) safeId(accountId, 'account id');
      const payload = accountId
        ? await client.post(`/api/accounts/${encodeURIComponent(accountId)}/sync`, {}, { timeout: 10 * 60_000 })
        : await client.post('/api/sync', {}, { timeout: 10 * 60_000 });
      pokeDaemon();
      out({ ok: true, ...payload });
      return;
    }
    case 'refresh': {
      out({ ok: true, poked: pokeDaemon() });
      return;
    }
    case 'restart': {
      // Stop the daemon so the widget brings it back with fresh settings. The
      // pid is verified against /proc before anything is signalled.
      out({ ok: true, stopped: signalDaemon('SIGTERM') });
      return;
    }
    case 'state': {
      const state = readJson(STATE_FILE, null);
      if (!state) fail('daemon has not written state yet', 3);
      const { seen, ...rest } = state;
      out({ ok: true, ...rest });
      return;
    }
    case 'config': {
      const config = loadConfig();
      const token = loadToken(config);
      out({ ok: true, file: CONFIG_FILE, tokenFile: config.tokenFile, tokenPresent: Boolean(token), config: { ...config, token: config.token ? '[set]' : undefined } });
      return;
    }
    case 'set': {
      // set key value  — write one plugin setting.
      const key = positional(0);
      const value = positional(1);
      if (!key || value === undefined || !Object.hasOwn(DEFAULT_CONFIG, key)) fail(`usage: set <${Object.keys(DEFAULT_CONFIG).join('|')}> <value>`, 2);
      // The URL and token file are set by `connect`, which verifies them live.
      if (key === 'url' || key === 'tokenFile') fail(`use: amail-plugin connect <url> to change the ${key}`, 2);
      const coerced = coerceSetting(key, value);
      if (coerced === undefined) {
        const limits = NUMERIC_LIMITS[key];
        fail(limits ? `${key} must be a whole number between ${limits.min} and ${limits.max}` : `invalid value for ${key}`, 2);
      }
      const config = loadConfig();
      config[key] = coerced;
      saveConfig(config);
      out({ ok: true, key, value: config[key] });
      return;
    }
    case 'connect': {
      // connect <url> [--mode client|server] ; token from AMAIL_ACCESS_TOKEN, --token-stdin, or --token
      const url = normalizeUrl(positional(0));
      if (!isHttpUrl(url)) fail('usage: connect <https://mail.example.com> [--mode client|server] [--token-stdin]', 2);
      const mode = opt('mode', null);
      if (mode !== null && !MODES.includes(mode)) fail(`--mode must be one of: ${MODES.join(', ')}`, 2);
      // Tokens are accepted from the environment or stdin. `--token` on the
      // command line would be visible to every process on the machine via ps.
      if (opt('token') !== null) fail('pass the token on stdin (--token-stdin) or in AMAIL_ACCESS_TOKEN, not on the command line', 2);
      let token = process.env.AMAIL_ACCESS_TOKEN || '';
      if (rest.includes('--token-stdin')) token = fs.readFileSync(0, 'utf8').trim();
      if (!token) token = loadToken({ ...loadConfig(), token: undefined });
      if (!token) fail('No token given. Provide it on stdin with --token-stdin, or set AMAIL_ACCESS_TOKEN.', 2);
      if (!/^[\x21-\x7e]{1,1024}$/.test(token)) fail('The access token must be printable ASCII without spaces (it travels in an HTTP header).', 2);
      const client = createApi({ url, token });
      const health = await client.get('/api/health', { timeout: 15_000 });
      const session = await client.get('/api/session', { timeout: 15_000 });
      if (session.protected && !session.authenticated) fail('aMail rejected that access token.', 4);
      const accounts = await client.get('/api/accounts', { timeout: 15_000 });
      const config = loadConfig();
      config.mode = mode || config.mode || 'client';
      config.url = url;
      delete config.token;
      config.tokenFile = TOKEN_FILE;
      saveToken(token);
      saveConfig(config);
      pokeDaemon();
      out({
        ok: true,
        url,
        mode: config.mode,
        accounts: (accounts.accounts || []).length,
        features: health.features || [],
        push: Array.isArray(health.features) && health.features.includes('events'),
        idle: Array.isArray(health.features) && health.features.includes('idle'),
        releaseSha: health.releaseSha || null,
        configFile: CONFIG_FILE,
        tokenFile: TOKEN_FILE,
      });
      return;
    }
    case 'mcp-config': {
      const config = loadConfig();
      if (!config.url) fail('aMail is not configured. Run: amail-plugin connect <url>', 2);
      out({
        mcpServers: {
          amail: {
            url: `${config.url}/mcp`,
            headers: { Authorization: 'Bearer ${env:AMAIL_ACCESS_TOKEN}' },
          },
        },
      });
      return;
    }
    default:
      fail('usage: cli.mjs <thread|action|read-all|list|accounts|health|sync|refresh|restart|state|config|set|connect|mcp-config> …', 2);
  }
}

main().catch((error) => {
  const status = error instanceof ApiError ? error.status : null;
  fail(String(error?.message || error), status === 401 ? 4 : 1, status ? { status } : {});
});
