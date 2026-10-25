import { afterAll, expect, it } from 'vitest';
import { setupEnv, CLEAR_PROBE } from './harness.ts';
import { openDb } from '../../server/db.ts';
import { createApp } from '../../server/app.ts';
import { verifyDatasets } from '../../server/handlers.ts';
import { stopAnalysis } from '../../server/analysis.ts';
const env=setupEnv(), db=openDb(env.dbPath), app=createApp(db);
afterAll(async () => { await stopAnalysis(); db.close(); });
it('enqueues public analysis, keeps health responsive and polls a real result', async () => {
 await verifyDatasets(() => {});
 const t=performance.now();
 const response=await app.request('/api/public/forest-check',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:5173'},body:JSON.stringify({geometry:CLEAR_PROBE})});
 expect(response.status).toBe(202); expect(performance.now()-t).toBeLessThan(1500);
 const job=await response.json(); let result:any; let heartbeats=0;
 for(let i=0;i<100;i++) {
  const began=performance.now();
  expect((await app.request('/api/health')).status).toBe(200);
  expect(performance.now()-began).toBeLessThan(1000); heartbeats++;
  result=await (await app.request(job.pollUrl)).json();
  if(result.status==='complete'||result.status==='failed') break;
  await new Promise(r=>setTimeout(r,100));
 }
 expect(heartbeats).toBeGreaterThan(1); expect(result.status).toBe('complete');
 expect(result.result.analysis.grid).toBeTruthy();
 expect((await app.request('/api/public/forest-check/not-a-capability')).status).toBe(404);
},30000);
