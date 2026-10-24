// Runs every automated check in sequence and stops at the first failure.
//   npm run verify
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const forge = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'forge.exe' : 'forge');
const steps: [string, string, string[], { cwd?: string; optional?: boolean }?][] = [
  ['dataset hashes', process.execPath, ['scripts/fetch-datasets.ts', '--verify-only'], { optional: true }],
  ['typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['unit + integration', 'npx', ['vitest', 'run']],
  ['contracts', existsSync(forge) ? forge : 'forge', ['test'], { cwd: 'contracts', optional: !existsSync(forge) }],
  ['browser', 'npx', ['playwright', 'test']],
];
for (const [name, cmd, args, opts] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts?.cwd, shell: process.platform === 'win32' && cmd === 'npx' });
  if (r.status !== 0) {
    if (opts?.optional) {
      console.log(`(${name} skipped or failed; optional when its tool or data is not installed)`);
      continue;
    }
    console.error(`\nFAILED: ${name}`);
    process.exit(r.status ?? 1);
  }
}
console.log('\nAll checks passed.');
