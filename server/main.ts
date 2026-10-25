// LotHold server entry point: API, durable job worker and (in production) the built web client.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { startWorker } from './jobs.ts';
import { createJobHandlers, verifyDatasets } from './handlers.ts';
import { housekeeping, secrets } from './security.ts';
import { cloudDurabilityFromEnv } from './durability.ts';

secrets.evidenceKey();
secrets.signingKey();

const durable = await cloudDurabilityFromEnv();
const db = openDb();
if (durable) { durable.attach(db); await durable.flush(); }
const app = createApp(db, { durability: durable });
const durabilityTimer = durable ? setInterval(() => { void durable.flush().catch(() => console.log(JSON.stringify({ event: 'durability.unavailable' }))); }, 5000) : null;
durabilityTimer?.unref();

if (existsSync('dist/index.html')) {
  // Built files (hashed assets, favicon, images) first; then the SPA shell for client-side routes.
  app.use('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ root: './dist' })(c, next)));
  app.get('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ path: './dist/index.html' })(c, next)));
}


const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(JSON.stringify({ event: 'listening', url: `http://${info.address}:${info.port}` }));
});

// Listen first; verify the raster hashes in the background. Until verification finishes, public analysis
// returns UNAVAILABLE and no analysis job runs, because the worker only starts afterwards.
let worker: ReturnType<typeof startWorker> | null = null;
verifyDatasets()
  .catch((e: Error) => {
    console.log(JSON.stringify({ event: 'datasets.verify_failed', error: e.message }));
    return false;
  })
  .then((datasetsOk) => {
    console.log(JSON.stringify({ event: 'datasets.verified', ok: datasetsOk }));
    // Jobs that do not need the rasters (e.g. testnet anchoring) still run when verification failed.
    worker = startWorker(db, createJobHandlers(db, { datasetsOk }));
  });

// Remove expired sessions and rate-limit records that are never revisited.
const sweep = () => {
  try {
    const r = housekeeping(db);
    if (r.rateEvents || r.sessions) console.log(JSON.stringify({ event: 'housekeeping', ...r }));
  } catch (e) {
    console.log(JSON.stringify({ event: 'housekeeping.failed', error: (e as Error).message }));
  }
};
sweep();
const sweepTimer = setInterval(sweep, 15 * 60 * 1000);
sweepTimer.unref();

async function shutdown() {
  if (durabilityTimer) clearInterval(durabilityTimer);
  await worker?.stop();
  await durable?.flush().catch(() => console.log(JSON.stringify({ event: 'durability.shutdown_unconfirmed' })));
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
