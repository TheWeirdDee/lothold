// Development: runs the API server (with reload) and the Vite web dev server together.
//   npm run dev   ->  open http://localhost:5173
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env')) {
  console.error('No .env file. Run "npm run setup" first (creates the required secrets).');
  process.exit(1);
}

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[]) {
  // No shell: paths with spaces (e.g. C:\Program Files\nodejs) are passed safely as arguments.
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (line: string) => `[${name}] ${line}`;
  child.stdout!.on('data', (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(prefix(l))));
  child.stderr!.on('data', (d: Buffer) => d.toString().split(/\r?\n/).filter((l) => l && !l.includes('ExperimentalWarning') && !l.includes('trace-warnings')).forEach((l) => console.error(prefix(l))));
  child.on('exit', (code) => {
    console.log(prefix(`exited with code ${code}`));
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', process.execPath, ['--watch', '--env-file=.env', 'server/main.ts']);
run('web', process.execPath, ['node_modules/vite/bin/vite.js']);
console.log('Starting LotHold: open http://localhost:5173 once both servers are ready (Ctrl+C stops both).');
