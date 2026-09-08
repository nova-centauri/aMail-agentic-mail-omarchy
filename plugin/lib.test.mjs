// Guards for the plugin runtime's trust boundaries: what it accepts from
// plugin.json, from the server, and from IPC callers. Run with `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// lib.mjs resolves its directories at import time from these variables.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'amail-plugin-test-'));
process.env.AMAIL_PLUGIN_CONFIG_DIR = path.join(scratch, 'config');
process.env.AMAIL_PLUGIN_STATE_DIR = path.join(scratch, 'state');
delete process.env.AMAIL_ACCESS_TOKEN;

const lib = await import('./lib.mjs');
const {
  DEFAULT_CONFIG, MAX_RESPONSE_BYTES, NUMERIC_LIMITS, coerceSetting, compactAccount, compactConversation,
  createApi, isDaemonPid, isHttpUrl, isSafeId, loadConfig, readBodyCapped, safeColor, sanitizeConfig, saveConfig,
  signalDaemon,
} = lib;

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

function runCli(args, { input, env = {} } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let json = null;
  try { json = JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch { /* not JSON */ }
  return { ...result, json };
}

test('isSafeId accepts aMail-style ids and rejects shell/URL metacharacters', () => {
  for (const good of ['a', 'demo-thread-12', '3f1c2b0e-9a5d-4d7e-8f2a-0b1c2d3e4f5a', 'msg:abc@example.com', 'x'.repeat(255)]) {
    assert.equal(isSafeId(good), true, good);
  }
  for (const bad of ['', ' ', '-flag', '--dry-run', 'a b', 'a;rm -rf ~', '../x', 'a/b', 'a?b=c', 'a#b', '$(id)', '`id`', 'a\nb', 'x'.repeat(256), 42, null, undefined]) {
    assert.equal(isSafeId(bad), false, String(bad));
  }
});

test('safeColor only lets hex colours through to the QML side', () => {
  assert.equal(safeColor('#5b8def'), '#5b8def');
  assert.equal(safeColor('#ABC'), '#ABC');
  assert.equal(safeColor('#12345678'), '#12345678');
  for (const bad of ['red', 'javascript:alert(1)', '#12', '#ggg', '', null, 5]) {
    assert.equal(safeColor(bad), '#5b8def', String(bad));
  }
});

test('isHttpUrl accepts http(s) origins only and refuses embedded credentials', () => {
  assert.equal(isHttpUrl('https://mail.example.com'), true);
  assert.equal(isHttpUrl('http://127.0.0.1:3080'), true);
  for (const bad of ['ftp://x', 'file:///etc/passwd', 'javascript:alert(1)', 'mail.example.com', 'https://user:pw@mail.example.com', '', 'https://']) {
    assert.equal(isHttpUrl(bad), false, bad);
  }
});

test('sanitizeConfig snaps bad values back to defaults and drops unknown keys', () => {
  const config = sanitizeConfig({
    mode: 'root',
    badge: 'everything',
    url: 'javascript:alert(1)',
    listSize: '60&folder=trash',
    pollSeconds: 'NaN',
    syncSeconds: -5,
    safetyPollSeconds: 1e12,
    toasts: 'no',
    markReadOnOpen: 'yes',
    agentName: 'x'.repeat(200),
    tokenFile: '',
    evil: true,
  });
  assert.equal(config.mode, 'client');
  assert.equal(config.badge, 'both');
  assert.equal(config.url, '');
  assert.equal(config.listSize, DEFAULT_CONFIG.listSize);
  assert.equal(config.pollSeconds, DEFAULT_CONFIG.pollSeconds);
  assert.equal(config.syncSeconds, NUMERIC_LIMITS.syncSeconds.min);
  assert.equal(config.safetyPollSeconds, NUMERIC_LIMITS.safetyPollSeconds.max);
  assert.equal(config.toasts, false);
  assert.equal(config.markReadOnOpen, true);
  assert.equal(config.agentName, 'x'.repeat(64));
  assert.equal(config.tokenFile, DEFAULT_CONFIG.tokenFile);
  assert.equal('evil' in config, false);
});

test('sanitizeConfig keeps good values, including a trailing-slash-stripped URL', () => {
  const config = sanitizeConfig({ mode: 'server', badge: 'unread', url: 'https://mail.example.com///', listSize: '120', pollSeconds: 7 });
  assert.deepEqual([config.mode, config.badge, config.url, config.listSize, config.pollSeconds], ['server', 'unread', 'https://mail.example.com', 120, 7]);
});

test('coerceSetting reports unacceptable values instead of guessing', () => {
  assert.equal(coerceSetting('badge', 'nope'), undefined);
  assert.equal(coerceSetting('mode', 'client'), 'client');
  assert.equal(coerceSetting('pollSeconds', 'fast'), undefined);
  assert.equal(coerceSetting('pollSeconds', '1'), NUMERIC_LIMITS.pollSeconds.min);
  assert.equal(coerceSetting('agentName', 'triage; rm -rf /'), undefined);
  assert.equal(coerceSetting('agentName', 'triage-agent'), 'triage-agent');
  assert.equal(coerceSetting('nonsense', 1), undefined);
});

test('saveConfig/loadConfig round-trip through the sanitizer', () => {
  saveConfig({ ...DEFAULT_CONFIG, badge: 'unanalyzed', pollSeconds: 0, garbage: 'x' });
  const loaded = loadConfig();
  assert.equal(loaded.badge, 'unanalyzed');
  assert.equal(loaded.pollSeconds, NUMERIC_LIMITS.pollSeconds.min);
  assert.equal('garbage' in loaded, false);
  const mode = fs.statSync(path.join(process.env.AMAIL_PLUGIN_CONFIG_DIR, 'plugin.json')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('compact* sanitise colours coming from the server', () => {
  const accounts = new Map([['a1', compactAccount({ id: 'a1', email: 'me@example.com', color: 'url(javascript:1)' })]]);
  const conversation = compactConversation({ id: 'c1', accountId: 'a1', from: {}, snippet: 'x'.repeat(500) }, accounts);
  assert.equal(conversation.accountColor, '#5b8def');
  assert.equal(accounts.get('a1').color, '#5b8def');
  assert.equal(conversation.snippet.length, 160);
});

test('readBodyCapped refuses oversized bodies, declared or streamed', async () => {
  const declared = new Response('x', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } });
  await assert.rejects(readBodyCapped(declared), /too large/);
  const chunk = new Uint8Array(1024 * 1024);
  const streamed = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
  }));
  await assert.rejects(readBodyCapped(streamed, 3 * 1024 * 1024), /too large/);
  assert.equal(await readBodyCapped(new Response('hello')), 'hello');
});

