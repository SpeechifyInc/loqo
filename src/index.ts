import { loadConfig } from './config';
import { createGoogleAuth } from './core/auth/google';
import { seedDefaults } from './core/layers/service';
import { createProviderBackoff } from './core/pipeline/backoff';
import { createPricing } from './core/pricing';
import { createPgBossQueue } from './core/queue/pg-boss';
import { seedAllScenarios } from './core/scenarios/service';
import { startWorker } from './core/queue/worker';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { startServer } from './server/app';

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const integer = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** `all` runs API + worker in one process; split with ROLE=server / ROLE=worker when scaling out. */
const role = env('ROLE', 'all') as 'all' | 'server' | 'worker';
const connectionString = env('DATABASE_URL');

/**
 * `bun --hot` re-runs this module in the same process and keeps `globalThis`: the previous run's
 * signal handler and connections go first, or every reload leaks a pool and adds a handler bound
 * to one that is already closed.
 */
declare global {
  var loqoRuntime: { stop: () => Promise<void> } | undefined;
  var loqoShutdown: ((signal: NodeJS.Signals) => void) | undefined;
}
if (globalThis.loqoShutdown) {
  process.off('SIGINT', globalThis.loqoShutdown);
  process.off('SIGTERM', globalThis.loqoShutdown);
}
await globalThis.loqoRuntime?.stop();

const { db, pool } = createDb(connectionString, { poolSize: integer('DATABASE_POOL_SIZE', 10) });
await runMigrations(db);
const config = await loadConfig({ db });
const seeded = await seedDefaults(db, config.prompts);
const seededScenarios = await seedAllScenarios(db);
if (seeded.layers > 0 || seeded.prompts > 0 || seededScenarios > 0) {
  console.log(`[seed] built-in pipeline installed: ${seeded.layers} layers, ${seeded.prompts} prompts, ${seededScenarios} scenarios`);
}
const pricing = createPricing(db);
await pricing.start();
const queue = await createPgBossQueue(connectionString);
globalThis.loqoRuntime = {
  stop: async () => {
    await queue.stop({ graceful: false });
    await pool.end();
  },
};

const backoff = createProviderBackoff({ maxRetries: integer('TRANSLATE_MAX_RETRIES', 5) });

if (role !== 'server') {
  await startWorker(queue, { db, config, pricing, backoff }, {
    fieldsPerCall: integer('TRANSLATE_BATCH_SIZE', 20),
    concurrency: integer('TRANSLATE_CONCURRENCY', 2),
  });
  console.log('[worker] listening on queue "translate"');
}

let server: ReturnType<typeof startServer> | undefined;
if (role !== 'worker') {
  const production = process.env.NODE_ENV === 'production';
  const auth = createGoogleAuth({ clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET'), appUrl: env('APP_URL') });
  server = startServer(
    { db, queue, config, pricing, models: { providers: config.providers, backoff }, auth, secureCookies: production },
    { port: integer('PORT', 3000), development: !production },
  );
  console.log(`[server] http://localhost:${server.port} (${role})`);
}

/** Inside Docker's 10 s stop grace period: in-flight jobs get 8 s, the whole shutdown 9 s. */
const QUEUE_DRAIN_MS = 8_000;
const SHUTDOWN_DEADLINE_MS = 9_000;
/** `bun run` forwards the terminal's SIGINT to a child that already got it from the process group; a real second Ctrl+C comes later. */
const REPEAT_MS = 1_000;

let stoppingSince: number | null = null;
const shutdown = (signal: NodeJS.Signals) => {
  if (stoppingSince !== null) {
    if (Date.now() - stoppingSince < REPEAT_MS) return;
    console.log(`[${signal}] forced exit`);
    process.exit(1);
  }
  stoppingSince = Date.now();
  console.log(`[${signal}] shutting down; send it again to force`);
  setTimeout(() => {
    console.error(`[${signal}] still shutting down after ${SHUTDOWN_DEADLINE_MS} ms; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  // The port is released first, so a restart can bind it while the queue drains.
  void server?.stop(true);
  queue
    .stop({ graceful: true, timeoutMs: QUEUE_DRAIN_MS })
    .then(() => pool.end())
    .then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(`[${signal}] shutdown failed`, error);
        process.exit(1);
      },
    );
};
globalThis.loqoShutdown = shutdown;
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
