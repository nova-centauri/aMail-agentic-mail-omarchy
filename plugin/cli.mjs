// One-shot commands for the Omarchy plugin. The QML panel spawns these for
// anything that needs a round-trip beyond the state file (reading a thread,
// acting on a conversation). Output is JSON on stdout; errors are JSON too
// with a non-zero exit so the panel can show them.
import fs from 'node:fs';
import {
  ApiError, CONFIG_FILE, DEFAULT_CONFIG, STATE_FILE, TOKEN_FILE, compactAccount, createApi,
  loadConfig, loadToken, pokeDaemon, readJson, saveConfig, saveToken,
} from './lib.mjs';

const [command, ...rest] = process.argv.slice(2);

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
      if (!id || !ACTIONS[action]) fail(`usage: action <conversationId> <${Object.keys(ACTIONS).join('|')}> [--by name] [--until iso]`, 2);
      const { client, config } = api();
      const result = await ACTIONS[action](client, encodeURIComponent(id), opt('by', config.agentName), opt('until'));
      pokeDaemon();
      out({ ok: true, action, id, remoteSync: result?.message?.remoteSync || null });
      return;
    }
    case 'read-all': {
      // Mark every unread inbox conversation read. Pages through the server's
      // own is:unread view (not just the panel's window) and fans the POSTs
      // out with bounded concurrency; each one also updates IMAP server-side.
      const { client } = api();
      const accountId = opt('account', '');
      const ids = [];
      for (let page = 1; page <= 10; page += 1) {
        const payload = await client.get(`/api/messages?folder=inbox&q=${encodeURIComponent('is:unread')}&pageSize=200&page=${page}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`);
        const batch = (payload.messages || []).filter((conversation) => !conversation.isRead).map((conversation) => conversation.id);
        ids.push(...batch);
        if ((payload.messages || []).length < 200) break;
      }
      let marked = 0;
      let failed = 0;
      const queue = [...new Set(ids)];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift();
          try {
            await client.post(`/api/messages/${encodeURIComponent(id)}/read`, { read: true }, { timeout: 60_000 });
            marked += 1;
          } catch {
            failed += 1;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, queue.length || 1) }, worker));
      pokeDaemon();
      out({ ok: failed === 0, marked, failed, total: ids.length });
      return;
    }
    case 'list': {
      const { client } = api();
      const q = opt('q', '');
      const folder = opt('folder', 'inbox');
      const payload = await client.get(`/api/messages?folder=${encodeURIComponent(folder)}&pageSize=${Number(opt('limit', 50))}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
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
      const config = loadConfig();
      const current = DEFAULT_CONFIG[key];
      config[key] = typeof current === 'boolean' ? ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
        : typeof current === 'number' ? Number(value)
          : String(value);
      saveConfig(config);
      out({ ok: true, key, value: config[key] });
      return;
    }
    case 'connect': {
      // connect <url> [--mode client|server] ; token from AMAIL_ACCESS_TOKEN, --token-stdin, or --token
      const url = String(positional(0) || '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) fail('usage: connect <https://mail.example.com> [--mode client|server] [--token-stdin]', 2);
      let token = process.env.AMAIL_ACCESS_TOKEN || opt('token') || '';
      if (rest.includes('--token-stdin')) token = fs.readFileSync(0, 'utf8').trim();
      if (!token) token = loadToken({ ...loadConfig(), token: undefined });
      if (!token) fail('No token given. Provide it on stdin with --token-stdin, or set AMAIL_ACCESS_TOKEN.', 2);
      const client = createApi({ url, token });
      const health = await client.get('/api/health', { timeout: 15_000 });
      const session = await client.get('/api/session', { timeout: 15_000 });
      if (session.protected && !session.authenticated) fail('aMail rejected that access token.', 4);
      const accounts = await client.get('/api/accounts', { timeout: 15_000 });
      const config = loadConfig();
      config.mode = opt('mode', config.mode || 'client');
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
      fail('usage: cli.mjs <thread|action|read-all|list|accounts|health|sync|refresh|state|config|set|connect|mcp-config> …', 2);
  }
}

main().catch((error) => {
  const status = error instanceof ApiError ? error.status : null;
  fail(String(error?.message || error), status === 401 ? 4 : 1, status ? { status } : {});
});
