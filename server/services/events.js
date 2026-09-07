import { EventEmitter } from 'node:events';

/**
 * In-process event bus. Everything that changes mail state announces itself
 * here so push consumers (the SSE endpoint, the Omarchy plugin, future
 * webhooks) learn about new mail the moment it is ingested instead of on the
 * next poll.
 *
 * Events are plain objects: `{ id, type, at, ...data }`. `id` is a monotonic
 * sequence number per process so a reconnecting client can tell whether it
 * missed anything and refresh.
 */
export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let seq = 0;
  const recent = [];
  const RECENT_LIMIT = 200;

  function emit(type, data = {}) {
    seq += 1;
    const event = { id: seq, type, at: new Date().toISOString(), ...data };
    recent.push(event);
    if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
    emitter.emit('event', event);
    return event;
  }

  function subscribe(listener) {
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  }

  /** Events with an id greater than `since`, oldest first (bounded). */
  function since(id) {
    const from = Number(id) || 0;
    return recent.filter((event) => event.id > from);
  }

  return {
    emit,
    subscribe,
    since,
    get seq() { return seq; },
    get listenerCount() { return emitter.listenerCount('event'); },
  };
}

/** A bus that swallows everything; used where events are optional. */
export const NOOP_EVENTS = Object.freeze({
  emit: () => null,
  subscribe: () => () => {},
  since: () => [],
  seq: 0,
  listenerCount: 0,
});
