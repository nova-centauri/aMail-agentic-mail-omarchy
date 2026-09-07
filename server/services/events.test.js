import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventBus, NOOP_EVENTS } from './events.js';

test('event bus numbers events, replays recent ones, and notifies subscribers', () => {
  const bus = createEventBus();
  const received = [];
  const unsubscribe = bus.subscribe((event) => received.push(event));
  const first = bus.emit('message.new', { messageId: 'm1' });
  const second = bus.emit('message.state', { messageId: 'm1', isRead: true });
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(bus.seq, 2);
  assert.equal(received.length, 2);
  assert.equal(received[0].type, 'message.new');
  assert.equal(received[0].messageId, 'm1');
  assert.ok(received[0].at);
  assert.deepEqual(bus.since(1).map((event) => event.id), [2]);
  assert.deepEqual(bus.since(0).map((event) => event.id), [1, 2]);
  unsubscribe();
  bus.emit('sync.account', {});
  assert.equal(received.length, 2);
  assert.equal(bus.listenerCount, 0);
});

test('event bus bounds its replay window', () => {
  const bus = createEventBus();
  for (let index = 0; index < 250; index += 1) bus.emit('tick', { index });
  const replay = bus.since(0);
  assert.equal(replay.length, 200);
  assert.equal(replay[0].id, 51);
  assert.equal(replay.at(-1).id, 250);
});

test('noop bus is inert', () => {
  assert.equal(NOOP_EVENTS.emit('x'), null);
  assert.deepEqual(NOOP_EVENTS.since(0), []);
  assert.equal(typeof NOOP_EVENTS.subscribe(() => {}), 'function');
});
