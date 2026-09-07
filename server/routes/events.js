import { accessGate } from '../middleware/auth.js';

const HEARTBEAT_MS = 20_000;

function writeEvent(response, event) {
  response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * `GET /api/events` — Server-Sent Events stream of mail activity.
 *
 * Same Bearer/cookie gate as the rest of the API. A client that reconnects
 * with `Last-Event-ID` (or `?since=<id>`) receives the events it missed while
 * the connection was down, as long as they are still in the bus's recent
 * window; otherwise the `hello` event tells it to refresh.
 */
export function registerEvents(app, { config, events }) {
  app.get('/api/events', accessGate(config), (request, response) => {
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    request.socket.setNoDelay(true);
    request.socket.setKeepAlive(true, 15_000);

    const since = Number(request.get('last-event-id') || request.query.since || 0) || 0;
    const missed = since ? events.since(since) : [];
    const oldest = missed[0]?.id;
    // `gap` is true when the client asked for events older than the bus still
    // remembers; it should do a full refresh rather than trust the replay.
    const gap = since > 0 && since < events.seq && (!missed.length || (oldest && oldest !== since + 1));
    writeEvent(response, { id: events.seq, type: 'hello', at: new Date().toISOString(), seq: events.seq, gap, heartbeatMs: HEARTBEAT_MS });
    for (const event of missed) writeEvent(response, event);

    const unsubscribe = events.subscribe((event) => {
      try { writeEvent(response, event); } catch { /* socket gone; close handler cleans up */ }
    });
    const heartbeat = setInterval(() => {
      try { response.write(`: ping ${Date.now()}\n\n`); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.on('close', cleanup);
    response.on('close', cleanup);
  });
}
