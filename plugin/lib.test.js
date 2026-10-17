import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  ApiError,
  applyConfigFloors,
  applyHttpFailure,
  computeBackoffMs,
  createApi,
  createRequestGate,
  decideAfterEventsResponse,
  DEFAULT_CONFIG,
  isAuthFailure,
  messagesListPath,
  nextRetryDelayMs,
  pluginUserAgent,
  POLL_SECONDS_FLOOR,
  recipientsFrom,
  resolveOpenTarget,
  retryAfterMs,
  SYNC_SECONDS_FLOOR,
} from './lib.mjs';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function originOf(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

describe('resolveOpenTarget', () => {
  const config = { url: 'https://mail.example.test' };

  it('focuses the inbox when no path is given', () => {
    const result = resolveOpenTarget(config, '');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://mail.example.test');
    assert.equal(result.focus, true);
  });

  it('opens compose without focusing an existing window', () => {
    const result = resolveOpenTarget(config, '/?compose=1');
    assert.equal(result.ok, true);
    assert.match(result.url, /compose=1/);
    assert.equal(result.focus, false);
    assert.equal(result.intent.compose, true);
  });

  it('opens a thread id as a deep link', () => {
    const result = resolveOpenTarget(config, 'abc-123');
    assert.equal(result.focus, false);
    assert.match(result.url, /thread=abc-123/);
  });

  it('turns mailto: into a compose URL', () => {
    const result = resolveOpenTarget(config, 'mailto:maya@studio.example?subject=Hi');
    assert.equal(result.focus, false);
    assert.match(result.url, /compose=1/);
    assert.match(result.url, /maya%40studio.example/);
    assert.equal(result.intent.subject, 'Hi');
  });

  it('fails when aMail is not configured', () => {
    const result = resolveOpenTarget({ url: '' }, '');
    assert.equal(result.ok, false);
    assert.match(result.error, /not configured/);
  });
});

describe('recipientsFrom', () => {
  it('splits comma-separated addresses and objects', () => {
    assert.deepEqual(recipientsFrom('maya@studio.example, avery@ops.example'), [
      { name: '', email: 'maya@studio.example' },
      { name: '', email: 'avery@ops.example' },
    ]);
    assert.deepEqual(recipientsFrom([{ name: 'Maya', email: 'maya@studio.example' }]), [
      { name: 'Maya', email: 'maya@studio.example' },
    ]);
  });
});

describe('config floors', () => {
  it('clamps poll and sync below the floor and warns', () => {
    const warnings = [];
    const config = applyConfigFloors(
      { ...DEFAULT_CONFIG, pollSeconds: 10, syncSeconds: 45, safetyPollSeconds: 12 },
      { configured: { pollSeconds: 10, syncSeconds: 45, safetyPollSeconds: 12 }, warn: (message) => warnings.push(message) },
    );
    assert.equal(config.pollSeconds, POLL_SECONDS_FLOOR);
    assert.equal(config.syncSeconds, SYNC_SECONDS_FLOOR);
    assert.equal(config.safetyPollSeconds, 60);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /pollSeconds=10/);
    assert.match(warnings[1], /syncSeconds=45/);
  });

  it('keeps values at or above the floor without warning', () => {
    const warnings = [];
    const config = applyConfigFloors(
      { ...DEFAULT_CONFIG, pollSeconds: 90, syncSeconds: 600, safetyPollSeconds: 120 },
      { configured: { pollSeconds: 90, syncSeconds: 600, safetyPollSeconds: 120 }, warn: (message) => warnings.push(message) },
    );
    assert.equal(config.pollSeconds, 90);
    assert.equal(config.syncSeconds, 600);
    assert.equal(config.safetyPollSeconds, 120);
    assert.deepEqual(warnings, []);
  });

  it('does not warn when the default floor is used', () => {
    const warnings = [];
    const config = applyConfigFloors({ ...DEFAULT_CONFIG }, { configured: {}, warn: (message) => warnings.push(message) });
    assert.equal(config.pollSeconds, POLL_SECONDS_FLOOR);
    assert.equal(config.syncSeconds, SYNC_SECONDS_FLOOR);
    assert.equal(config.syncEnabled, false);
    assert.equal(config.badgePageSize, 5);
    assert.deepEqual(warnings, []);
  });
});

describe('backoff', () => {
  it('grows exponentially with equal jitter', () => {
    assert.equal(computeBackoffMs(0, { baseMs: 1000, random: () => 0 }), 500);
    assert.equal(computeBackoffMs(0, { baseMs: 1000, random: () => 1 }), 1000);
    assert.equal(computeBackoffMs(3, { baseMs: 1000, random: () => 0 }), 4000);
    assert.equal(computeBackoffMs(3, { baseMs: 1000, random: () => 1 }), 8000);
  });

  it('caps the exponential delay', () => {
    assert.equal(computeBackoffMs(20, { baseMs: 1000, maxMs: 5000, random: () => 1 }), 5000);
  });

  it('honours Retry-After seconds and HTTP-date', () => {
    assert.equal(retryAfterMs('7'), 7000);
    assert.equal(retryAfterMs('0'), 0);
    const now = Date.parse('2026-10-17T12:00:00.000Z');
    assert.equal(retryAfterMs('Sat, 17 Oct 2026 12:00:12 GMT', now), 12_000);
    assert.equal(retryAfterMs('nope'), null);
  });

  it('prefers Retry-After on 429 and otherwise uses backoff', () => {
    assert.equal(nextRetryDelayMs({ status: 429, retryAfter: '3', attempt: 0, random: () => 1, baseMs: 1000 }), 3000);
    assert.equal(nextRetryDelayMs({ status: 500, attempt: 2, random: () => 1, baseMs: 1000 }), 4000);
    assert.equal(nextRetryDelayMs({ status: 429, retryAfter: 'nope', attempt: 1, random: () => 1, baseMs: 1000 }), 2000);
  });
});

