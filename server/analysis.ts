import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { ForestAnalysis } from './env/forest.ts';
type Task = { geometry: unknown; start?: () => void; resolve: (r: ForestAnalysis) => void; reject: (e: Error) => void };
// One child process (geotiff web-worker shim cannot be imported in an arbitrary Node worker thread).
// One shared lane bounds decoded-raster memory across private and public jobs.
let worker: ChildProcess | null = null, active: Task | null = null;
const queue: Task[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
function pump() {
  if (active || !queue.length) return;
  if (!worker) {
    const compiled = new URL('./analysis-worker.mjs', import.meta.url);
    worker = fork(fileURLToPath(existsSync(compiled) ? compiled : new URL('./analysis-worker.ts', import.meta.url)), [], { execArgv: [], stdio: ['ignore','inherit','inherit','ipc'] });
    worker.on('message', (message) => {
      const m = message as {error?:string;result:ForestAnalysis};
      clearTimeout(timer); const t = active; active = null;
      if (m.error) t?.reject(new Error(m.error)); else t?.resolve(m.result);
      worker?.unref(); worker?.channel?.unref(); pump();
    });
    worker.on('error', fail);
    const instance = worker;
    worker.on('exit', (code) => { if (worker === instance) fail(new Error(`Analysis worker exited (${code}). Retry the analysis.`)); });
  }
  active = queue.shift()!; active.start?.(); worker.ref(); worker.channel?.ref();
  worker.send({ geometry: active.geometry });
  timer = setTimeout(() => { void stopAnalysis(new Error('Analysis exceeded its five-minute job budget. Retry explicitly.')); }, 300_000);
}
function fail(e: Error) {
  if (active) console.error(JSON.stringify({event:'analysis.worker_failed',message:e.message}));
  clearTimeout(timer); const old = worker; worker = null;
  active?.reject(e); active = null;
  for (const t of queue.splice(0)) t.reject(e);
  old?.kill();
}
export function analyseOffThread(geometry: unknown, start?: () => void): Promise<ForestAnalysis> {
  if (queue.length >= 8) return Promise.reject(new Error('Analysis queue is full. Retry shortly.'));
  return new Promise((resolve, reject) => { queue.push({ geometry, start, resolve, reject }); pump(); });
}
export async function stopAnalysis(error = new Error('Analysis worker stopped.')) { fail(error); }
