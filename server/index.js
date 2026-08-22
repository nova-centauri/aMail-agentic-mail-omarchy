import 'dotenv/config';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createDatabase, createRepositories } from './db.js';
import { createMailService } from './services/mail-service.js';
import { createRemoteContentService } from './services/remote-content.js';
import { createPasskeyService } from './services/passkeys.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] });
const database = createDatabase(config);
const repos = createRepositories(database);
const remoteContent = createRemoteContentService({ config, repos, logger });
const mailService = createMailService({ config, repos, logger });
const passkeys = createPasskeyService({ config, repos });
const app = createApp({ config, repos, mailService, remoteContent, logger, passkeys });

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, dataDir: config.dataDir }, 'GigaMail is ready');
});

let pollTimer;
if (config.syncIntervalMinutes > 0) {
  const poll = () => mailService.syncAll().catch((error) => logger.warn({ err: error }, 'Background mail sync failed'));
  pollTimer = setInterval(poll, config.syncIntervalMinutes * 60_000);
  pollTimer.unref();
  logger.info({ intervalMinutes: config.syncIntervalMinutes }, 'Background IMAP polling enabled');
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down GigaMail');
  if (pollTimer) clearInterval(pollTimer);
  server.close(async () => {
    await remoteContent.close().catch(() => {});
    repos.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
