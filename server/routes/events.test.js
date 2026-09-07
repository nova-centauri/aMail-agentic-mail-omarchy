import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { registerEvents } from './events.js';
import { createEventBus } from '../services/events.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function readUntil(response, predicate, timeoutMs = 3000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (predicate(buffer)) break;
  }
  await reader.cancel().catch(() => {});
  return buffer;
}

test('GET /api/events requires the access token', async () => {
  const app = express();
  const events = createEventBus();
  registerEvents(app, { config: { accessToken: 'secret' }, events });
  const server = await listen(app);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`);
    assert.equal(response.status, 401);
    await response.text();
  } finally {
    server.close();
  }
});

test('GET /api/events streams a hello then live events', async () => {
  const app = express();
  const events = createEventBus();
  registerEvents(app, { config: { accessToken: 'secret' }, events });
  const server = await listen(app);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: 'Bearer secret' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    setTimeout(() => events.emit('message.new', { messageId: 'm1', subject: 'hi' }), 50);
    const body = await readUntil(response, (text) => text.includes('event: message.new'));
    assert.match(body, /event: hello\n/);
    assert.match(body, /"type":"hello"/);
    assert.match(body, /id: 1\nevent: message.new\ndata: \{"id":1,"type":"message.new"/);
    assert.match(body, /"subject":"hi"/);
  } finally {
    server.close();
  }
});

test('GET /api/events replays missed events for Last-Event-ID', async () => {
  const app = express();
  const events = createEventBus();
  registerEvents(app, { config: { accessToken: null }, events });
  events.emit('message.new', { messageId: 'a' });
  events.emit('message.new', { messageId: 'b' });
  events.emit('message.state', { messageId: 'b' });
  const server = await listen(app);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { 'Last-Event-ID': '1' },
    });
    const body = await readUntil(response, (text) => text.includes('"messageId":"b"') && text.includes('message.state'));
    assert.match(body, /"type":"hello".*"gap":false/);
    assert.doesNotMatch(body, /"messageId":"a"/);
    assert.match(body, /id: 2\nevent: message.new/);
    assert.match(body, /id: 3\nevent: message.state/);
  } finally {
    server.close();
  }
});
