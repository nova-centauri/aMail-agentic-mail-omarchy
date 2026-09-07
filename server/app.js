import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { registerApi } from './routes/api.js';
import { registerMcp } from './routes/mcp.js';
import { registerEvents } from './routes/events.js';
import { NOOP_EVENTS } from './services/events.js';
import { errorHandler, notFound } from './middleware/errors.js';

function safeRequestUrl(value) {
  const raw = String(value || '');
  try {
    const url = new URL(raw, 'http://amail.invalid');
    for (const name of ['token', 'access_token', 'signature', 'sig']) {
      if (url.searchParams.has(name)) url.searchParams.set(name, '[redacted]');
    }
    return `${url.pathname}${url.search}`;
  } catch {
    // Keep logging useful even for a malformed request target without allowing a
    // capability token to reach the log sink.
    return raw.replace(/([?&](?:token|access_token|signature|sig)=)[^&]*/gi, '$1[redacted]');
  }
}

function requestSerializer(request) {
  // Do not log headers at all: besides remote tokens in URLs, this avoids
  // bearer credentials, cookies, and mail-client metadata reaching Pino.
  return {
    id: request.id,
    method: request.method,
    url: safeRequestUrl(request.url),
    remoteAddress: request.socket?.remoteAddress,
    remotePort: request.socket?.remotePort,
  };
}

export function createApp({ config, repos, mailService, remoteContent, logger, passkeys, events = NOOP_EVENTS, idle = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(pinoHttp({
    logger,
    autoLogging: config.env !== 'test',
    serializers: { req: requestSerializer },
  }));
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // The supported SSH-tunnel deployment is intentionally plain HTTP on
        // loopback, so do not rewrite same-origin API requests to HTTPS.
        upgradeInsecureRequests: null,
      },
    },
  }));
  // Compose attachments travel as base64 JSON. 8 MiB of files is ~11 MiB encoded.
  app.use(express.json({ limit: '12mb', type: ['application/json', 'application/*+json'] }));

  registerApi(app, { config, repos, mailService, remoteContent, passkeys, events, idle });
  registerEvents(app, { config, events });
  registerMcp(app, { config, repos, mailService, remoteContent });
  app.use('/api', notFound);

  if (fs.existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: config.env === 'production' ? '1h' : 0 }));
    app.get(/^(?!\/(?:api|mcp)(?:\/|$)).*/, (request, response, next) => {
      if (!request.accepts('html')) return next();
      response.sendFile(path.join(config.staticDir, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