test('createApi refuses non-http URLs and does not follow redirects with the token', async () => {
  assert.throws(() => createApi({ url: 'file:///etc/passwd', token: 't' }), /http/);
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url === '/api/health') {
      response.writeHead(302, { Location: 'http://attacker.invalid/steal' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = createApi({ url: base, token: 'secret-token' });
    await assert.rejects(api.get('/api/health'), /redirects to http:\/\/attacker\.invalid\/steal/);
    assert.deepEqual(await api.get('/api/accounts'), { ok: true });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].authorization, 'Bearer secret-token');
  } finally {
    server.close();
  }
});

test('daemon signalling verifies the pid belongs to the daemon before sending anything', () => {
  // Our own pid is alive and owned by us, but it is the test runner, not daemon.mjs.
  assert.equal(isDaemonPid(process.pid), false);
  assert.equal(isDaemonPid(1), false);
  assert.equal(isDaemonPid(-1), false);
  assert.equal(isDaemonPid(NaN), false);
  fs.mkdirSync(process.env.AMAIL_PLUGIN_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.AMAIL_PLUGIN_STATE_DIR, 'daemon.pid'), `${process.pid}\n`);
  assert.equal(signalDaemon('SIGUSR1'), false);
  fs.writeFileSync(path.join(process.env.AMAIL_PLUGIN_STATE_DIR, 'daemon.pid'), '-1\n');
  assert.equal(signalDaemon('SIGTERM'), false);
});

test('cli refuses ids and options it cannot vouch for before touching the network', () => {
  saveConfig({ ...DEFAULT_CONFIG, url: 'http://127.0.0.1:9' });
  fs.writeFileSync(path.join(process.env.AMAIL_PLUGIN_CONFIG_DIR, 'token'), 'tok\n', { mode: 0o600 });
  for (const args of [
    ['thread', '../../etc/passwd'],
    ['thread', '--dry-run'],
    ['action', 'a b', 'read'],
    ['action', 'ok-id', 'delete-everything'],
    ['action', 'ok-id', '__proto__'],
    ['sync', 'a;b'],
    ['read-all', '--account', '$(id)'],
    ['set', 'badge', 'everything'],
    ['set', 'pollSeconds', 'fast'],
    ['set', 'url', 'http://elsewhere.example'],
    ['set', 'notAKey', '1'],
    ['connect', 'ftp://mail.example.com'],
    ['connect', 'https://mail.example.com', '--mode', 'root'],
    ['connect', 'https://mail.example.com', '--token', 'on-the-command-line'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 2, `${args.join(' ')} -> ${result.stdout}`);
    assert.equal(result.json?.ok, false, args.join(' '));
  }
});

test('cli set clamps numbers and stores enums', () => {
  saveConfig({ ...DEFAULT_CONFIG });
  assert.deepEqual(runCli(['set', 'pollSeconds', '1']).json, { ok: true, key: 'pollSeconds', value: NUMERIC_LIMITS.pollSeconds.min });
  assert.deepEqual(runCli(['set', 'badge', 'unread']).json, { ok: true, key: 'badge', value: 'unread' });
  assert.deepEqual(runCli(['set', 'toasts', 'off']).json, { ok: true, key: 'toasts', value: false });
  const loaded = loadConfig();
  assert.equal(loaded.badge, 'unread');
  assert.equal(loaded.toasts, false);
});

test('cli restart and refresh are no-ops without a verified daemon', () => {
  fs.mkdirSync(process.env.AMAIL_PLUGIN_STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.AMAIL_PLUGIN_STATE_DIR, 'daemon.pid'), `${process.pid}\n`);
  assert.deepEqual(runCli(['restart']).json, { ok: true, stopped: false });
  assert.deepEqual(runCli(['refresh']).json, { ok: true, poked: false });
});

test.after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});