describe('401/403 stop and SSE fallback', () => {
  it('stops and asks for re-auth on 401 and 403', () => {
    assert.equal(isAuthFailure(401), true);
    assert.equal(isAuthFailure(403), true);
    assert.equal(isAuthFailure(404), false);
    const unauthorized = applyHttpFailure({ transport: 'poll' }, { status: 401 });
    assert.equal(unauthorized.stopped, true);
    assert.equal(unauthorized.transport, 'reauth');
    assert.match(unauthorized.error, /Re-authenticate/);
    const forbidden = applyHttpFailure({ transport: 'push' }, { status: 403 });
    assert.equal(forbidden.stopped, true);
    assert.equal(forbidden.transport, 'reauth');
  });

  it('falls back to poll only when /api/events is missing', () => {
    const missing = decideAfterEventsResponse(404);
    assert.equal(missing.transport, 'poll');
    assert.equal(missing.fallback, 'events-missing');
    assert.equal(missing.stopped, false);

    const other404 = applyHttpFailure({ transport: 'poll' }, { status: 404, path: '/api/messages' });
    assert.notEqual(other404.fallback, 'events-missing');
    assert.equal(other404.stopped, false);
    assert.ok(other404.delayMs > 0);

    const ok = decideAfterEventsResponse(200);
    assert.equal(ok.transport, 'push');
    assert.equal(ok.stopped, false);
  });

  it('reconnects with backoff on event-stream errors other than 404', () => {
    const dropped = applyHttpFailure({ transport: 'push' }, { status: 502, attempt: 1, random: () => 1, baseMs: 2000 });
    assert.equal(dropped.transport, 'reconnecting');
    assert.equal(dropped.stopped, false);
    assert.equal(dropped.delayMs, 4000);
  });
});

describe('badge query', () => {
  it('asks for a small inbox page instead of the full list', () => {
    assert.equal(messagesListPath(), '/api/messages?folder=inbox&pageSize=5');
    assert.equal(messagesListPath({ pageSize: 1 }), '/api/messages?folder=inbox&pageSize=1');
  });
});

describe('User-Agent', () => {
  it('identifies the plugin version and host', () => {
    assert.equal(pluginUserAgent({ version: '0.3.0', hostname: 'desk-one' }), 'amail-omarchy/0.3.0 (desk-one)');
  });
});

describe('request gate', () => {
  it('runs one function at a time', async () => {
    const gate = createRequestGate();
    let current = 0;
    let peak = 0;
    const job = async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 20));
      current -= 1;
    };
    await Promise.all([gate.run(job), gate.run(job), gate.run(job)]);
    assert.equal(peak, 1);
  });
});

describe('createApi', () => {
  it('sends a descriptive User-Agent and handles ETag / 304', async () => {
    const seen = [];
    const server = await listen((request, response) => {
      seen.push({
        ua: request.headers['user-agent'],
        inm: request.headers['if-none-match'] || null,
      });
      if (request.headers['if-none-match'] === '"v1"') {
        response.statusCode = 304;
        response.setHeader('ETag', '"v1"');
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader('ETag', '"v1"');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ messages: [{ id: 'm1' }], folderCounts: { inbox: 2 } }));
    });
    try {
      const api = createApi({
        url: originOf(server),
        token: 'secret',
        userAgent: pluginUserAgent({ version: '0.3.0', hostname: 'desk-one' }),
      });
      const first = await api.request('GET', '/api/messages?folder=inbox&pageSize=5');
      assert.equal(first.status, 200);
      assert.equal(first.notModified, false);
      assert.equal(first.etag, '"v1"');
      assert.equal(first.data.folderCounts.inbox, 2);
      const second = await api.request('GET', '/api/messages?folder=inbox&pageSize=5', { ifNoneMatch: first.etag });
      assert.equal(second.status, 304);
      assert.equal(second.notModified, true);
      assert.equal(seen[0].ua, 'amail-omarchy/0.3.0 (desk-one)');
      assert.equal(seen[1].inm, '"v1"');
    } finally {
      server.close();
    }
  });

  it('surfaces 429 Retry-After and stops callers from overlapping', async () => {
    let current = 0;
    let peak = 0;
    const server = await listen((request, response) => {
      current += 1;
      peak = Math.max(peak, current);
      if (request.url === '/api/busy') {
        setTimeout(() => {
          current -= 1;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ ok: true }));
        }, 30);
        return;
      }
      current -= 1;
      response.statusCode = 429;
      response.setHeader('Retry-After', '12');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'slow down' } }));
    });
    try {
      const api = createApi({ url: originOf(server), token: 'secret', userAgent: 'amail-omarchy/0.3.0 (desk-one)' });
      await assert.rejects(() => api.get('/api/messages'), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfter, '12');
        return true;
      });
      await Promise.all([api.get('/api/busy'), api.get('/api/busy')]);
      assert.equal(peak, 1);
    } finally {
      server.close();
    }
  });
});
