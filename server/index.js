import 'dotenv/config';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createDatabase, createRepositories } from './db.js';
import { createMailService } from './services/mail-service.js';
import { createRemoteContentService } from './services/remote-content.js';
import { createPasskeyService } from './services/passkeys.js';
import { createApp } from './app.js';
import { configureSmartFilter } from './services/smart-filter.js';
import { createEventBus } from './services/events.js';
import { createIdleWatcher } from './services/idle.js';

const config = loadConfig();
configureSmartFilter({ opsSources: config.opsSources });
const logger = pino({ level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] });
let database;
try {
  database = createDatabase(config);
} catch (error) {
  logger.fatal({ err: error }, 'Failed to initialize the aMail database');
  process.exit(1);
}
const repos = createRepositories(database);
const remoteContent = createRemoteContentService({ config, repos, logger });
const events = createEventBus();
const mailService = createMailService({ config, repos, logger, events });
const passkeys = createPasskeyService({ config, repos });
const idle = config.imapIdle ? createIdleWatcher({ config, repos, mailService, logger, events }) : null;
const app = createApp({ config, repos, mailService, remoteContent, logger, passkeys, events, idle });

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, dataDir: config.dataDir }, 'aMail is ready');
  if (idle) {
    idle.start();
    logger.info({ maxIdleMs: config.imapIdleMaxMs }, 'IMAP IDLE push watchers enabled');
  }
});

let pollTimer;
if (config.syncIntervalMinutes > 0) {
  const poll = () => mailService.syncAll().catch((error) => logger.warn({ err: error }, 'Background mail sync failed'));
  pollTimer = setInterval(poll, config.syncIntervalMinutes * 60_000);
  pollTimer.unref();
  logger.info({ intervalMinutes: config.syncIntervalMinutes }, 'Background IMAP polling enabled');
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down aMail');
  if (pollTimer) clearInterval(pollTimer);
  if (idle) await idle.stop().catch(() => {});
  server.close(async () => {
    await remoteContent.close().catch(() => {});
    repos.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
