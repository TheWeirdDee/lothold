// LotHold server entry point: API, durable job worker and (in production) the built web client.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { startWorker } from './jobs.ts';
import { createJobHandlers, verifyDatasets } from './handlers.ts';
import { secrets } from './security.ts';

secrets.evidenceKey();
secrets.signingKey();

const db = openDb();
const app = createApp(db);

if (existsSync('dist/index.html')) {
  // Built files (hashed assets, favicon, images) first; then the SPA shell for client-side routes.
  app.use('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ root: './dist' })(c, next)));
  app.get('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ path: './dist/index.html' })(c, next)));
}

const datasetsOk = await verifyDatasets();
const worker = startWorker(db, createJobHandlers(db, { datasetsOk }));

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(JSON.stringify({ event: 'listening', url: `http://${info.address}:${info.port}`, datasetsVerified: datasetsOk }));
});

async function shutdown() {
  await worker.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
