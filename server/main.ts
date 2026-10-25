// Startup is intentionally sequential and measured. No listener exists before
// checkpoint recovery, database/evidence integrity and raster verification finish.
const boot = performance.now();
async function phase<T>(name: string, work: () => T | Promise<T>): Promise<T> {
 const t=performance.now(), cpu=process.cpuUsage();
 try { const result=await work(); console.log(JSON.stringify({event:'startup.phase',phase:name,ms:Math.round(performance.now()-t),cpuMicros:process.cpuUsage(cpu)})); return result; }
 catch(e) { console.error(JSON.stringify({event:'startup.failed',phase:name})); throw e; }
}
const { serve } = await phase('import.http', () => import('@hono/node-server'));
const { serveStatic } = await phase('import.static', () => import('@hono/node-server/serve-static'));
const { existsSync } = await import('node:fs');
const { openDb } = await phase('import.database', () => import('./db.ts'));
const { housekeeping, secrets } = await phase('import.security', () => import('./security.ts'));
secrets.evidenceKey(); secrets.signingKey();
const { cloudDurabilityFromEnv } = await phase('import.checkpoint', () => import('./durability.ts'));
const durable = await phase('checkpoint.recover', () => cloudDurabilityFromEnv());
const db = await phase('database.initialize', () => openDb());
await phase('checkpoint.integrity', () => durable?.attach(db));
await phase('checkpoint.publish', () => durable?.flush());
const { createApp } = await phase('import.api', () => import('./app.ts'));
const { createJobHandlers, verifyDatasets } = await phase('import.handlers', () => import('./handlers.ts'));
const datasetsOk = await phase('rasters.verify', () => verifyDatasets());
if (!datasetsOk && process.env.NODE_ENV === 'production') throw new Error('Required raster integrity verification failed. Refusing readiness.');
const app = createApp(db, { durability: durable });
if (existsSync('dist/index.html')) {
 app.use('*', async (c,next) => c.req.path.startsWith('/api/') ? next() : serveStatic({root:'./dist'})(c,next));
 app.get('*', async (c,next) => c.req.path.startsWith('/api/') ? next() : serveStatic({path:'./dist/index.html'})(c,next));
}
const server = serve({fetch:app.fetch, port:Number(process.env.PORT ?? 8787), hostname:process.env.HOST ?? '127.0.0.1'}, () => console.log(JSON.stringify({event:'startup.ready',ms:Math.round(performance.now()-boot)})));
const { startWorker } = await import('./jobs.ts');
const worker = startWorker(db, createJobHandlers(db, {datasetsOk}));
const durabilityTimer = durable ? setInterval(() => { void durable.flush().catch(() => console.log(JSON.stringify({event:'durability.unavailable'}))); },5000) : null;
durabilityTimer?.unref();
const sweep = () => { try { housekeeping(db); } catch { console.log(JSON.stringify({event:'housekeeping.failed'})); } };
sweep(); const sweepTimer=setInterval(sweep,15*60*1000); sweepTimer.unref();
async function shutdown() {
 if (durabilityTimer) clearInterval(durabilityTimer);
 clearInterval(sweepTimer); server.close();
 const {stopAnalysis}=await import('./analysis.ts'); await stopAnalysis();
 await worker.stop(); await durable?.flush().catch(() => console.log(JSON.stringify({event:'durability.shutdown_unconfirmed'})));
 db.close(); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
export {};
